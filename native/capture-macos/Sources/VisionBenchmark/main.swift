import AVFoundation
import CoreImage
import Foundation
import Vision

struct FrameResult: Codable {
    let schemaVersion: String
    let timestampUs: Int64
    let faceDetected: Bool
    let confidence: Float
    let blink: Bool
    let eyeYaw: Double
    let eyePitch: Double
    let headYaw: Double
    let headPitch: Double
    let headRoll: Double
    let faceScale: Double
    let analysisLatencyMs: Double
    let leftPupilX: Double?
    let leftPupilY: Double?
    let rightPupilX: Double?
    let rightPupilY: Double?
    let yaw: Double?
    let pitch: Double?
    let roll: Double?
    let latencyMs: Double
    let providerId: String
    let modelVersion: String
}

func point(_ region: VNFaceLandmarkRegion2D?) -> (Double?, Double?) {
    guard let region, region.pointCount > 0 else { return (nil, nil) }
    let values = region.normalizedPoints
    let x = values.reduce(0.0) { $0 + Double($1.x) } / Double(region.pointCount)
    let y = values.reduce(0.0) { $0 + Double($1.y) } / Double(region.pointCount)
    return (x, y)
}

func eyeAspectRatio(_ region: VNFaceLandmarkRegion2D?) -> Double? {
    guard let region, region.pointCount >= 4 else { return nil }
    let values = region.normalizedPoints
    guard
        let minX = values.map(\.x).min(),
        let maxX = values.map(\.x).max(),
        let minY = values.map(\.y).min(),
        let maxY = values.map(\.y).max()
    else { return nil }
    let width = Double(maxX - minX)
    guard width > 0.0001 else { return nil }
    return Double(maxY - minY) / width
}

guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--input" else {
    FileHandle.standardError.write(Data("Usage: vision-benchmark --input <video>\n".utf8))
    exit(2)
}

let url = URL(fileURLWithPath: CommandLine.arguments[2])
let asset = AVURLAsset(url: url)
guard let track = try await asset.loadTracks(withMediaType: .video).first else {
    FileHandle.standardError.write(Data("Input has no video track.\n".utf8))
    exit(3)
}
let reader = try AVAssetReader(asset: asset)
let output = AVAssetReaderTrackOutput(
    track: track,
    outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    ]
)
output.alwaysCopiesSampleData = false
reader.add(output)
reader.startReading()
let encoder = JSONEncoder()

while let sample = output.copyNextSampleBuffer() {
    autoreleasepool {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sample) else { return }
        let timestampUs = Int64(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) * 1_000_000)
        let request = VNDetectFaceLandmarksRequest()
        let started = CFAbsoluteTimeGetCurrent()
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up)
        do {
            try handler.perform([request])
            let face = request.results?.first
            let left = point(face?.landmarks?.leftPupil)
            let right = point(face?.landmarks?.rightPupil)
            let leftEyeAspect = eyeAspectRatio(face?.landmarks?.leftEye)
            let rightEyeAspect = eyeAspectRatio(face?.landmarks?.rightEye)
            let pupilsAvailable =
                left.0 != nil && left.1 != nil && right.0 != nil && right.1 != nil
            let blink = leftEyeAspect.map { $0 < 0.12 } == true &&
                rightEyeAspect.map { $0 < 0.12 } == true
            let eyeYaw = pupilsAvailable
                ? (((left.0! + right.0!) / 2.0) - 0.5) * 2.0
                : 0
            let eyePitch = pupilsAvailable
                ? (((left.1! + right.1!) / 2.0) - 0.5) * 2.0
                : 0
            let latencyMs = (CFAbsoluteTimeGetCurrent() - started) * 1_000
            let result = FrameResult(
                schemaVersion: "1.0.0",
                timestampUs: timestampUs,
                faceDetected: face != nil,
                confidence: face?.confidence ?? 0,
                blink: blink,
                eyeYaw: eyeYaw,
                eyePitch: eyePitch,
                headYaw: face?.yaw?.doubleValue ?? 0,
                headPitch: face?.pitch?.doubleValue ?? 0,
                headRoll: face?.roll?.doubleValue ?? 0,
                faceScale: face.map {
                    max(0.0001, sqrt(Double($0.boundingBox.width * $0.boundingBox.height)))
                } ?? 0.0001,
                analysisLatencyMs: latencyMs,
                leftPupilX: left.0,
                leftPupilY: left.1,
                rightPupilX: right.0,
                rightPupilY: right.1,
                yaw: face?.yaw?.doubleValue,
                pitch: face?.pitch?.doubleValue,
                roll: face?.roll?.doubleValue,
                latencyMs: latencyMs,
                providerId: "apple-vision",
                modelVersion: ProcessInfo.processInfo.operatingSystemVersionString
            )
            FileHandle.standardOutput.write(try encoder.encode(result))
            FileHandle.standardOutput.write(Data("\n".utf8))
        } catch {
            FileHandle.standardError.write(Data("Vision frame failed: \(error)\n".utf8))
        }
    }
}

if reader.status == .failed {
    FileHandle.standardError.write(Data("Reader failed: \(reader.error?.localizedDescription ?? "unknown")\n".utf8))
    exit(4)
}
