import Foundation

/// CaptureCore JSONL protocol v1 (charter).
enum CaptureProtocol {
    static let version = "1.0.0"
}

struct ProtocolEnvelope: Codable {
    var protocolVersion: String
    var sessionId: String
    var sequence: UInt64
    var timestampUs: Int64
    var type: String
    var payload: [String: AnyCodable]?
    var error: ProtocolError?

    init(
        sessionId: String,
        sequence: UInt64,
        type: String,
        payload: [String: AnyCodable]? = nil,
        error: ProtocolError? = nil
    ) {
        self.protocolVersion = CaptureProtocol.version
        self.sessionId = sessionId
        self.sequence = sequence
        self.timestampUs = Int64(Date().timeIntervalSince1970 * 1_000_000)
        self.type = type
        self.payload = payload
        self.error = error
    }
}

struct ProtocolError: Codable {
    var code: String
    var message: String
}

/// Minimal type-erased JSON value for flexible payloads.
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encode(String(describing: value))
        }
    }
}

final class ProtocolWriter {
    private let sessionId: String
    private var sequence: UInt64 = 0
    private let lock = NSLock()
    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    init(sessionId: String) {
        self.sessionId = sessionId
    }

    func emit(type: String, payload: [String: Any]? = nil, error: ProtocolError? = nil) {
        lock.lock()
        defer { lock.unlock() }
        sequence += 1
        let mapped = payload?.mapValues { AnyCodable($0) }
        let envelope = ProtocolEnvelope(
            sessionId: sessionId,
            sequence: sequence,
            type: type,
            payload: mapped,
            error: error
        )
        guard let data = try? encoder.encode(envelope),
              let line = String(data: data, encoding: .utf8)
        else {
            FileHandle.standardError.write(Data("capture-core: failed to encode protocol event\n".utf8))
            return
        }
        // Protocol events only on stdout.
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
        fflush(stdout)
    }

    func log(_ message: String) {
        // Diagnostics exclusively on stderr.
        FileHandle.standardError.write(Data("capture-core: \(message)\n".utf8))
    }
}

struct StdinCommand: Codable {
    var type: String
    var sessionId: String?
    var protocolVersion: String?
}

final class StdinCommandReader {
    private let onCommand: (StdinCommand) -> Void
    private var thread: Thread?

    init(onCommand: @escaping (StdinCommand) -> Void) {
        self.onCommand = onCommand
    }

    func start() {
        let thread = Thread { [onCommand] in
            let decoder = JSONDecoder()
            while let line = readLine(strippingNewline: true) {
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty, let lineData = trimmed.data(using: .utf8) else { continue }
                if let command = try? decoder.decode(StdinCommand.self, from: lineData) {
                    onCommand(command)
                }
            }
            // EOF: treat as stop so the process does not hang forever.
            onCommand(StdinCommand(type: "stop", sessionId: nil, protocolVersion: nil))
        }
        thread.name = "capture-core-stdin"
        thread.start()
        self.thread = thread
    }
}
