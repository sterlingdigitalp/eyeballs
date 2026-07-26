@preconcurrency import AVFoundation
import Foundation

@main
struct CaptureCoreMain {
    static func main() async {
        let args = CommandLine.arguments
        guard args.count >= 2 else {
            FileHandle.standardError.write(
                Data(
                    """
                    Usage:
                      capture-core list-devices
                      capture-core record --request <request.json>

                    Protocol: JSONL on stdout; diagnostics on stderr.
                    Stdin commands during record: {"type":"stop"|"ping"|"cancel"}

                    """.utf8
                )
            )
            exit(CaptureCoreExitCode.usage.rawValue)
        }

        let command = args[1]
        switch command {
        case "list-devices":
            listDevices()
            exit(CaptureCoreExitCode.success.rawValue)
        case "record":
            guard args.count >= 4, args[2] == "--request" else {
                FileHandle.standardError.write(
                    Data("capture-core: record requires --request <path>\n".utf8)
                )
                exit(CaptureCoreExitCode.usage.rawValue)
            }
            let code = await record(requestPath: args[3])
            exit(code.rawValue)
        default:
            FileHandle.standardError.write(
                Data("capture-core: unknown command \(command)\n".utf8)
            )
            exit(CaptureCoreExitCode.usage.rawValue)
        }
    }

    private static func listDevices() {
        let cameras = AVCaptureDevice.DiscoverySession(
            deviceTypes: [
                .builtInWideAngleCamera,
                .externalUnknown,
            ],
            mediaType: .video,
            position: .unspecified
        ).devices
        let microphones = AVCaptureDevice.DiscoverySession(
            deviceTypes: [
                .builtInMicrophone,
                .externalUnknown,
            ],
            mediaType: .audio,
            position: .unspecified
        ).devices

        struct DeviceOut: Codable {
            let uniqueId: String
            let name: String
            let manufacturer: String
            let kind: String
        }
        struct Inventory: Codable {
            let protocolVersion: String
            let generatedAt: String
            let cameras: [DeviceOut]
            let microphones: [DeviceOut]
        }

        let inventory = Inventory(
            protocolVersion: CaptureProtocol.version,
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            cameras: cameras.map {
                DeviceOut(
                    uniqueId: $0.uniqueID,
                    name: $0.localizedName,
                    manufacturer: $0.manufacturer,
                    kind: "camera"
                )
            },
            microphones: microphones.map {
                DeviceOut(
                    uniqueId: $0.uniqueID,
                    name: $0.localizedName,
                    manufacturer: $0.manufacturer,
                    kind: "microphone"
                )
            }
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try! encoder.encode(inventory)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }

    private static func record(requestPath: String) async -> CaptureCoreExitCode {
        let url = URL(fileURLWithPath: requestPath)
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            FileHandle.standardError.write(
                Data("capture-core: cannot read request: \(error.localizedDescription)\n".utf8)
            )
            return .usage
        }
        let request: RecordRequest
        do {
            request = try JSONDecoder().decode(RecordRequest.self, from: data)
        } catch {
            FileHandle.standardError.write(
                Data("capture-core: invalid request JSON: \(error.localizedDescription)\n".utf8)
            )
            return .usage
        }

        let writer = ProtocolWriter(sessionId: request.sessionId)
        writer.log("sessionId=\(request.sessionId) root=\(request.sessionRoot)")
        do {
            let recorder = try CaptureRecorder(request: request, protocolWriter: writer)
            return await recorder.run()
        } catch {
            writer.emit(
                type: "error",
                error: ProtocolError(code: "init_failed", message: error.localizedDescription)
            )
            return .genericFailure
        }
    }
}
