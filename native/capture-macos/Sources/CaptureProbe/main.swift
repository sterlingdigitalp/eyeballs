import AVFoundation
import Foundation

struct FormatRecord: Codable {
    let width: Int32
    let height: Int32
    let minFrameRate: Double
    let maxFrameRate: Double
    let mediaSubType: String
}

struct DeviceRecord: Codable {
    let id: String
    let name: String
    let manufacturer: String
    let deviceType: String
    let connected: Bool
    let suspended: Bool
    let videoFormats: [FormatRecord]
    let audioFormats: [AudioFormatRecord]
}

struct AudioFormatRecord: Codable {
    let sampleRate: Double
    let channels: UInt32
    let bitsPerChannel: UInt32
    let formatId: String
}

struct Inventory: Codable {
    let generatedAt: String
    let cameras: [DeviceRecord]
    let microphones: [DeviceRecord]
}

func mediaSubtype(_ value: FourCharCode) -> String {
    let bytes: [UInt8] = [
        UInt8((value >> 24) & 0xff),
        UInt8((value >> 16) & 0xff),
        UInt8((value >> 8) & 0xff),
        UInt8(value & 0xff),
    ]
    return String(bytes: bytes, encoding: .macOSRoman) ?? String(value)
}

func record(
    _ device: AVCaptureDevice,
    includeVideoFormats: Bool,
    includeAudioFormats: Bool
) -> DeviceRecord {
    let videoFormats = includeVideoFormats ? device.formats.map { format -> FormatRecord in
        let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
        let ranges = format.videoSupportedFrameRateRanges
        return FormatRecord(
            width: dimensions.width,
            height: dimensions.height,
            minFrameRate: ranges.map(\.minFrameRate).min() ?? 0,
            maxFrameRate: ranges.map(\.maxFrameRate).max() ?? 0,
            mediaSubType: mediaSubtype(CMFormatDescriptionGetMediaSubType(format.formatDescription))
        )
    } : []
    let audioFormats = includeAudioFormats ? device.formats.compactMap { format -> AudioFormatRecord? in
        let description: CMAudioFormatDescription = format.formatDescription
        guard let pointer = CMAudioFormatDescriptionGetStreamBasicDescription(description)
        else { return nil }
        let stream = pointer.pointee
        return AudioFormatRecord(
            sampleRate: stream.mSampleRate,
            channels: stream.mChannelsPerFrame,
            bitsPerChannel: stream.mBitsPerChannel,
            formatId: mediaSubtype(stream.mFormatID)
        )
    } : []
    return DeviceRecord(
        id: device.uniqueID,
        name: device.localizedName,
        manufacturer: device.manufacturer,
        deviceType: device.deviceType.rawValue,
        connected: device.isConnected,
        suspended: device.isSuspended,
        videoFormats: videoFormats,
        audioFormats: audioFormats
    )
}

let cameraTypes: [AVCaptureDevice.DeviceType] = [
    .builtInWideAngleCamera,
    .externalUnknown,
]
let audioTypes: [AVCaptureDevice.DeviceType] = [
    .builtInMicrophone,
    .externalUnknown,
]
let cameras = AVCaptureDevice.DiscoverySession(
    deviceTypes: cameraTypes,
    mediaType: .video,
    position: .unspecified
).devices.map { record($0, includeVideoFormats: true, includeAudioFormats: false) }
let microphones = AVCaptureDevice.DiscoverySession(
    deviceTypes: audioTypes,
    mediaType: .audio,
    position: .unspecified
).devices.map { record($0, includeVideoFormats: false, includeAudioFormats: true) }
let formatter = ISO8601DateFormatter()
let inventory = Inventory(generatedAt: formatter.string(from: Date()), cameras: cameras, microphones: microphones)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
FileHandle.standardOutput.write(try encoder.encode(inventory))
FileHandle.standardOutput.write(Data("\n".utf8))
