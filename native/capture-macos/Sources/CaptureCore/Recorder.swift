@preconcurrency import AVFoundation
import Foundation

/// Sample-buffer capture session with segmented masters.
/// Video: AVAssetWriter → master/segments/seg_NNN_video.mov
/// Audio: AVAssetWriter → master/segments/seg_NNN_audio.caf (PCM)
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

    private var isStopping = false
    private var isCancelled = false
    private var sessionRunning = false
    private var stopContinuation: CheckedContinuation<CaptureCoreExitCode, Never>?

    private let fileManager = FileManager.default
    private var segmentsDir: URL

    init(request: RecordRequest, protocolWriter: ProtocolWriter) throws {
        self.request = request
        self.protocolWriter = protocolWriter
        let root = URL(fileURLWithPath: request.sessionRoot, isDirectory: true)
        self.segmentsDir = root
            .appendingPathComponent("master", isDirectory: true)
            .appendingPathComponent("segments", isDirectory: true)
        super.init()
        try fileManager.createDirectory(at: segmentsDir, withIntermediateDirectories: true)
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
    private func runDryRun() async -> CaptureCoreExitCode {
        protocolWriter.log("dryRun: skipping AVCapture; exercising protocol + segment layout")
        protocolWriter.emit(type: "state", payload: ["state": "recording", "dryRun": true])
        let duration = min(request.maxDurationSec ?? 1, 2)
        let index = 0
        let videoURL = segmentsDir.appendingPathComponent(String(format: "seg_%03d_video.mov", index))
        let marker = "capture-core dry-run placeholder — not a real master\n"
        try? marker.write(to: videoURL, atomically: true, encoding: .utf8)
        protocolWriter.emit(
            type: "health",
            payload: [
                "state": "recording",
                "dryRun": true,
                "segmentIndex": 0,
                "diskFreeBytes": freeDiskBytes(at: segmentsDir) ?? -1,
            ]
        )
        try? await Task.sleep(nanoseconds: UInt64(max(0.2, duration) * 1_000_000_000))
        protocolWriter.emit(
            type: "segment_finalized",
            payload: [
                "segmentIndex": 0,
                "reason": "dry_run",
                "videoPath": videoURL.path,
            ]
        )
        let finishedPayload: [String: Any] = [
            "exitCode": 0,
            "cancelled": false,
            "segments": 1,
            "dryRun": true,
            "sessionRoot": request.sessionRoot,
            "status": "complete",
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
        var payload: [String: Any] = [
            "state": isStopping ? "stopping" : "recording",
            "segmentIndex": segmentIndex,
            "videoFrames": Int(videoFrames),
            "audioBuffers": Int(audioBuffers),
            "droppedVideo": Int(droppedVideo),
            "videoAppendFailures": Int(videoAppendFailures),
            "audioAppendFailures": Int(audioAppendFailures),
            "diskFreeBytes": diskFree,
        ]
        if let firstVideoPtsUs { payload["firstVideoPtsUs"] = firstVideoPtsUs }
        if let firstAudioPtsUs { payload["firstAudioPtsUs"] = firstAudioPtsUs }
        protocolWriter.emit(type: type, payload: payload)
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
        var best: AVCaptureDevice.Format?
        var bestScore = Double.greatestFiniteMagnitude
        for format in device.formats {
            let dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            let ranges = format.videoSupportedFrameRateRanges
            let maxFps = ranges.map(\.maxFrameRate).max() ?? 0
            guard maxFps + 0.1 >= min(targetFps, 30) else { continue }
            let score =
                abs(Double(dims.width - Int32(targetW))) +
                abs(Double(dims.height - Int32(targetH))) +
                abs(maxFps - targetFps) * 10
            if score < bestScore {
                bestScore = score
                best = format
            }
        }
        if let best {
            device.activeFormat = best
            let fps = min(targetFps, best.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? targetFps)
            let duration = CMTime(value: 1, timescale: CMTimeScale(max(1, Int32(fps.rounded()))))
            if device.activeFormat.videoSupportedFrameRateRanges.contains(where: {
                $0.minFrameRate <= fps && fps <= $0.maxFrameRate
            }) {
                device.activeVideoMinFrameDuration = duration
                device.activeVideoMaxFrameDuration = duration
            }
        }
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

        let vWriter = try AVAssetWriter(outputURL: videoURL, fileType: .mov)
        let vSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: request.video.width,
            AVVideoHeightKey: request.video.height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: max(2_000_000, request.video.width * request.video.height * 4),
                AVVideoExpectedSourceFrameRateKey: request.video.frameRate,
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
            // CAF + AAC is a stable sample-buffer path; PCM can be a later hardening step.
            let aWriter = try AVAssetWriter(outputURL: audioURL, fileType: .caf)
            let aSettings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: channels,
                AVEncoderBitRateKey: 128_000,
            ]
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
        } else {
            self.audioWriter = nil
            self.audioInput = nil
        }

        segmentStartedAt = CFAbsoluteTimeGetCurrent()
        protocolWriter.log("opened segment \(index) at \(videoURL.path)")
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

        var payload: [String: Any] = [
            "segmentIndex": index,
            "reason": reason,
        ]
        if let vURL { payload["videoPath"] = vURL.path }
        if let aURL { payload["audioPath"] = aURL.path }
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
                let payload: [String: Any] = [
                    "exitCode": Int(code.rawValue),
                    "cancelled": cancel,
                    "segments": self.segmentIndex + 1,
                    "videoFrames": self.videoFrames,
                    "audioBuffers": self.audioBuffers,
                    "sessionRoot": self.request.sessionRoot,
                    "status": cancel ? "cancelled" : "complete",
                ]
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
