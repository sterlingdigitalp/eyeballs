import Foundation

struct RecordRequest: Codable {
    var sessionId: String
    var sessionRoot: String
    var cameraUniqueId: String
    var microphoneUniqueId: String?
    var video: VideoSettings
    var audio: AudioSettings?
    /// Preferred segment length in seconds (immutable segments). Default 60.
    var segmentDurationSec: Double?
    /// Optional hard max duration; process stops after this if no stdin stop.
    var maxDurationSec: Double?
    /// When true, do not require a microphone (video-only masters).
    var videoOnly: Bool?
    /// Protocol-only path: no camera/mic open (for CI / environments without TCC parent).
    var dryRun: Bool?

    struct VideoSettings: Codable {
        var width: Int
        var height: Int
        var frameRate: Double
    }

    struct AudioSettings: Codable {
        var sampleRate: Double
        var channelCount: Int
    }

    var resolvedSegmentDurationSec: Double {
        let value = segmentDurationSec ?? 60
        return max(5, value)
    }
}

enum CaptureCoreExitCode: Int32 {
    case success = 0
    case genericFailure = 1
    case usage = 2
    case deviceNotFound = 3
    case writeFailed = 4
    case cancelled = 5
    case permissionDenied = 6
}
