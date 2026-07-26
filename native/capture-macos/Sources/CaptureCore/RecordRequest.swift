import Foundation

struct RecordRequest: Codable {
    var sessionId: String
    var sessionRoot: String
    var cameraUniqueId: String
    var microphoneUniqueId: String?
    var video: VideoSettings
    var audio: AudioSettings?
    /// Preferred segment length in seconds (immutable finalized segments). Default 10.
    /// Shorter segments improve kill recovery: only the open segment is at risk.
    var segmentDurationSec: Double?
    /// Optional hard max duration; process stops after this if no stdin stop.
    var maxDurationSec: Double?
    /// When true, do not require a microphone (video-only masters).
    var videoOnly: Bool?
    /// Protocol-only path: no camera/mic open (for CI / environments without TCC parent).
    var dryRun: Bool?
    /// Prefer Linear PCM audio masters when true (default). AAC when false.
    var preferPcmAudio: Bool?

    struct VideoSettings: Codable {
        var width: Int
        var height: Int
        var frameRate: Double
    }

    struct AudioSettings: Codable {
        var sampleRate: Double
        var channelCount: Int
    }

    /// Default 10s segments; floor 5s so dry-run and short takes still rotate under load tests.
    var resolvedSegmentDurationSec: Double {
        let value = segmentDurationSec ?? 10
        return max(5, value)
    }

    var resolvedPreferPcmAudio: Bool {
        preferPcmAudio ?? true
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
