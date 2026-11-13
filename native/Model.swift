import Foundation

struct TabItem: Codable, Equatable {
    let id: Int
    let windowId: Int
    let title: String
    let url: String
    var preview: String?
    var discarded: Bool = false
    var audible: Bool = false

    var host: String {
        guard let u = URL(string: url) else { return "" }
        return u.host ?? u.scheme ?? ""
    }
}

struct SwitchSession {
    private(set) var items: [TabItem] = []
    private(set) var index = 0
    var isOpen: Bool { !items.isEmpty }
    var selected: TabItem? { items.indices.contains(index) ? items[index] : nil }

    mutating func begin(_ source: [TabItem], backward: Bool) {
        items = Array(source.prefix(7))
        index = items.count > 1 ? (backward ? items.count - 1 : 1) : 0
    }

    mutating func step(_ direction: Int) {
        guard !items.isEmpty else { return }
        index = ((index + direction) % items.count + items.count) % items.count
    }

    mutating func select(_ position: Int) {
        if items.indices.contains(position) { index = position }
    }

    // Metadata may update during a hold, but MRU order remains frozen.
    mutating func reconcile(_ source: [TabItem], liveIds: Set<Int>? = nil) {
        let selectedId = selected?.id
        let live = Dictionary(uniqueKeysWithValues: source.map { ($0.id, $0) })
        let alive = liveIds ?? Set(source.map(\.id))
        items = items.compactMap { alive.contains($0.id) ? (live[$0.id] ?? $0) : nil }
        if let selectedId, let position = items.firstIndex(where: { $0.id == selectedId }) {
            index = position
        } else { index = min(index, max(0, items.count - 1)) }
    }

    mutating func finish() -> Int? {
        let id = selected?.id
        cancel()
        return id
    }

    mutating func cancel() { items = []; index = 0 }
}

enum WireError: Error { case oversized, malformed }

// Only the most recent shortcut request may update the clipboard. Late replies
// after app/window changes or a newer request must not overwrite a later copy.
struct LinkCopyRequest {
    private var counter = 0
    private var pending: (id: String, started: TimeInterval)?

    mutating func begin(at time: TimeInterval) -> String {
        counter += 1
        let id = "copy-\(counter)"
        pending = (id, time)
        return id
    }

    mutating func accept(_ id: String, at time: TimeInterval) -> Bool {
        guard let request = pending, request.id == id else { return false }
        pending = nil
        return time - request.started <= 3
    }

    mutating func cancel() { pending = nil }
}

// Chrome native messaging: little-endian UInt32 length + UTF-8 JSON.
struct FrameDecoder {
    private var buffer = Data()
    mutating func append(_ bytes: Data) throws -> [Data] {
        buffer.append(bytes)
        var frames: [Data] = []
        while buffer.count >= 4 {
            let size = Int(buffer.prefix(4).enumerated().reduce(UInt32(0)) {
                $0 | UInt32($1.element) << (8 * $1.offset)
            })
            guard size > 0 && size <= 2_000_000 else { throw WireError.oversized }
            guard buffer.count >= size + 4 else { break }
            frames.append(Data(buffer.dropFirst(4).prefix(size)))
            buffer.removeFirst(size + 4)
        }
        return frames
    }
    var hasPartialFrame: Bool { !buffer.isEmpty }
}

func encodeFrame(_ object: [String: Any]) throws -> Data {
    let json = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    guard json.count <= 1_000_000 else { throw WireError.oversized }
    var length = UInt32(json.count).littleEndian
    var data = withUnsafeBytes(of: &length) { Data($0) }
    data.append(json)
    return data
}

// Where a captured viewport sits in a Chrome window, in top-left (CoreGraphics) screen coordinates:
// full window width, anchored to the window bottom, below the tab strip and toolbar.
func previewFrame(window: CGRect, image: CGSize, viewport: CGSize? = nil) -> CGRect {
    guard window.width > 0, window.height > 0, image.width > 0, image.height > 0 else { return .zero }
    // Chrome's page area sits in the window's bottom-right corner, beside a left-hand tab drawer.
    if let viewport, viewport.width > 0, viewport.height > 0 {
        let width = min(window.width, viewport.width), height = min(window.height, viewport.height)
        return CGRect(x: window.maxX - width, y: window.maxY - height, width: width, height: height)
    }
    let height = min(window.height, window.width * image.height / image.width)
    return CGRect(x: window.minX, y: window.maxY - height, width: window.width, height: height)
}

// A large preview is only valid for the page it was captured from.
struct FullPreview {
    let url: String
    let data: Data
}

func decodeFullPreview(_ value: String) -> Data? {
    let prefix = "data:image/jpeg;base64,"
    guard value.hasPrefix(prefix), value.utf8.count <= 620_000,
          let data = Data(base64Encoded: String(value.dropFirst(prefix.count))) else { return nil }
    return data
}
