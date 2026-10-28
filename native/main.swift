import AppKit
import ApplicationServices
import Darwin

let helperVersion = "1.2.0"

func isCopyLinkShortcut(_ code: Int64, _ flags: CGEventFlags) -> Bool {
    code == 8 && flags.contains(.maskCommand) && flags.contains(.maskShift) &&
        !flags.contains(.maskAlternate) && !flags.contains(.maskControl)
}

@discardableResult
func writeLinkToClipboard(_ url: String, pasteboard: NSPasteboard = .general) -> Bool {
    guard !url.isEmpty else { return false }
    pasteboard.clearContents()
    return pasteboard.setString(url, forType: .string)
}

final class NativeWire {
    private let output = DispatchQueue(label: "app.seven.output", qos: .userInteractive)
    func send(_ message: [String: Any]) {
        guard let data = try? encodeFrame(message) else { return }
        output.async {
            data.withUnsafeBytes { raw in
                var position = 0
                while position < raw.count {
                    let sent = Darwin.write(STDOUT_FILENO, raw.baseAddress!.advanced(by: position), raw.count - position)
                    if sent < 0 && errno == EINTR { continue }
                    if sent <= 0 { return }
                    position += sent
                }
            }
        }
    }

    func read(onMessage: @escaping ([String: Any]) -> Void, onEnd: @escaping () -> Void) {
        DispatchQueue.global(qos: .userInteractive).async {
            var decoder = FrameDecoder()
            do {
                var scratch = [UInt8](repeating: 0, count: 65536)
                while true {
                    // POSIX read returns currently available bytes. Foundation's read(upToCount:)
                    // may wait to fill its requested count on a pipe, stalling small messages.
                    let size = Darwin.read(STDIN_FILENO, &scratch, scratch.count)
                    if size < 0 && errno == EINTR { continue }
                    if size <= 0 { break }
                    let chunk = Data(scratch.prefix(size))
                    for frame in try decoder.append(chunk) {
                        guard let value = try JSONSerialization.jsonObject(with: frame) as? [String: Any] else {
                            throw WireError.malformed
                        }
                        DispatchQueue.main.async { onMessage(value) }
                    }
                }
            } catch { /* A malformed peer terminates this host rather than executing commands. */ }
            DispatchQueue.main.async { onEnd() }
        }
    }
}

final class Switcher: NSObject, NSApplicationDelegate {
    let wire = NativeWire()
    let panel = SwitchPanel()
    let copyToast = CopyToastPanel()
    var items: [TabItem] = []
    var session = SwitchSession()
    var enabled = false
    var eventTap: CFMachPort?
    var eventSource: CFRunLoopSource?
    var permissionTimer: Timer?
    var observer: NSObjectProtocol?
    var consumedTabDown = false
    var consumedCopyDown = false
    var linkCopyRequest = LinkCopyRequest()
    var lastTrusted = false
    var lastStatusError = ""
    var token = 0
    var commitStarted: [String: Double] = [:]
    var keyToDraw: [Double] = []
    var commitLatency: [Double] = []
    var imageStrings: [Int: String] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        panel.overlay.onSelect = { [weak self] index in
            self?.session.select(index); self?.commit()
        }
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  app.bundleIdentifier != "com.google.Chrome" else { return }
            self?.cancel()
        }
        wire.read(onMessage: { [weak self] in self?.receive($0) }, onEnd: {
            NSApp.terminate(nil)
        })
        refreshPermission()
        wire.send(["type": "ready", "version": helperVersion, "trusted": lastTrusted, "error": lastStatusError])
        permissionTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.refreshPermission()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        permissionTimer?.invalidate()
        if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: false) }
        if let observer { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
    }

    func refreshPermission() {
        let trusted = AXIsProcessTrusted()
        if trusted && eventTap == nil { installTap() }
        if !trusted && eventTap != nil {
            if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: false) }
            if let eventSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), eventSource, .commonModes) }
            eventTap = nil; eventSource = nil; cancel()
        }
        let usable = trusted && eventTap != nil
        let error = trusted && eventTap == nil ? "无法创建键盘事件监听；请重新连接并检查辅助功能权限" : ""
        if lastTrusted != usable || lastStatusError != error {
            lastTrusted = usable; lastStatusError = error
            wire.send(["type": "status", "version": helperVersion, "trusted": usable, "error": error])
        }
    }

    func installTap() {
        let mask: CGEventMask = [CGEventType.keyDown, .keyUp, .flagsChanged, .leftMouseDown, .rightMouseDown]
            .reduce(0) { $0 | (CGEventMask(1) << $1.rawValue) }
        let pointer = Unmanaged.passUnretained(self).toOpaque()
        eventTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                    options: .defaultTap, eventsOfInterest: mask, callback: { _, type, event, context in
            guard let context else { return Unmanaged.passUnretained(event) }
            let owner = Unmanaged<Switcher>.fromOpaque(context).takeUnretainedValue()
            return owner.handle(type, event) ? nil : Unmanaged.passUnretained(event)
        }, userInfo: pointer)
        if let eventTap {
            eventSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
            CFRunLoopAddSource(CFRunLoopGetMain(), eventSource, .commonModes)
            CGEvent.tapEnable(tap: eventTap, enable: true)
        }
    }

    func handle(_ type: CGEventType, _ event: CGEvent) -> Bool {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            cancel()
            if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: true) }
            return false
        }
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        if type == .keyUp && code == 48 && consumedTabDown {
            consumedTabDown = false
            return true
        }
        if type == .keyUp && code == 8 && consumedCopyDown {
            consumedCopyDown = false
            return true
        }
        let isChrome = NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.google.Chrome"
        guard isChrome && enabled else { if session.isOpen { cancel() }; return false }
        let option = event.flags.contains(.maskAlternate)
        if type == .flagsChanged {
            if session.isOpen && !option { commit() }
            return false
        }
        if (type == .leftMouseDown || type == .rightMouseDown) && session.isOpen {
            // CGEvent uses top-left global coordinates; NSWindow uses bottom-left.
            let desktopHeight = NSScreen.screens.first?.frame.maxY ?? 0
            let point = NSPoint(x: event.location.x, y: desktopHeight - event.location.y)
            if !panel.frame.contains(point) { cancel() }
            return false
        }
        guard type == .keyDown else { return false }
        if isCopyLinkShortcut(code, event.flags) {
            consumedCopyDown = true
            if event.getIntegerValueField(.keyboardEventAutorepeat) == 0 {
                cancel()
                let id = linkCopyRequest.begin(at: ProcessInfo.processInfo.systemUptime)
                wire.send(["type": "copy-url", "requestId": id])
            }
            return true
        }
        let otherModifier = event.flags.contains(.maskCommand) || event.flags.contains(.maskControl)
        if code == 48 && option && !otherModifier {
            guard !items.isEmpty else { return false }
            consumedTabDown = true
            let started = ProcessInfo.processInfo.systemUptime
            let backwards = event.flags.contains(.maskShift)
            if session.isOpen { session.step(backwards ? -1 : 1) }
            else {
                session.begin(items, backward: backwards)
                wire.send(["type": "busy", "value": true])
            }
            draw()
            record(&keyToDraw, (ProcessInfo.processInfo.systemUptime - started) * 1000)
            return true
        }
        guard session.isOpen else { return false }
        if code == 53 { cancel(); return true } // Escape
        if code == 36 || code == 76 { commit(); return true } // Return / keypad enter
        if option && (code == 123 || code == 124) {
            session.step(code == 123 ? -1 : 1); draw(); return true
        }
        // A lost modifier-release must not leave a sticky panel.
        if !option { cancel() }
        return false
    }

    func receive(_ message: [String: Any]) {
        switch message["type"] as? String {
        case "snapshot":
            guard let raw = message["items"], JSONSerialization.isValidJSONObject(raw),
                  let data = try? JSONSerialization.data(withJSONObject: raw),
                  let decoded = try? JSONDecoder().decode([TabItem].self, from: data),
                  decoded.count <= 7, Set(decoded.map(\.id)).count == decoded.count else { return }
            enabled = message["enabled"] as? Bool ?? false
            items = decoded
            updateImages()
            if !enabled { cancel() }
            else if session.isOpen {
                session.reconcile(items, liveIds: (message["liveIds"] as? [Int]).map { Set($0) })
                if session.isOpen { draw() } else { cancel() }
            }
        case "request-permission":
            // User explicitly clicks this button in the packaged extension.
            let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
            _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                NSWorkspace.shared.open(url)
            }
        case "committed":
            if let token = message["token"] as? String, let start = commitStarted.removeValue(forKey: token) {
                record(&commitLatency, (ProcessInfo.processInfo.systemUptime - start) * 1000)
            }
        case "commit-error":
            commitStarted.removeAll()
            NSSound.beep()
        case "copy-url-result":
            guard let id = message["requestId"] as? String,
                  linkCopyRequest.accept(id, at: ProcessInfo.processInfo.systemUptime),
                  enabled, NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.google.Chrome" else { return }
            if let url = message["url"] as? String, !url.isEmpty {
                if writeLinkToClipboard(url) { copyToast.show(on: chromeScreen()) }
                else { NSSound.beep() }
            } else { NSSound.beep() }
        case "diagnostics": showDiagnostics()
        case "ping":
            wire.send(["type": "pong", "version": helperVersion, "count": items.count, "enabled": enabled])
        default: break
        }
    }

    func updateImages() {
        let ids = Set(items.map(\.id))
        imageStrings = imageStrings.filter { ids.contains($0.key) }
        panel.overlay.images = panel.overlay.images.filter { ids.contains($0.key) }
        for item in items {
            guard let value = item.preview else {
                imageStrings.removeValue(forKey: item.id); panel.overlay.images.removeValue(forKey: item.id); continue
            }
            if imageStrings[item.id] == value { continue }
            guard value.hasPrefix("data:image/jpeg;base64,"), value.utf8.count <= 125000,
                  let data = Data(base64Encoded: String(value.dropFirst(23))),
                  let rep = NSBitmapImageRep(data: data), rep.pixelsWide <= 384, rep.pixelsHigh <= 240 else { continue }
            // Materialize a bitmap on snapshot receipt; no JPEG decode in the key handler.
            let image = NSImage(size: rep.size)
            image.addRepresentation(rep)
            panel.overlay.images[item.id] = image
            imageStrings[item.id] = value
        }
    }

    func draw() {
        if panel.isVisible, let screen = panel.screen {
            panel.present(items: session.items, selected: session.index, screen: screen)
            return
        }
        panel.present(items: session.items, selected: session.index, screen: chromeScreen())
    }

    func chromeScreen() -> NSScreen {
        let chromePID = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
        let chromeWindow = windowInfo?.first(where: {
            ($0[kCGWindowOwnerPID as String] as? Int32) == chromePID &&
            ($0[kCGWindowLayer as String] as? Int) == 0
        })
        let bounds = chromeWindow?[kCGWindowBounds as String] as? [String: Any]
        let windowRect = bounds.flatMap { CGRect(dictionaryRepresentation: $0 as CFDictionary) }
        let desktopHeight = NSScreen.screens.first?.frame.maxY ?? 0
        let chromeCenter = windowRect.map { NSPoint(x: $0.midX, y: desktopHeight - $0.midY) }
        return NSScreen.screens.first(where: { $0.frame.contains(chromeCenter ?? NSEvent.mouseLocation) })
            ?? NSScreen.main ?? NSScreen.screens[0]
    }

    func commit() {
        guard let id = session.finish() else { return }
        panel.orderOut(nil)
        token += 1
        let key = String(token)
        commitStarted = [key: ProcessInfo.processInfo.systemUptime]
        wire.send(["type": "select", "tabId": id, "token": key])
        wire.send(["type": "busy", "value": false])
    }

    func cancel() {
        linkCopyRequest.cancel()
        copyToast.dismiss()
        let wasOpen = session.isOpen || panel.isVisible
        session.cancel()
        panel.orderOut(nil)
        if wasOpen { wire.send(["type": "busy", "value": false]) }
    }

    func record(_ array: inout [Double], _ value: Double) {
        array.append(value)
        if array.count > 100 { array.removeFirst(array.count - 100) }
    }

    func showDiagnostics() {
        func summary(_ values: [Double]) -> String {
            guard !values.isEmpty else { return "尚无样本" }
            let sorted = values.sorted()
            let p95 = sorted[min(sorted.count - 1, Int(Double(sorted.count - 1) * 0.95))]
            return "\(values.count) 次；P95 \(String(format: "%0.2f", p95)) ms"
        }
        let alert = NSAlert()
        alert.messageText = "Seven · 本机性能"
        alert.informativeText = "按键处理至绘制提交：\(summary(keyToDraw))\n松键至 Chrome 激活 API 返回：\(summary(commitLatency))\n\n前者不包含显示器扫描输出，后者不代表目标网页完成绘制。仅统计本次连接的最近 100 次操作；不写入磁盘或上传。"
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}

func fixtureItems() -> [TabItem] {
    let labels = ["Design explorations · Figma", "项目周报与进展", "GitHub · Pull requests", "Documentation", "产品思考与工作笔记", "Inbox · Mail", "New Tab"]
    let urls = ["https://figma.com/design/preview", "https://docs.example.com/project", "https://github.com/team/project", "https://developer.chrome.com/docs", "https://notion.so/notes", "https://mail.google.com", "chrome://newtab"]
    return labels.enumerated().map { TabItem(id: $0.offset + 1, windowId: 1, title: $0.element, url: urls[$0.offset]) }
}

func selfTest() throws {
    var count = 0
    func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        if !condition() { fputs("FAIL: \(name)\n", stderr); exit(1) }
        count += 1
    }
    let tabs = fixtureItems()
    var s = SwitchSession()
    s.begin(tabs, backward: false); check(s.selected?.id == 2, "first press selects previous tab")
    s.step(1); check(s.selected?.id == 3, "held Tab advances")
    s.step(-1); check(s.selected?.id == 2, "Shift Tab reverses")
    for _ in 0..<6 { s.step(1) }; check(s.selected?.id == 1, "wrap includes current")
    check(s.finish() == 1 && !s.isOpen, "release commits once")
    check(s.finish() == nil, "release cannot commit twice")
    s.begin(tabs, backward: true); check(s.selected?.id == 7, "reverse opening")
    s.cancel(); check(s.finish() == nil, "Escape cancels")
    s.begin(tabs, backward: false)
    s.reconcile(tabs.reversed()); check(s.items.map(\.id) == tabs.map(\.id), "hold freezes MRU order")
    s.reconcile([tabs[0]], liveIds: Set(tabs.map(\.id)))
    check(s.items.count == 7 && s.selected?.id == 2, "MRU changes do not remove live frozen cards")
    s.reconcile(tabs.filter { $0.id != 2 }); check(s.selected?.id == 3, "closed selection is removed")
    s.reconcile([]); check(!s.isOpen, "all closed")
    s.begin([], backward: false); check(s.finish() == nil, "empty")
    s.begin([tabs[0]], backward: false); s.step(-1); check(s.finish() == 1, "single tab")
    s.begin(tabs + tabs, backward: false); check(s.items.count == 7, "seven maximum")
    let message: [String: Any] = ["type": "snapshot", "title": "中文 👋"]
    let frame = try encodeFrame(message)
    var decoder = FrameDecoder()
    var frames: [Data] = []
    for byte in frame { frames += try decoder.append(Data([byte])) }
    check(frames.count == 1 && !decoder.hasPartialFrame, "fragmented UTF-8 frame")
    let decoded = try JSONSerialization.jsonObject(with: frames[0]) as! [String: String]
    check(decoded["title"] == "中文 👋", "UTF-8 round trip")
    frames = try decoder.append(frame + frame); check(frames.count == 2, "coalesced frames")
    do { _ = try decoder.append(Data([255, 255, 255, 127])); check(false, "oversized frame") }
    catch { check(true, "oversized rejected") }
    check(isCopyLinkShortcut(8, [.maskCommand, .maskShift]), "Command Shift C matches")
    check(!isCopyLinkShortcut(8, [.maskCommand]), "ordinary Command C is preserved")
    check(!isCopyLinkShortcut(8, [.maskCommand, .maskShift, .maskAlternate]), "Option chord is preserved")
    check(!isCopyLinkShortcut(8, [.maskCommand, .maskShift, .maskControl]), "Control chord is preserved")
    check(!isCopyLinkShortcut(9, [.maskCommand, .maskShift]), "other letters are preserved")
    var copies = LinkCopyRequest()
    let first = copies.begin(at: 1)
    let second = copies.begin(at: 2)
    check(!copies.accept(first, at: 2.1), "late copy reply is ignored")
    check(copies.accept(second, at: 2.2), "latest copy reply is accepted")
    check(!copies.accept(second, at: 2.3), "duplicate copy reply is ignored")
    let cancelled = copies.begin(at: 3); copies.cancel()
    check(!copies.accept(cancelled, at: 3.1), "leaving Chrome cancels pending copy")
    let expired = copies.begin(at: 4)
    check(!copies.accept(expired, at: 8), "expired copy cannot overwrite a later clipboard action")
    print("Native: \(count) checks passed")
}

func clipboardSelfTest() {
    // A private pasteboard exercises AppKit without touching the user's clipboard.
    let pasteboard = NSPasteboard.withUniqueName()
    defer { pasteboard.releaseGlobally() }
    let link = "https://example.com/路径?name=中文&value=" + String(repeating: "x", count: 6000) + "#section-2"
    guard writeLinkToClipboard(link, pasteboard: pasteboard),
          pasteboard.string(forType: .string) == link else {
        fputs("FAIL: full URL clipboard round trip\n", stderr); exit(1)
    }
    guard !writeLinkToClipboard("", pasteboard: pasteboard),
          pasteboard.string(forType: .string) == link else {
        fputs("FAIL: empty URL must preserve clipboard\n", stderr); exit(1)
    }
    print("Clipboard: long URL, Unicode, query, fragment and empty-URL preservation passed (private pasteboard)")
}

signal(SIGPIPE, SIG_IGN)
if CommandLine.arguments.contains("--self-test") {
    do { try selfTest() } catch { fputs("\(error)\n", stderr); exit(1) }
} else if CommandLine.arguments.contains("--clipboard-self-test") {
    clipboardSelfTest()
} else if let index = CommandLine.arguments.firstIndex(of: "--render-toast-fixture"), CommandLine.arguments.count > index + 1 {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.accessory)
    let view = CopyToastView(frame: NSRect(x: 0, y: 0, width: 198, height: 44))
    view.appearance = NSAppearance(named: CommandLine.arguments.contains("--dark") ? .darkAqua : .aqua)
    let image = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 396, pixelsHigh: 88,
                                 bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                 isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    image.size = view.bounds.size
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: image)!
    context.cgContext.translateBy(x: 0, y: view.bounds.height)
    context.cgContext.scaleBy(x: 1, y: -1)
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context.cgContext, flipped: true)
    view.draw(view.bounds)
    NSGraphicsContext.restoreGraphicsState()
    try image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
    print("Rendered copy toast fixture")
} else if let index = CommandLine.arguments.firstIndex(of: "--render-fixture"), CommandLine.arguments.count > index + 1 {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.accessory)
    let view = OverlayView(frame: NSRect(x: 0, y: 0, width: 1280, height: 271))
    view.appearance = NSAppearance(named: CommandLine.arguments.contains("--dark") ? .darkAqua : .aqua)
    view.items = fixtureItems(); view.selected = 1
    let image = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2560, pixelsHigh: 542,
                                 bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                 isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    image.size = view.bounds.size
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: image)!
    context.cgContext.translateBy(x: 0, y: view.bounds.height)
    context.cgContext.scaleBy(x: 1, y: -1)
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context.cgContext, flipped: true)
    (CommandLine.arguments.contains("--dark") ? NSColor(calibratedWhite: 0.12, alpha: 1) : NSColor(calibratedWhite: 0.96, alpha: 1)).setFill()
    view.bounds.fill()
    view.draw(view.bounds)
    NSGraphicsContext.restoreGraphicsState()
    try image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
    print("Rendered fixture")
} else if CommandLine.arguments.contains("--native-host") || CommandLine.arguments.contains(where: { $0.hasPrefix("chrome-extension://") }) {
    let app = NSApplication.shared
    let delegate = Switcher()
    app.delegate = delegate
    app.run()
    withExtendedLifetime(delegate) {}
} else {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let alert = NSAlert()
    alert.messageText = "Seven · 最近 7 个标签页"
    alert.informativeText = "Seven 由 Chrome 扩展自动启动。\n\n1. 在 Chrome 加载 seven-extension 文件夹。\n2. 点击扩展图标，选择「开启辅助功能权限」。\n3. 在系统设置中允许 Seven。\n\n按住 Option，连按 Tab 选择；松开 Option 切换。\nCommand + Shift + C 复制当前网页链接。"
    alert.addButton(withTitle: "好")
    app.activate(ignoringOtherApps: true)
    alert.runModal()
}
