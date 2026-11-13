import AppKit

final class CopyToastView: NSView {
    static let message = "已复制页面链接"
    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
        setAccessibilityLabel(Self.message)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unsupported") }

    override func draw(_ dirtyRect: NSRect) {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let background = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 12, yRadius: 12)
        NSColor(calibratedWhite: dark ? 0.16 : 0.98, alpha: 0.98).setFill()
        background.fill()
        NSColor(calibratedWhite: dark ? 1 : 0, alpha: dark ? 0.12 : 0.08).setStroke()
        background.lineWidth = 1
        background.stroke()

        NSColor(calibratedRed: 0.25, green: 0.64, blue: 0.42, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: 16, y: 12, width: 20, height: 20)).fill()
        let check = NSBezierPath()
        check.move(to: NSPoint(x: 21, y: 22))
        check.line(to: NSPoint(x: 25, y: 26))
        check.line(to: NSPoint(x: 31, y: 18))
        check.lineWidth = 2
        check.lineCapStyle = .round
        check.lineJoinStyle = .round
        NSColor.white.setStroke()
        check.stroke()
        (Self.message as NSString).draw(in: NSRect(x: 47, y: 13, width: 137, height: 19), withAttributes: [
            .font: NSFont.systemFont(ofSize: 13, weight: .medium),
            .foregroundColor: NSColor(calibratedWhite: dark ? 0.95 : 0.14, alpha: 1)
        ])
    }
}

final class CopyToastPanel: NSPanel {
    private var hideTimer: Timer?

    init() {
        let rect = NSRect(x: 0, y: 0, width: 198, height: 44)
        super.init(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        level = .popUpMenu
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        isReleasedWhenClosed = false
        hidesOnDeactivate = false
        ignoresMouseEvents = true
        contentView = CopyToastView(frame: rect)
    }
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    func show(on screen: NSScreen) {
        hideTimer?.invalidate()
        setFrameOrigin(NSPoint(x: screen.visibleFrame.midX - frame.width / 2,
                               y: screen.visibleFrame.minY + 80))
        orderFrontRegardless()
        NSAccessibility.post(element: contentView!, notification: .announcementRequested, userInfo: [
            .announcement: CopyToastView.message,
            .priority: NSAccessibilityPriorityLevel.medium.rawValue
        ])
        let timer = Timer(timeInterval: 1.2, repeats: false) { [weak self] _ in self?.dismiss() }
        hideTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func dismiss() {
        hideTimer?.invalidate()
        hideTimer = nil
        orderOut(nil)
    }
}

final class OverlayView: NSView {
    var items: [TabItem] = []
    var selected = 0
    var images: [Int: NSImage] = [:]
    var onSelect: ((Int) -> Void)?
    private(set) var cardRects: [NSRect] = []
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { false }

    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("最近 7 个标签页切换器")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unsupported") }

    override func draw(_ dirtyRect: NSRect) {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let ink: NSColor = dark ? .white : NSColor(calibratedWhite: 0.12, alpha: 1)
        let muted = ink.withAlphaComponent(0.48)
        let accent = NSColor(calibratedRed: 0.53, green: 0.43, blue: 0.93, alpha: 1)
        let padding: CGFloat = 22
        let gap: CGFloat = 10
        let count = max(1, items.count)
        let cardWidth = (bounds.width - padding * 2 - CGFloat(count - 1) * gap) / CGFloat(count)
        text("最近标签页", at: NSRect(x: padding + 2, y: 17, width: 200, height: 20),
             font: .systemFont(ofSize: 12, weight: .semibold), color: muted)
        text("\(items.count) / 7", at: NSRect(x: bounds.width - 82, y: 17, width: 58, height: 20),
             font: .monospacedDigitSystemFont(ofSize: 11, weight: .medium), color: muted, alignment: .right)
        cardRects = []
        for (i, item) in items.enumerated() {
            let rect = NSRect(x: padding + CGFloat(i) * (cardWidth + gap), y: 48,
                              width: cardWidth, height: bounds.height - 92)
            cardRects.append(rect)
            if i == selected {
                accent.withAlphaComponent(dark ? 0.20 : 0.10).setFill()
                NSBezierPath(roundedRect: rect.insetBy(dx: -4, dy: -6), xRadius: 13, yRadius: 13).fill()
                accent.withAlphaComponent(0.92).setStroke()
                let outline = NSBezierPath(roundedRect: rect.insetBy(dx: -4, dy: -6), xRadius: 13, yRadius: 13)
                outline.lineWidth = 2
                outline.stroke()
            }
            let previewRect = NSRect(x: rect.minX + 3, y: rect.minY + 2, width: rect.width - 6,
                                     height: rect.width * 0.625)
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(roundedRect: previewRect, xRadius: 8, yRadius: 8).addClip()
            if let image = images[item.id] {
                image.draw(in: previewRect, from: .zero, operation: .sourceOver, fraction: 1,
                           respectFlipped: true, hints: [.interpolation: NSImageInterpolation.medium.rawValue])
            } else {
                let hue = CGFloat(stableHash(item.host) % 360) / 360
                NSColor(calibratedHue: hue, saturation: dark ? 0.26 : 0.12,
                        brightness: dark ? 0.23 : 0.95, alpha: 1).setFill()
                previewRect.fill()
                text(String((item.host.isEmpty ? item.title : item.host).prefix(1)).uppercased(),
                     at: NSRect(x: previewRect.minX, y: previewRect.midY - 24, width: previewRect.width, height: 45),
                     font: .systemFont(ofSize: 33, weight: .medium), color: ink.withAlphaComponent(0.58), alignment: .center)
            }
            NSGraphicsContext.restoreGraphicsState()
            let badge = item.audible ? "♫" : item.discarded ? "☾" : String(i + 1)
            text(badge, at: NSRect(x: previewRect.minX + 7, y: previewRect.minY + 5, width: 23, height: 19),
                 font: .monospacedDigitSystemFont(ofSize: 10, weight: .bold),
                 color: images[item.id] == nil ? muted : .darkGray,
                 background: images[item.id] == nil ? nil : .white.withAlphaComponent(0.85))
            text(item.title, at: NSRect(x: rect.minX + 4, y: previewRect.maxY + 11,
                                       width: rect.width - 8, height: 34),
                 font: .systemFont(ofSize: 11, weight: i == selected ? .semibold : .medium),
                 color: ink.withAlphaComponent(i == selected ? 1 : 0.82), lines: 2)
            text(item.host, at: NSRect(x: rect.minX + 4, y: previewRect.maxY + 48,
                                     width: rect.width - 8, height: 16),
                 font: .systemFont(ofSize: 10), color: muted)
        }
        text("按住 ⌥ · Tab 选择     ⇧ Tab 返回     松开 ⌥ 切换     Esc 取消",
             at: NSRect(x: padding, y: bounds.height - 28, width: bounds.width - padding * 2, height: 17),
             font: .systemFont(ofSize: 10.5), color: muted, alignment: .center)
    }

    private func text(_ value: String, at rect: NSRect, font: NSFont, color: NSColor,
                      lines: Int = 1, alignment: NSTextAlignment = .left, background: NSColor? = nil) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = lines == 1 ? .byTruncatingTail : .byTruncatingTail
        paragraph.alignment = alignment
        paragraph.maximumLineHeight = lines == 1 ? 0 : 15
        var attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: paragraph]
        if let background { attributes[.backgroundColor] = background }
        (value as NSString).draw(with: rect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: attributes)
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if let index = cardRects.firstIndex(where: { $0.contains(point) }) { onSelect?(index) }
    }

    override func accessibilityValue() -> Any? {
        guard items.indices.contains(selected) else { return "没有最近标签页" }
        return "\(selected + 1) / \(items.count)，\(items[selected].title)"
    }
}

func stableHash(_ value: String) -> UInt64 {
    value.utf8.reduce(UInt64(5381)) { ($0 &* 33) &+ UInt64($1) }
}

final class SwitchPanel: NSPanel {
    let overlay: OverlayView
    init() {
        overlay = OverlayView(frame: .zero)
        super.init(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 265),
                   styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        level = .popUpMenu
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        isReleasedWhenClosed = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        let glass = NSVisualEffectView(frame: NSRect(origin: .zero, size: frame.size))
        glass.material = .hudWindow
        glass.blendingMode = .behindWindow
        glass.state = .active
        glass.wantsLayer = true
        glass.layer?.cornerRadius = 20
        glass.layer?.masksToBounds = true
        glass.autoresizingMask = [.width, .height]
        overlay.frame = glass.bounds
        overlay.autoresizingMask = [.width, .height]
        glass.addSubview(overlay)
        contentView = glass
    }
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    func present(items: [TabItem], selected: Int, screen: NSScreen) {
        let count = max(1, items.count)
        let width = min(screen.visibleFrame.width - 56, CGFloat(count) * 168 + CGFloat(count - 1) * 10 + 44)
        let cardWidth = (width - 44 - CGFloat(count - 1) * 10) / CGFloat(count)
        let height = cardWidth * 0.625 + 166
        let rect = NSRect(x: screen.visibleFrame.midX - width / 2,
                          y: screen.visibleFrame.midY - height / 2, width: width, height: height)
        setFrame(rect, display: false)
        overlay.items = items
        overlay.selected = selected
        overlay.needsDisplay = true
        orderFrontRegardless()
        displayIfNeeded()
        NSAccessibility.post(element: overlay, notification: .valueChanged)
    }
}

// Covers Chrome's page area with the selected tab's large screenshot during a hold, and stays up
// after release until the real page has painted, so the switch appears to land on the preview.
final class PreviewPanel: NSPanel {
    private let imageLayer = CALayer()
    private var generation = 0

    init() {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 100, height: 100),
                   styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = true
        backgroundColor = .windowBackgroundColor
        hasShadow = false
        // One step below the card strip, which must always stay on top of the preview.
        level = NSWindow.Level(rawValue: NSWindow.Level.popUpMenu.rawValue - 1)
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        isReleasedWhenClosed = false
        hidesOnDeactivate = false
        ignoresMouseEvents = true
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 100, height: 100))
        view.wantsLayer = true
        imageLayer.contentsGravity = .resizeAspectFill
        imageLayer.masksToBounds = true
        imageLayer.frame = view.bounds
        imageLayer.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
        view.layer?.addSublayer(imageLayer)
        contentView = view
    }
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    func show(_ image: CGImage, frame: NSRect) {
        generation += 1
        CATransaction.begin(); CATransaction.setDisableActions(true)
        imageLayer.contents = image
        CATransaction.commit()
        alphaValue = 1
        setFrame(frame, display: false)
        orderFrontRegardless()
    }

    func fadeOut() {
        guard isVisible else { return }
        let fading = generation
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.12
            animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            guard let self, self.generation == fading else { return }
            self.hide()
        })
    }

    func hide() {
        generation += 1
        orderOut(nil)
        imageLayer.contents = nil
        alphaValue = 1
    }
}
