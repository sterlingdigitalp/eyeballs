@preconcurrency import AVFoundation
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Sample-buffer capture session with segmented masters.
/// Video: AVAssetWriter → master/segments/seg_NNN_video.mov
/// Audio: AVAssetWriter → master/segments/seg_NNN_audio.caf (PCM)
/// Preview: low-rate JPEG under sessionRoot/preview/latest.jpg (Stage 5 framing only)
final class CaptureRecorder: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
    private let request: RecordRequest
    private let protocolWriter: ProtocolWriter
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "capture-core.session")
    private let writerQueue = DispatchQueue(label: "capture-core.writer")

    private var videoOutput: AVCaptureVideoDataOutput?
    private var audioOutput: AVCaptureAudioDataOutput?

    private var videoWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var audioWriter: AVAssetWriter?
    private var audioInput: AVAssetWriterInput?

    private var segmentIndex = 0
    private var segmentStartedAt: CFTimeInterval = 0
    private var recordingStartedAt: CFTimeInterval = 0
    private var firstVideoPtsUs: Int64?
    private var firstAudioPtsUs: Int64?

    private var videoFrames: UInt64 = 0
    private var audioBuffers: UInt64 = 0
    private var droppedVideo: UInt64 = 0
    private var videoAppendFailures: UInt64 = 0
    private var audioAppendFailures: UInt64 = 0

    /// Actual dimensions / fps after activeFormat selection (used by writers + health).
    private var negotiatedWidth: Int = 0
    private var negotiatedHeight: Int = 0
    private var negotiatedFrameRate: Double = 0
    private var finalizedSegmentCount: Int = 0

    // Stage 5 preview metrics
    private var previewSequence: UInt64 = 0
    private var previewFramesEmitted: UInt64 = 0
    private var lastPreviewAt: CFTimeInterval = 0
    private var lastPreviewEncodeMs: Double = 0
    private var lastPreviewJpegBytes: Int = 0
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])

    private var isStopping = false
    private var isCancelled = false
    private var sessionRunning = false
    private var stopContinuation: CheckedContinuation<CaptureCoreExitCode, Never>?

    private let fileManager = FileManager.default
    private var segmentsDir: URL
    private var previewDir: URL

    init(request: RecordRequest, protocolWriter: ProtocolWriter) throws {
        self.request = request
        self.protocolWriter = protocolWriter
        let root = URL(fileURLWithPath: request.sessionRoot, isDirectory: true)
        self.segmentsDir = root
            .appendingPathComponent("master", isDirectory: true)
            .appendingPathComponent("segments", isDirectory: true)
        self.previewDir = root.appendingPathComponent("preview", isDirectory: true)
        super.init()
        try fileManager.createDirectory(at: segmentsDir, withIntermediateDirectories: true)
        if request.resolvedPreviewEnabled {
            try fileManager.createDirectory(at: previewDir, withIntermediateDirectories: true)
        }
    }

    func run() async -> CaptureCoreExitCode {
        protocolWriter.emit(type: "state", payload: ["state": "starting"])
        if request.dryRun == true {
            return await runDryRun()
        }
        do {
            try await configureSession()
        } catch let error as CaptureSetupError {
            protocolWriter.emit(
                type: "error",
                error: ProtocolError(code: error.code, message: error.message)
            )
            protocolWriter.emit(type: "state", payload: ["state": "failed"])
            return error.exitCode
        } catch {
            protocolWriter.emit(
                type: "error",
                error: ProtocolError(code: "setup_failed", message: error.localizedDescription)
            )
            protocolWriter.emit(type: "state", payload: ["state": "failed"])
            return .genericFailure
        }

        let stdin = StdinCommandReader { [weak self] command in
            guard let self else { return }
            switch command.type.lowercased() {
            case "ping":
                self.emitHealth(type: "pong")
            case "stop":
                self.requestStop(cancel: false)
            case "cancel":
                self.requestStop(cancel: true)
            default:
                self.protocolWriter.log("unknown stdin command: \(command.type)")
            }
        }
        stdin.start()

        return await withCheckedContinuation { continuation in
            self.stopContinuation = continuation
            self.sessionQueue.async {
                self.session.startRunning()
                self.sessionRunning = true
                self.recordingStartedAt = CFAbsoluteTimeGetCurrent()
                self.segmentStartedAt = self.recordingStartedAt
                self.protocolWriter.emit(type: "state", payload: ["state": "recording"])
                self.emitHealth(type: "health")

                if let maxDuration = self.request.maxDurationSec, maxDuration > 0 {
                    self.sessionQueue.asyncAfter(deadline: .now() + maxDuration) {
                        self.requestStop(cancel: false)
                    }
                }

                // Periodic health
                self.scheduleHealthTimer()
            }
        }
    }

    /// Validates layout + protocol without TCC/camera (agent CI / dry-run).
    /// Emits multiple finalized segment placeholders when maxDuration > segment duration.
    private func runDryRun() async -> CaptureCoreExitCode {
        protocolWriter.log("dryRun: skipping AVCapture; exercising protocol + segment layout")
        protocolWriter.emit(type: "state", payload: ["state": "recording", "dryRun": true])
        let total = min(request.maxDurationSec ?? 1, 3)
        // Dry-run skips the 5s production floor so multi-segment protocol can be exercised quickly.
        let configuredSeg = request.segmentDurationSec ?? min(1.0, total)
        let segmentLen = min(max(0.25, configuredSeg), max(0.25, total))
        let segmentCount = max(1, Int(ceil(total / segmentLen - 1e-9)))
        if request.resolvedPreviewEnabled {
            emitDryRunPreviewPlaceholders(count: min(3, max(1, segmentCount)))
        }
        protocolWriter.emit(
            type: "health",
            payload: [
                "state": "recording",
                "dryRun": true,
                "segmentIndex": 0,
                "plannedSegments": segmentCount,
                "segmentDurationSec": segmentLen,
                "previewEnabled": request.resolvedPreviewEnabled,
                "previewMaxFps": request.resolvedPreviewMaxFps,
                "diskFreeBytes": freeDiskBytes(at: segmentsDir) ?? -1,
            ]
        )
        for index in 0..<segmentCount {
            let videoURL = segmentsDir.appendingPathComponent(String(format: "seg_%03d_video.mov", index))
            let marker =
                "capture-core dry-run placeholder seg=\(index) — not a real master\n"
            try? marker.write(to: videoURL, atomically: true, encoding: .utf8)
            try? await Task.sleep(nanoseconds: UInt64(max(0.05, min(0.25, segmentLen)) * 1_000_000_000))
            protocolWriter.emit(
                type: "segment_finalized",
                payload: [
                    "segmentIndex": index,
                    "reason": index + 1 < segmentCount ? "segment_duration" : "dry_run",
                    "videoPath": videoURL.path,
                    "dryRun": true,
                ]
            )
            finalizedSegmentCount += 1
        }
        let finishedPayload: [String: Any] = [
            "exitCode": 0,
            "cancelled": false,
            "segments": segmentCount,
            "dryRun": true,
            "sessionRoot": request.sessionRoot,
            "status": "complete",
            "segmentDurationSec": request.resolvedSegmentDurationSec,
        ]
        protocolWriter.emit(type: "recording_finished", payload: finishedPayload)
        writeSessionMarker(name: "recording-finished.json", payload: finishedPayload)
        protocolWriter.emit(type: "state", payload: ["state": "finished", "dryRun": true])
        return .success
    }

    /// On-disk session seal so Rust/Tauri orphan scan can distinguish complete vs incomplete.
    private func writeSessionMarker(name: String, payload: [String: Any]) {
        let root = URL(fileURLWithPath: request.sessionRoot, isDirectory: true)
        let url = root.appendingPathComponent(name)
        var body = payload
        body["protocolVersion"] = CaptureProtocol.version
        body["sessionId"] = request.sessionId
        body["writtenAt"] = ISO8601DateFormatter().string(from: Date())
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body, options: [.prettyPrinted, .sortedKeys])
        else {
            protocolWriter.log("failed to serialize \(name)")
            return
        }
        do {
            try data.write(to: url, options: .atomic)
            protocolWriter.log("wrote \(url.path)")
        } catch {
            protocolWriter.log("failed to write \(name): \(error.localizedDescription)")
        }
    }

    private func scheduleHealthTimer() {
        sessionQueue.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, self.sessionRunning, !self.isStopping else { return }
            self.emitHealth(type: "health")
            self.maybeRotateSegment()
            self.scheduleHealthTimer()
        }
    }

    private func emitHealth(type: String) {
        let diskFree = freeDiskBytes(at: segmentsDir) ?? -1
        let elapsed = max(0.001, CFAbsoluteTimeGetCurrent() - recordingStartedAt)
        let previewFps = Double(previewFramesEmitted) / elapsed
        var payload: [String: Any] = [
            "state": isStopping ? "stopping" : "recording",
            "segmentIndex": segmentIndex,
            "finalizedSegments": finalizedSegmentCount,
            "videoFrames": Int(videoFrames),
            "audioBuffers": Int(audioBuffers),
            "droppedVideo": Int(droppedVideo),
            "videoAppendFailures": Int(videoAppendFailures),
            "audioAppendFailures": Int(audioAppendFailures),
            "diskFreeBytes": diskFree,
            "negotiatedWidth": negotiatedWidth,
            "negotiatedHeight": negotiatedHeight,
            "negotiatedFrameRate": negotiatedFrameRate,
            "segmentDurationSec": request.resolvedSegmentDurationSec,
            "previewEnabled": request.resolvedPreviewEnabled,
            "previewMaxFps": request.resolvedPreviewMaxFps,
            "previewFrames": Int(previewFramesEmitted),
            "previewAchievedFps": previewFps,
            "lastPreviewEncodeMs": lastPreviewEncodeMs,
            "lastPreviewJpegBytes": lastPreviewJpegBytes,
        ]
        if let firstVideoPtsUs { payload["firstVideoPtsUs"] = firstVideoPtsUs }
        if let firstAudioPtsUs { payload["firstAudioPtsUs"] = firstAudioPtsUs }
        protocolWriter.emit(type: type, payload: payload)
    }

    /// Stage 5 dry-run: solid-color JPEGs so protocol + file transport can be tested without camera.
    private func emitDryRunPreviewPlaceholders(count: Int) {
        let width = min(request.resolvedPreviewMaxWidth, 320)
        let height = max(1, width * 9 / 16)
        for _ in 0..<count {
            let color = CIColor(red: 0.08, green: 0.22, blue: 0.18, alpha: 1)
            let image = CIImage(color: color).cropped(
                to: CGRect(x: 0, y: 0, width: width, height: height)
            )
            let started = CFAbsoluteTimeGetCurrent()
            if let path = writePreviewJPEG(ciImage: image) {
                let encodeMs = (CFAbsoluteTimeGetCurrent() - started) * 1000
                previewSequence += 1
                previewFramesEmitted += 1
                lastPreviewEncodeMs = encodeMs
                lastPreviewAt = CFAbsoluteTimeGetCurrent()
                if let attrs = try? fileManager.attributesOfItem(atPath: path),
                   let size = attrs[.size] as? NSNumber
                {
                    lastPreviewJpegBytes = size.intValue
                }
                protocolWriter.emit(
                    type: "preview_frame",
                    payload: [
                        "path": path,
                        "sequence": Int(previewSequence),
                        "width": width,
                        "height": height,
                        "jpegBytes": lastPreviewJpegBytes,
                        "encodeMs": encodeMs,
                        "previewMaxFps": request.resolvedPreviewMaxFps,
                        "transport": "file",
                        "dryRun": true,
                    ]
                )
            }
        }
    }

    /// Write atomic `preview/latest.jpg` from a CIImage; returns absolute path.
    private func writePreviewJPEG(ciImage: CIImage) -> String? {
        guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else {
            return nil
        }
        let finalURL = previewDir.appendingPathComponent("latest.jpg")
        let tempURL = previewDir.appendingPathComponent("latest.jpg.tmp")
        try? fileManager.removeItem(at: tempURL)
        guard let dest = CGImageDestinationCreateWithURL(
            tempURL as CFURL,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            return nil
        }
        let options: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: 0.55,
        ]
        CGImageDestinationAddImage(dest, cgImage, options as CFDictionary)
        guard CGImageDestinationFinalize(dest) else {
            try? fileManager.removeItem(at: tempURL)
            return nil
        }
        do {
            if fileManager.fileExists(atPath: finalURL.path) {
                _ = try fileManager.replaceItemAt(finalURL, withItemAt: tempURL)
            } else {
                try fileManager.moveItem(at: tempURL, to: finalURL)
            }
            return finalURL.path
        } catch {
            protocolWriter.log("preview write failed: \(error.localizedDescription)")
            try? fileManager.removeItem(at: tempURL)
            return nil
        }
    }

    private func maybeEmitPreview(from sampleBuffer: CMSampleBuffer) {
        guard request.resolvedPreviewEnabled, !isStopping else { return }
        let now = CFAbsoluteTimeGetCurrent()
        let minInterval = 1.0 / request.resolvedPreviewMaxFps
        guard now - lastPreviewAt >= minInterval else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let started = now
        var image = CIImage(cvPixelBuffer: pixelBuffer)
        let maxW = CGFloat(request.resolvedPreviewMaxWidth)
        let extent = image.extent
        if extent.width > maxW, extent.width > 1 {
            let scale = maxW / extent.width
            image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        }
        guard let path = writePreviewJPEG(ciImage: image) else { return }
        let encodeMs = (CFAbsoluteTimeGetCurrent() - started) * 1000
        previewSequence += 1
        previewFramesEmitted += 1
        lastPreviewAt = CFAbsoluteTimeGetCurrent()
        lastPreviewEncodeMs = encodeMs
        var jpegBytes = 0
        if let attrs = try? fileManager.attributesOfItem(atPath: path),
           let size = attrs[.size] as? NSNumber
        {
            jpegBytes = size.intValue
            lastPreviewJpegBytes = jpegBytes
        }
        let outW = Int(image.extent.width.rounded())
        let outH = Int(image.extent.height.rounded())
        protocolWriter.emit(
            type: "preview_frame",
            payload: [
                "path": path,
                "sequence": Int(previewSequence),
                "width": outW,
                "height": outH,
                "jpegBytes": jpegBytes,
                "encodeMs": encodeMs,
                "previewMaxFps": request.resolvedPreviewMaxFps,
                "transport": "file",
                "videoFrameIndex": Int(videoFrames),
            ]
        )
    }

    private enum CaptureSetupError: Error {
        case deviceNotFound(String)
        case permissionDenied(String)
        case configuration(String)

        var code: String {
            switch self {
            case .deviceNotFound: return "device_not_found"
            case .permissionDenied: return "permission_denied"
            case .configuration: return "configuration_failed"
            }
        }

        var message: String {
            switch self {
            case .deviceNotFound(let id): return "Device not found: \(id)"
            case .permissionDenied(let kind): return "Permission denied for \(kind)"
            case .configuration(let msg): return msg
            }
        }

        var exitCode: CaptureCoreExitCode {
            switch self {
            case .deviceNotFound: return .deviceNotFound
            case .permissionDenied: return .permissionDenied
            case .configuration: return .genericFailure
            }
        }
    }

    private func configureSession() async throws {
        protocolWriter.log("configure: checking video authorization")
        protocolWriter.log(
            "configure: bundlePath=\(Bundle.main.bundlePath) cameraUsage=\(String(describing: Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription")))"
        )
        let videoStatus = AVCaptureDevice.authorizationStatus(for: .video)
        protocolWriter.log("configure: videoStatus=\(videoStatus.rawValue)")
        if videoStatus == .notDetermined {
            guard Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil else {
                throw CaptureSetupError.configuration(
                    "NSCameraUsageDescription missing from Bundle.main — run the CaptureCore.app binary packaged by scripts/package-capture-core-app.sh, not the raw .build product"
                )
            }
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            if !granted { throw CaptureSetupError.permissionDenied("video") }
        } else if videoStatus != .authorized {
            throw CaptureSetupError.permissionDenied("video")
        }

        if request.videoOnly != true, request.microphoneUniqueId != nil {
            protocolWriter.log("configure: checking audio authorization")
            let audioStatus = AVCaptureDevice.authorizationStatus(for: .audio)
            if audioStatus == .notDetermined {
                let granted = await AVCaptureDevice.requestAccess(for: .audio)
                if !granted { throw CaptureSetupError.permissionDenied("audio") }
            } else if audioStatus != .authorized {
                throw CaptureSetupError.permissionDenied("audio")
            }
        }

        protocolWriter.log("configure: resolving camera \(request.cameraUniqueId)")
        session.beginConfiguration()
        // macOS: leave preset default; activeFormat on the device selects resolution/fps.

        guard let camera = AVCaptureDevice(uniqueID: request.cameraUniqueId) else {
            throw CaptureSetupError.deviceNotFound(request.cameraUniqueId)
        }
        protocolWriter.log("configure: camera=\(camera.localizedName)")
        try configureCamera(camera)
        protocolWriter.log("configure: adding video input")
        let videoDeviceInput = try AVCaptureDeviceInput(device: camera)
        guard session.canAddInput(videoDeviceInput) else {
            throw CaptureSetupError.configuration("Cannot add video input")
        }
        session.addInput(videoDeviceInput)

        protocolWriter.log("configure: adding video output")
        let videoOut = AVCaptureVideoDataOutput()
        videoOut.alwaysDiscardsLateVideoFrames = true
        videoOut.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        ]
        videoOut.setSampleBufferDelegate(self, queue: writerQueue)
        guard session.canAddOutput(videoOut) else {
            throw CaptureSetupError.configuration("Cannot add video output")
        }
        session.addOutput(videoOut)
        self.videoOutput = videoOut

        if request.videoOnly != true, let micId = request.microphoneUniqueId, !micId.isEmpty {
            protocolWriter.log("configure: adding microphone \(micId)")
            guard let mic = AVCaptureDevice(uniqueID: micId) else {
                throw CaptureSetupError.deviceNotFound(micId)
            }
            let audioDeviceInput = try AVCaptureDeviceInput(device: mic)
            guard session.canAddInput(audioDeviceInput) else {
                throw CaptureSetupError.configuration("Cannot add audio input")
            }
            session.addInput(audioDeviceInput)
            let audioOut = AVCaptureAudioDataOutput()
            audioOut.setSampleBufferDelegate(self, queue: writerQueue)
            guard session.canAddOutput(audioOut) else {
                throw CaptureSetupError.configuration("Cannot add audio output")
            }
            session.addOutput(audioOut)
            self.audioOutput = audioOut
        }

        session.commitConfiguration()
        protocolWriter.log("configure: opening writers")
        try openSegmentWriters()
        protocolWriter.log("configure: complete")
    }

    private func configureCamera(_ device: AVCaptureDevice) throws {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        let targetW = request.video.width
        let targetH = request.video.height
        let targetFps = request.video.frameRate

        struct Candidate {
            let format: AVCaptureDevice.Format
            let width: Int32
            let height: Int32
            let supportsTargetFps: Bool
            let bestFpsInRange: Double
            let score: Double
        }

        var candidates: [Candidate] = []
        for format in device.formats {
            let dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            let ranges = format.videoSupportedFrameRateRanges
            guard !ranges.isEmpty else { continue }
            let supportsTarget = ranges.contains {
                $0.minFrameRate - 0.05 <= targetFps && targetFps <= $0.maxFrameRate + 0.05
            }
            let maxFps = ranges.map(\.maxFrameRate).max() ?? 0
            let bestFps: Double
            if supportsTarget {
                bestFps = targetFps
            } else {
                // Closest max frame rate at or below target (prefer not to overclock).
                bestFps = ranges.map(\.maxFrameRate).filter { $0 <= targetFps + 0.05 }.max() ?? maxFps
            }
            // Prefer exact resolution + target fps; heavily penalize missing target fps.
            let dimScore =
                abs(Double(dims.width - Int32(targetW))) +
                abs(Double(dims.height - Int32(targetH)))
            let fpsPenalty = supportsTarget ? 0.0 : 50_000.0 + abs(bestFps - targetFps) * 100
            let score = dimScore + fpsPenalty
            candidates.append(
                Candidate(
                    format: format,
                    width: dims.width,
                    height: dims.height,
                    supportsTargetFps: supportsTarget,
                    bestFpsInRange: bestFps,
                    score: score
                )
            )
        }

        // Prefer candidates that support target fps; among them lowest score.
        let ordered = candidates.sorted { a, b in
            if a.supportsTargetFps != b.supportsTargetFps {
                return a.supportsTargetFps && !b.supportsTargetFps
            }
            return a.score < b.score
        }
        guard let pick = ordered.first else {
            negotiatedWidth = targetW
            negotiatedHeight = targetH
            negotiatedFrameRate = targetFps
            protocolWriter.log("configure: no camera formats matched; leaving device defaults")
            return
        }

        // Select activeFormat only. Do NOT set activeVideoMin/MaxFrameDuration on UVC/DAL
        // devices (Logitech BRIO): invalid durations throw NSException → process abort(),
        // and Swift `try` cannot catch that. Delivery fps is verified via health/ffprobe.
        device.activeFormat = pick.format
        negotiatedWidth = Int(pick.width)
        negotiatedHeight = Int(pick.height)
        let rangeMax =
            device.activeFormat.videoSupportedFrameRateRanges.map(\.maxFrameRate).max()
            ?? pick.bestFpsInRange
        let rangeMin =
            device.activeFormat.videoSupportedFrameRateRanges.map(\.minFrameRate).min()
            ?? pick.bestFpsInRange
        // Report the fps we expect the format to run near (clamped desired into range).
        negotiatedFrameRate = min(max(pick.bestFpsInRange, rangeMin), rangeMax)
        protocolWriter.log(
            "configure: activeFormat \(negotiatedWidth)x\(negotiatedHeight) range \(String(format: "%.2f", rangeMin))–\(String(format: "%.2f", rangeMax)) fps, expected ~\(String(format: "%.2f", negotiatedFrameRate)) (requested \(targetW)x\(targetH)@\(targetFps), supportsTargetFps=\(pick.supportsTargetFps)); frame-duration lock skipped for UVC safety"
        )
    }

    private func openSegmentWriters() throws {
        let index = segmentIndex
        let videoURL = segmentsDir.appendingPathComponent(
            String(format: "seg_%03d_video.mov", index)
        )
        let audioURL = segmentsDir.appendingPathComponent(
            String(format: "seg_%03d_audio.caf", index)
        )
        if fileManager.fileExists(atPath: videoURL.path) {
            try fileManager.removeItem(at: videoURL)
        }
        if fileManager.fileExists(atPath: audioURL.path) {
            try fileManager.removeItem(at: audioURL)
        }

        let width = negotiatedWidth > 0 ? negotiatedWidth : request.video.width
        let height = negotiatedHeight > 0 ? negotiatedHeight : request.video.height
        let frameRate = negotiatedFrameRate > 0 ? negotiatedFrameRate : request.video.frameRate

        let vWriter = try AVAssetWriter(outputURL: videoURL, fileType: .mov)
        // Fragmented movies improve partial readability after hard kill of the open segment.
        vWriter.movieFragmentInterval = CMTime(seconds: 2.0, preferredTimescale: 600)
        let vSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: max(2_000_000, width * height * 4),
                AVVideoExpectedSourceFrameRateKey: frameRate,
            ],
        ]
        let vInput = AVAssetWriterInput(mediaType: .video, outputSettings: vSettings)
        vInput.expectsMediaDataInRealTime = true
        guard vWriter.canAdd(vInput) else {
            throw CaptureSetupError.configuration("Cannot add video writer input")
        }
        vWriter.add(vInput)
        guard vWriter.startWriting() else {
            throw CaptureSetupError.configuration(
                vWriter.error?.localizedDescription ?? "video writer start failed"
            )
        }
        self.videoWriter = vWriter
        self.videoInput = vInput

        if audioOutput != nil {
            let sampleRate = request.audio?.sampleRate ?? 48_000
            let channels = max(1, request.audio?.channelCount ?? 1)
            let aWriter = try AVAssetWriter(outputURL: audioURL, fileType: .caf)
            let aSettings: [String: Any]
            if request.resolvedPreferPcmAudio {
                aSettings = [
                    AVFormatIDKey: kAudioFormatLinearPCM,
                    AVSampleRateKey: sampleRate,
                    AVNumberOfChannelsKey: channels,
                    AVLinearPCMBitDepthKey: 16,
                    AVLinearPCMIsFloatKey: false,
                    AVLinearPCMIsBigEndianKey: false,
                    AVLinearPCMIsNonInterleaved: false,
                ]
            } else {
                aSettings = [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVSampleRateKey: sampleRate,
                    AVNumberOfChannelsKey: channels,
                    AVEncoderBitRateKey: 128_000,
                ]
            }
            let aInput = AVAssetWriterInput(mediaType: .audio, outputSettings: aSettings)
            aInput.expectsMediaDataInRealTime = true
            guard aWriter.canAdd(aInput) else {
                throw CaptureSetupError.configuration("Cannot add audio writer input")
            }
            aWriter.add(aInput)
            guard aWriter.startWriting() else {
                throw CaptureSetupError.configuration(
                    aWriter.error?.localizedDescription ?? "audio writer start failed"
                )
            }
            self.audioWriter = aWriter
            self.audioInput = aInput
            protocolWriter.log(
                "opened audio segment \(index) pcm=\(request.resolvedPreferPcmAudio) \(sampleRate)Hz ch=\(channels)"
            )
        } else {
            self.audioWriter = nil
            self.audioInput = nil
        }

        segmentStartedAt = CFAbsoluteTimeGetCurrent()
        protocolWriter.log("opened segment \(index) at \(videoURL.path) \(width)x\(height)@\(frameRate)")
    }

    private func maybeRotateSegment() {
        let elapsed = CFAbsoluteTimeGetCurrent() - segmentStartedAt
        guard elapsed >= request.resolvedSegmentDurationSec, !isStopping else { return }
        writerQueue.async {
            self.rotateSegmentLocked()
        }
    }

    private func rotateSegmentLocked() {
        guard !isStopping else { return }
        finalizeCurrentSegmentLocked(reason: "segment_duration")
        segmentIndex += 1
        do {
            try openSegmentWriters()
            // Reset session start times for new writers on next buffers
            firstVideoPtsUs = nil
            firstAudioPtsUs = nil
        } catch {
            protocolWriter.emit(
                type: "error",
                error: ProtocolError(code: "segment_rotate_failed", message: error.localizedDescription)
            )
            requestStop(cancel: false)
        }
    }

    private func finalizeCurrentSegmentLocked(reason: String) {
        let index = segmentIndex
        let vURL = videoWriter?.outputURL
        let aURL = audioWriter?.outputURL
        // No writers yet (failed open) — nothing to finalize.
        guard videoWriter != nil || audioWriter != nil else { return }

        videoInput?.markAsFinished()
        audioInput?.markAsFinished()

        let group = DispatchGroup()
        if let videoWriter {
            group.enter()
            videoWriter.finishWriting {
                group.leave()
            }
        }
        if let audioWriter {
            group.enter()
            audioWriter.finishWriting {
                group.leave()
            }
        }
        group.wait()

        finalizedSegmentCount += 1
        var payload: [String: Any] = [
            "segmentIndex": index,
            "reason": reason,
            "finalizedSegments": finalizedSegmentCount,
            "negotiatedWidth": negotiatedWidth,
            "negotiatedHeight": negotiatedHeight,
            "negotiatedFrameRate": negotiatedFrameRate,
        ]
        if let vURL {
            payload["videoPath"] = vURL.path
            if let attrs = try? fileManager.attributesOfItem(atPath: vURL.path),
               let size = attrs[.size] as? NSNumber
            {
                payload["videoByteLength"] = size.intValue
            }
        }
        if let aURL {
            payload["audioPath"] = aURL.path
            if let attrs = try? fileManager.attributesOfItem(atPath: aURL.path),
               let size = attrs[.size] as? NSNumber
            {
                payload["audioByteLength"] = size.intValue
            }
        }
        if let firstVideoPtsUs { payload["firstVideoPtsUs"] = firstVideoPtsUs }
        if let firstAudioPtsUs { payload["firstAudioPtsUs"] = firstAudioPtsUs }
        protocolWriter.emit(type: "segment_finalized", payload: payload)

        self.videoWriter = nil
        self.videoInput = nil
        self.audioWriter = nil
        self.audioInput = nil
    }

    private func requestStop(cancel: Bool) {
        sessionQueue.async {
            guard !self.isStopping else { return }
            self.isStopping = true
            self.isCancelled = cancel
            self.protocolWriter.emit(
                type: "state",
                payload: ["state": "stopping", "cancel": cancel]
            )
            self.session.stopRunning()
            self.sessionRunning = false
            self.writerQueue.async {
                self.finalizeCurrentSegmentLocked(reason: cancel ? "cancel" : "stop")
                let code: CaptureCoreExitCode = cancel ? .cancelled : .success
                let wallSec = max(0.001, CFAbsoluteTimeGetCurrent() - self.recordingStartedAt)
                let measuredFps = Double(self.videoFrames) / wallSec
                var payload: [String: Any] = [
                    "exitCode": Int(code.rawValue),
                    "cancelled": cancel,
                    "segments": self.segmentIndex + 1,
                    "finalizedSegments": self.finalizedSegmentCount,
                    "videoFrames": self.videoFrames,
                    "audioBuffers": self.audioBuffers,
                    "droppedVideo": self.droppedVideo,
                    "sessionRoot": self.request.sessionRoot,
                    "status": cancel ? "cancelled" : "complete",
                    // Stage 6 honesty fields
                    "negotiatedWidth": self.negotiatedWidth,
                    "negotiatedHeight": self.negotiatedHeight,
                    "negotiatedFrameRate": self.negotiatedFrameRate,
                    "requestedWidth": self.request.video.width,
                    "requestedHeight": self.request.video.height,
                    "requestedFrameRate": self.request.video.frameRate,
                    "segmentDurationSec": self.request.resolvedSegmentDurationSec,
                    "wallDurationSec": wallSec,
                    "measuredVideoFps": measuredFps,
                    "videoCodec": "h264",
                    "preferPcmAudio": self.request.resolvedPreferPcmAudio,
                    "previewFrames": self.previewFramesEmitted,
                ]
                if let vPts = self.firstVideoPtsUs { payload["firstVideoPtsUs"] = vPts }
                if let aPts = self.firstAudioPtsUs { payload["firstAudioPtsUs"] = aPts }
                if let vPts = self.firstVideoPtsUs, let aPts = self.firstAudioPtsUs {
                    payload["avInitialOffsetUs"] = aPts - vPts
                }
                self.protocolWriter.emit(type: "recording_finished", payload: payload)
                self.writeSessionMarker(name: "recording-finished.json", payload: payload)
                if cancel {
                    self.writeSessionMarker(name: "recording-cancelled.json", payload: payload)
                }
                self.protocolWriter.emit(
                    type: "state",
                    payload: ["state": cancel ? "failed" : "finished"]
                )
                self.stopContinuation?.resume(returning: code)
                self.stopContinuation = nil
            }
        }
    }

    // MARK: - Sample buffers

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard !isStopping else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let ptsUs = Int64(CMTimeGetSeconds(pts) * 1_000_000)

        if output === videoOutput {
            videoFrames += 1
            if firstVideoPtsUs == nil {
                firstVideoPtsUs = ptsUs
                videoWriter?.startSession(atSourceTime: pts)
                if audioWriter != nil, firstAudioPtsUs == nil {
                    // audio session may start on first audio buffer
                }
            }
            // Stage 5: low-rate framing preview (file transport; never full-rate base64).
            maybeEmitPreview(from: sampleBuffer)
            guard let input = videoInput, input.isReadyForMoreMediaData else {
                droppedVideo += 1
                return
            }
            if !input.append(sampleBuffer) {
                videoAppendFailures += 1
            }
        } else if output === audioOutput {
            audioBuffers += 1
            if firstAudioPtsUs == nil {
                firstAudioPtsUs = ptsUs
                if let videoWriter, videoWriter.status == .writing {
                    // align audio session to first audio pts if video already started
                    audioWriter?.startSession(atSourceTime: pts)
                } else {
                    audioWriter?.startSession(atSourceTime: pts)
                }
            }
            guard let input = audioInput, input.isReadyForMoreMediaData else {
                return
            }
            if !input.append(sampleBuffer) {
                audioAppendFailures += 1
            }
        }
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didDrop sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        if output === videoOutput {
            droppedVideo += 1
        }
    }
}

private func freeDiskBytes(at url: URL) -> Int64? {
    let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
    if let capacity = values?.volumeAvailableCapacityForImportantUsage {
        return capacity
    }
    let attrs = try? FileManager.default.attributesOfFileSystem(forPath: url.path)
    return attrs?[.systemFreeSize] as? Int64
}
