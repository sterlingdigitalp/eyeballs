import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Calibration,
  CalibrationTarget,
  CaptureProfile,
  ClipCandidate,
  ConsentRecord,
  Correction,
  CueEvent,
  DatasetIntent,
  DeviceInventory,
  DrillDefinition,
  FeatureFlags,
  FeatureVector,
  FeedbackIntensity,
  GazeEvent,
  GazePrediction,
  GazeState,
  RecordingAsset,
  ReviewBookmark,
  ReviewClip,
  SentenceBoundary,
  SessionManifest,
  TranscriptDocument,
  TranscriptWord,
} from "../../../packages/contracts/src";
import {
  gazePredictionSchema,
  transcriptDocumentSchema,
} from "../../../packages/contracts/src";
import {
  ALGORITHM_VERSION,
  classifyFrame,
  trainClassifier,
} from "../../../packages/measurement/src/classifier";
import {
  calibrationFingerprint,
  calibrationInvalidationReason,
  calibrationQualityGate,
  evaluateHeldOutCalibration,
  scoreCalibration,
  scoreCalibrationTargets,
  selectActiveCalibration,
} from "../../../packages/measurement/src/calibration";
import { MeasurementPipeline } from "../../../packages/measurement/src/pipeline";
import {
  calculateEventTiming,
  calculateConfusionMatrix,
  sessionRelativeSecondsToUs,
} from "../../../packages/measurement/src/evaluation";
import {
  predictionAtPlaybackTime,
  predictionTimelineSegments,
  rebasePredictionTimestamps,
} from "../../../packages/measurement/src/playback";
import {
  recordingFinalization,
  recoverInterruptedSession,
} from "../../../packages/measurement/src/recovery";
import {
  applyReflectionToSession,
  beginCountdown,
  buildCoachedManifest,
  buildReviewLanes,
  buildSessionReport,
  contactColor,
  createTrainSession,
  defaultRecordingIntent,
  drillFromOutline,
  emergencyStop,
  FeedbackPolicyEngine,
  finishReflection,
  getDrillById,
  HANDS_FREE_SETTLE_SECONDS,
  keyboardSeekSeconds,
  loadBuiltinDrills,
  noteWindowsFromDrill,
  rateSessionCue,
  requestStop,
  reviseOutlineDrill,
  REVIEW_TIMELINE_ZOOM_LEVELS,
  restartSafeRecordingFlag,
  seekSecondsFromTimelineUs,
  segmentPercentInViewport,
  shouldAutoCompleteHandsFreeDrill,
  speakingSeconds,
  tickActive,
  tickCountdown,
  timelineViewport,
  timestampPercentInViewport,
  type ReviewTimelineZoom,
  type TrainSessionState,
} from "../../../packages/coaching/src";
import {
  applySentenceBoundaryCorrections,
  applyTranscriptWordTextCorrection,
  attachDatasetIntent,
  detectSpeechStructure,
  evaluatePreflight,
  materializeTranscript,
  proposeSegments,
} from "../../../packages/dataset/src";
import {
  DrillSetupForm,
  CustomDrillImport,
  LensAdjacentPromptOverlay,
  ReflectionForm,
  RecordingPrivacyBadge,
  TrainActiveChrome,
} from "./coaching/TrainPanel";
import { useBuiltinDrills } from "./coaching/useBuiltinDrills";
import { useSpeakingVad } from "./coaching/useSpeakingVad";
import {
  readCurrentDisplayPlacement,
  useCurrentDisplayPlacement,
} from "./coaching/useCurrentDisplayPlacement";
import {
  cancelCoachingAudio,
  playCoachingTone,
  prepareHandsFreeDrill,
} from "./coaching/coaching-audio";
import { ProgressPanel } from "./coaching/ProgressPanel";
import { LiveAssistHud } from "./coaching/LiveAssistHud";
import { ConsentPanel } from "./dataset/ConsentPanel";
import { CuratePanel } from "./dataset/CuratePanel";
import { DatasetPanel } from "./dataset/DatasetPanel";
import {
  describeMediaError,
  enumerateDevices,
  negotiatedProfile,
  reconcileProfileLabels,
  requestCamera,
  requestMicrophone,
  stopMediaStream,
  suggestProfiles,
} from "./lib/devices";
import { store, type StoredSession } from "./lib/store";
import { appendTranscriptRevision } from "./lib/session-store";
import { sampleVideoBrightness, type BrightnessAssessment } from "./lib/frame-quality";
import { audioMeterPercent, rmsDbfs } from "./lib/audio-level";
import { promptPlacementIssue as getPromptPlacementIssue } from "./lib/display-placement";
import {
  DEFAULT_FEATURE_FLAGS,
  parseFeatureFlags,
} from "./lib/feature-flags";
import {
  CALIBRATION_GUIDES,
  calibrationGuidePoint,
} from "./lib/calibration-guide";
import {
  CALIBRATION_PROTOCOL_VERSION,
  QUICK_LENS_VERIFICATION_STEPS,
  shuffledValidationSteps,
  TRAINING_CALIBRATION_STEPS,
  type CalibrationProtocolStep,
} from "./lib/calibration-protocol";
import { logEvent } from "./lib/logging";
import {
  MEDIAPIPE_TRACKER_ID,
  MEDIAPIPE_TRACKER_VERSION,
  MediaPipeTrackingProvider,
} from "./tracking/mediapipe";
import {
  unknownFeature,
  VideoFrameWatchdog,
  type TrackingProvider,
} from "./tracking/provider";
import "./styles.css";

type Page =
  | "setup"
  | "calibrate"
  | "measure"
  | "review"
  | "progress"
  | "consent"
  | "curate"
  | "dataset";
const NO_MICROPHONE_ID = "__none__";
const SESSION_CHECKPOINT_INTERVAL_US = 5_000_000;
const VIDEO_MODE_OPTIONS: Array<{
  label: string;
  value: string;
  requestedVideo: CaptureProfile["requestedVideo"];
}> = [
  {
    label: "1280×720 · 30 fps",
    value: "1280x720@30",
    requestedVideo: { width: 1280, height: 720, frameRate: 30 },
  },
  {
    label: "1920×1080 · 30 fps",
    value: "1920x1080@30",
    requestedVideo: { width: 1920, height: 1080, frameRate: 30 },
  },
  {
    label: "1920×1080 · 60 fps",
    value: "1920x1080@60",
    requestedVideo: { width: 1920, height: 1080, frameRate: 60 },
  },
  {
    label: "3840×2160 · 30 fps",
    value: "3840x2160@30",
    requestedVideo: { width: 3840, height: 2160, frameRate: 30 },
  },
];

const videoModeValue = (requested: CaptureProfile["requestedVideo"]) =>
  `${requested.width}x${requested.height}@${requested.frameRate}`;

const stateLabel: Record<GazeState, string> = {
  contact: "Camera contact",
  near_lens: "Near lens",
  off_lens: "Away from lens",
  unknown: "Tracking uncertain",
};

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function useTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onFeature: (value: FeatureVector) => void,
) {
  const providerRef = useRef<TrackingProvider | undefined>(undefined);
  const callbackRef = useRef(onFeature);
  const [error, setError] = useState<string>();
  useEffect(() => {
    callbackRef.current = onFeature;
  }, [onFeature]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !enabled) return;
    let stopped = false;
    let animation = 0;
    let lastAnalysis = 0;
    let stallReported = false;
    const frameWatchdog = new VideoFrameWatchdog();
    const provider = new MediaPipeTrackingProvider();
    providerRef.current = provider;
    void provider.initialize().then(() => {
      setError(undefined);
      void logEvent("tracker_initialized", {
        fields: {
          trackerId: provider.id,
          trackerVersion: provider.version,
        },
      });
      const tick = async (timestamp: number) => {
        if (stopped) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && timestamp - lastAnalysis >= 45) {
          lastAnalysis = timestamp;
          const frameFlow = frameWatchdog.update(video.currentTime, timestamp);
          if (frameFlow === "stalled") {
            callbackRef.current(unknownFeature(timestamp));
            if (!stallReported) {
              stallReported = true;
              setError("Camera frames stopped advancing.");
              void logEvent("camera_frame_flow_stalled", {
                level: "warn",
                fields: { mediaTimeSeconds: video.currentTime },
              });
            }
            animation = requestAnimationFrame(tick);
            return;
          }
          if (frameFlow === "waiting") {
            animation = requestAnimationFrame(tick);
            return;
          }
          if (frameFlow === "advancing" && stallReported) {
            stallReported = false;
            setError(undefined);
            void logEvent("camera_frame_flow_recovered", {
              fields: { mediaTimeSeconds: video.currentTime },
            });
          }
          try {
            callbackRef.current(await provider.analyze({ video, timestampMs: timestamp }));
            setError(undefined);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void logEvent("tracker_frame_failed", {
              level: "error",
              fields: { error: message },
            });
            setError(message);
            callbackRef.current(unknownFeature(timestamp));
          }
        }
        animation = requestAnimationFrame(tick);
      };
      animation = requestAnimationFrame(tick);
    }).catch((error) => {
      void logEvent("tracker_init_failed", {
        level: "error",
        fields: { error: String(error) },
      });
      setError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      stopped = true;
      cancelAnimationFrame(animation);
      void provider.shutdown();
    };
  }, [videoRef, enabled]);

  return {
    trackerId: MEDIAPIPE_TRACKER_ID,
    trackerVersion: MEDIAPIPE_TRACKER_VERSION,
    error,
  };
}

function VideoPreview({
  stream,
  videoRef,
  state,
  lensAnchor,
  onLensAnchorChange,
  onFirstFrame,
  calibrationGuide,
  showLensAnchor = true,
  promptOverlay,
  cuePulse,
  className,
}: {
  stream?: MediaStream;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  state?: GazeState;
  lensAnchor?: { x: number; y: number };
  onLensAnchorChange?: (anchor: { x: number; y: number }) => void;
  onFirstFrame?: () => void;
  calibrationGuide?: { x: number; y: number; label: string };
  showLensAnchor?: boolean;
  promptOverlay?: React.ReactNode;
  cuePulse?: boolean;
  className?: string;
}) {
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream, videoRef]);
  return (
    <div
      className={`preview ${state ?? ""} ${onLensAnchorChange ? "anchor-editable" : ""} ${cuePulse ? "cue-pulse" : ""} ${className ?? ""}`}
      onClick={(event) => {
        if (!onLensAnchorChange) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        onLensAnchorChange({
          x: Math.max(0.02, Math.min(0.98, (event.clientX - bounds.left) / bounds.width)),
          y: Math.max(0.005, Math.min(0.15, (event.clientY - bounds.top) / bounds.height)),
        });
      }}
    >
      <video ref={videoRef} autoPlay muted playsInline onLoadedData={onFirstFrame} />
      {showLensAnchor && (
        <span
          className="lens-anchor"
          aria-label="Physical lens target"
          style={{
            left: `${(lensAnchor?.x ?? 0.5) * 100}%`,
            top: `${(lensAnchor?.y ?? 0.015) * 100}%`,
          }}
        />
      )}
      {calibrationGuide && (
        <span
          className="calibration-guide-marker"
          style={{
            left: `${calibrationGuide.x * 100}%`,
            top: `${calibrationGuide.y * 100}%`,
          }}
        >
          <i />
          <b>{calibrationGuide.label}</b>
        </span>
      )}
      {promptOverlay}
      {state && <div className="state-halo" aria-live="polite">{stateLabel[state]}</div>}
      {!stream && <div className="preview-empty">Camera preview is off</div>}
    </div>
  );
}

function LatencySparkline({ values }: { values: number[] }) {
  const width = 220;
  const height = 44;
  const ceiling = Math.max(50, ...values);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - Math.min(1, value / ceiling) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg
      className="latency-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Analysis latency over the last ${values.length} frames`}
    >
      <line x1="0" y1={height - (Math.min(ceiling, 50) / ceiling) * height} x2={width} y2={height - (Math.min(ceiling, 50) / ceiling) * height} />
      {points && <polyline points={points} />}
    </svg>
  );
}

function useMicrophoneLevel(stream?: MediaStream): number | undefined {
  const [levelDbfs, setLevelDbfs] = useState<number>();
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track) {
      setLevelDbfs(undefined);
      return;
    }
    const context = new AudioContext();
    void context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let animation = 0;
    let lastUpdate = 0;
    const update = (timestamp: number) => {
      if (timestamp - lastUpdate >= 100) {
        analyser.getFloatTimeDomainData(samples);
        setLevelDbfs(rmsDbfs(samples));
        lastUpdate = timestamp;
      }
      animation = requestAnimationFrame(update);
    };
    animation = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(animation);
      source.disconnect();
      analyser.disconnect();
      void context.close();
    };
  }, [stream]);
  return levelDbfs;
}

function Setup({
  inventory,
  profiles,
  activeProfile,
  stream,
  audioStream,
  videoRef,
  onRequestCamera,
  onRequestMicrophone,
  onSelectProfile,
  onRefresh,
  onCreateProfile,
  onUpdateProfile,
  onLensAnchorChange,
  onFirstFrame,
  featureFlags,
  onFeatureFlagsChange,
}: {
  inventory?: DeviceInventory;
  profiles: CaptureProfile[];
  activeProfile?: CaptureProfile;
  stream?: MediaStream;
  audioStream?: MediaStream;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onRequestCamera: () => void;
  onRequestMicrophone: () => void;
  onSelectProfile: (id: string) => void;
  onRefresh: () => void;
  onCreateProfile: (
    name: string,
    cameraId: string,
    microphoneId: string,
    requestedVideo: CaptureProfile["requestedVideo"],
  ) => void;
  onUpdateProfile: (
    id: string,
    name: string,
    cameraId: string,
    microphoneId: string,
    requestedVideo: CaptureProfile["requestedVideo"],
  ) => void;
  onLensAnchorChange: (anchor: { x: number; y: number }) => void;
  onFirstFrame: () => void;
  featureFlags: FeatureFlags;
  onFeatureFlagsChange: (flags: FeatureFlags) => void;
}) {
  const [newName, setNewName] = useState("Custom Capture");
  const [cameraId, setCameraId] = useState("");
  const [microphoneId, setMicrophoneId] = useState("");
  const [videoMode, setVideoMode] = useState("1920x1080@30");
  useEffect(() => {
    if (!activeProfile) return;
    setNewName(activeProfile.name);
    setCameraId(activeProfile.cameraDeviceId);
    setMicrophoneId(activeProfile.microphoneDeviceId || NO_MICROPHONE_ID);
    setVideoMode(videoModeValue(activeProfile.requestedVideo));
  }, [activeProfile]);

  const selectedCameraId = cameraId || inventory?.cameras[0]?.deviceId || "";
  const selectedMicrophoneId =
    microphoneId || inventory?.microphones[0]?.deviceId || NO_MICROPHONE_ID;
  const storedMicrophoneId =
    selectedMicrophoneId === NO_MICROPHONE_ID ? "" : selectedMicrophoneId;
  const selectedCameraAvailable = Boolean(
    inventory?.cameras.some((device) => device.deviceId === selectedCameraId),
  );
  const selectedMicrophoneAvailable =
    selectedMicrophoneId === NO_MICROPHONE_ID ||
    Boolean(inventory?.microphones.some((device) => device.deviceId === selectedMicrophoneId));
  const microphoneLevelDbfs = useMicrophoneLevel(audioStream);
  const microphoneTrack = audioStream?.getAudioTracks()[0];
  const selectedVideoMode =
    VIDEO_MODE_OPTIONS.find((option) => option.value === videoMode) ??
    VIDEO_MODE_OPTIONS[1];

  return (
    <section className="screen">
      <div className="screen-copy">
        <p className="eyebrow">Setup</p>
        <h1>Measure camera contact on your setup.</h1>
        <p className="lede">Camera and microphone access are requested separately and only when you choose.</p>
      </div>
      <div className="setup-grid">
        <div>
          <VideoPreview
            stream={stream}
            videoRef={videoRef}
            lensAnchor={activeProfile?.lensAnchor}
            onLensAnchorChange={activeProfile ? onLensAnchorChange : undefined}
            onFirstFrame={onFirstFrame}
          />
          {activeProfile && <p className="anchor-help">Click near the top of the preview directly beneath the physical camera lens.</p>}
        </div>
        <div className="panel">
          <h2>Permissions</h2>
          <div className="permission-row">
            <span>Camera</span><strong>{inventory?.cameraPermission ?? "not checked"}</strong>
            <button onClick={onRequestCamera}>Enable camera</button>
          </div>
          <div className="permission-row">
            <span>Microphone</span><strong>{inventory?.microphonePermission ?? "not checked"}</strong>
            <button className="secondary" onClick={onRequestMicrophone}>Enable microphone</button>
            {microphoneTrack && (
              <div className="microphone-level" aria-label="Live microphone input level">
                <i>
                  <span
                    style={{ width: `${audioMeterPercent(microphoneLevelDbfs ?? -120)}%` }}
                  />
                </i>
                <small>
                  {microphoneTrack.readyState !== "live" || microphoneTrack.muted
                    ? "Muted or unavailable"
                    : microphoneLevelDbfs === undefined
                      ? "Starting level meter…"
                      : microphoneLevelDbfs < -55
                        ? "No usable signal"
                        : `${microphoneLevelDbfs.toFixed(1)} dBFS`}
                </small>
              </div>
            )}
          </div>
          <button className="text-button" onClick={onRefresh}>Refresh devices</button>
          <h2>Capture profile</h2>
          {profiles.length === 0 ? (
            <p className="muted">Enable devices to match a suggested profile, or create a camera-only custom profile.</p>
          ) : (
            <div className="profile-list">
              {profiles.map((profile) => (
                <button
                  className={`profile-card ${activeProfile?.id === profile.id ? "selected" : ""}`}
                  key={profile.id}
                  onClick={() => onSelectProfile(profile.id)}
                >
                  <span>{profile.name}</span>
                  <small>{profile.cameraLabel} · {profile.microphoneLabel}</small>
                  <small>
                    Requests {profile.requestedVideo.width}×{profile.requestedVideo.height} at{" "}
                    {profile.requestedVideo.frameRate} fps
                  </small>
                </button>
              ))}
            </div>
          )}
          {activeProfile?.negotiatedVideo && (
            <p className="format">
              Active format: {activeProfile.negotiatedVideo.width}×{activeProfile.negotiatedVideo.height} at{" "}
              {Math.round(activeProfile.negotiatedVideo.frameRate)} fps
            </p>
          )}
          {activeProfile?.negotiatedAudio && (
            <p className="format">
              Active audio: {activeProfile.negotiatedAudio.sampleRate / 1_000} kHz ·{" "}
              {activeProfile.negotiatedAudio.channelCount === 1
                ? "mono"
                : `${activeProfile.negotiatedAudio.channelCount} channels`}
            </p>
          )}
          {activeProfile?.captureDiagnostics && (
            <p className="format">
              First frame: {Math.round(activeProfile.captureDiagnostics.timeToFirstFrameMs)} ms
              {" · "}device request {Math.round(activeProfile.captureDiagnostics.cameraRequestLatencyMs)} ms
            </p>
          )}
          <details className="profile-editor">
            <summary>Create or edit a profile</summary>
            <label>Name<input value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
            <label>Camera
              <select value={selectedCameraId} onChange={(event) => setCameraId(event.target.value)}>
                {activeProfile &&
                  !inventory?.cameras.some((device) => device.deviceId === activeProfile.cameraDeviceId) &&
                  activeProfile.cameraDeviceId === selectedCameraId && (
                    <option value={activeProfile.cameraDeviceId}>{activeProfile.cameraLabel} (disconnected)</option>
                  )}
                {inventory?.cameras.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Camera"}</option>)}
              </select>
            </label>
            <label>Microphone
              <select value={selectedMicrophoneId} onChange={(event) => setMicrophoneId(event.target.value)}>
                <option value={NO_MICROPHONE_ID}>No microphone (video only)</option>
                {activeProfile?.microphoneDeviceId &&
                  !inventory?.microphones.some((device) => device.deviceId === activeProfile.microphoneDeviceId) &&
                  activeProfile.microphoneDeviceId === selectedMicrophoneId && (
                    <option value={activeProfile.microphoneDeviceId}>{activeProfile.microphoneLabel} (disconnected)</option>
                  )}
                {inventory?.microphones.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone"}</option>)}
              </select>
            </label>
            <label>Requested video mode
              <select value={selectedVideoMode.value} onChange={(event) => setVideoMode(event.target.value)}>
                {VIDEO_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <p className="muted">
              This is a request, not a promise. The active format above records what the camera actually negotiated.
            </p>
            <button disabled={!newName || !selectedCameraAvailable || !selectedMicrophoneAvailable} onClick={() => onCreateProfile(newName, selectedCameraId, storedMicrophoneId, selectedVideoMode.requestedVideo)}>
              Save profile
            </button>
            {activeProfile && (
              <button
                className="secondary"
                disabled={!newName || !selectedCameraAvailable || !selectedMicrophoneAvailable}
                onClick={() => onUpdateProfile(activeProfile.id, newName, selectedCameraId, storedMicrophoneId, selectedVideoMode.requestedVideo)}
              >
                Update selected
              </button>
            )}
          </details>
          <details className="profile-editor">
            <summary>Experimental features</summary>
            <label className="feature-flag">
              <input
                type="checkbox"
                checked={featureFlags.experimentalTrackerComparison}
                onChange={(event) => onFeatureFlagsChange({
                  ...featureFlags,
                  experimentalTrackerComparison: event.target.checked,
                })}
              />
              Allow comparison files produced by a different tracker backend
            </label>
            <p className="muted">
              Disabled by default. Enabling this does not change the live tracker.
            </p>
          </details>
        </div>
      </div>
    </section>
  );
}

function CalibrationWizard({
  profile,
  stream,
  videoRef,
  onSaved,
  existingCalibration,
  invalidationReason,
}: {
  profile?: CaptureProfile;
  stream?: MediaStream;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onSaved: (calibration: Calibration) => void;
  existingCalibration?: Calibration;
  invalidationReason?: string;
}) {
  type CalibrationPhase = "training" | "validation" | "quick";
  const [step, setStep] = useState(-1);
  const [phase, setPhase] = useState<CalibrationPhase>("training");
  const [sequenceSteps, setSequenceSteps] = useState<CalibrationProtocolStep[]>(
    TRAINING_CALIBRATION_STEPS,
  );
  const [samples, setSamples] = useState<Calibration["samples"]>([]);
  const [validationSamples, setValidationSamples] = useState<Calibration["samples"]>([]);
  const [collecting, setCollecting] = useState(false);
  const [countdown, setCountdown] = useState<number>();
  const [setupNotes, setSetupNotes] = useState("");
  const [result, setResult] = useState<{
    score: number;
    warnings: string[];
    accepted: boolean;
    persistenceFailed?: boolean;
  }>();
  const [weakTargets, setWeakTargets] = useState<CalibrationTarget[]>([]);
  const [quickResult, setQuickResult] = useState<number>();
  const [preflightFeature, setPreflightFeature] = useState<FeatureVector>();
  const [brightness, setBrightness] = useState<BrightnessAssessment>();
  const current = sequenceSteps[step];
  const currentTarget = current?.target;
  const activeCollectionRef = useRef<{
    phase: CalibrationPhase;
    stepId: string;
    target: CalibrationTarget;
    startedAtMs: number;
    firstTimestampUs?: number;
    lastTimestampUs?: number;
    sampleCount: number;
  } | undefined>(undefined);
  const tracker = useTracker(videoRef, Boolean(stream && profile), (feature) => {
    setPreflightFeature(feature);
    const activeCollection = activeCollectionRef.current;
    if (activeCollection) {
      if (activeCollection.sampleCount === 0) {
        activeCollection.firstTimestampUs = feature.timestampUs;
        void logEvent("calibration_collection_first_frame", {
          fields: {
            phase: activeCollection.phase,
            stepId: activeCollection.stepId,
            target: activeCollection.target,
            timestampUs: feature.timestampUs,
          },
        });
      }
      activeCollection.lastTimestampUs = feature.timestampUs;
      activeCollection.sampleCount += 1;
      if (activeCollection.phase === "validation") {
        setValidationSamples((values) => [
          ...values,
          { target: activeCollection.target, feature },
        ]);
      } else {
        setSamples((values) => [
          ...values,
          { target: activeCollection.target, feature },
        ]);
      }
    }
  });

  useEffect(() => {
    if (stream) return;
    setCollecting(false);
    setCountdown(undefined);
    setSamples([]);
    setValidationSamples([]);
    setWeakTargets([]);
    setResult(undefined);
    setQuickResult(undefined);
    setPhase("training");
    setSequenceSteps(TRAINING_CALIBRATION_STEPS);
    setStep(-1);
    activeCollectionRef.current = undefined;
  }, [stream]);

  const playCalibrationCue = useCallback((frequency: number) => {
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.18);
      oscillator.addEventListener("ended", () => void context.close(), { once: true });
    } catch {
      // The visible countdown remains the fallback when audio output is unavailable.
    }
  }, []);

  useEffect(() => {
    if (!stream || !profile) return;
    const update = () => {
      const video = videoRef.current;
      if (video) setBrightness(sampleVideoBrightness(video));
    };
    update();
    const timer = window.setInterval(update, 750);
    return () => window.clearInterval(timer);
  }, [profile, stream, videoRef]);

  const faceReady = Boolean(preflightFeature?.faceDetected && (preflightFeature?.confidence ?? 0) >= 0.65);
  const framingReady = Boolean(
    preflightFeature &&
    preflightFeature.faceScale >= 0.12 &&
    preflightFeature.faceScale <= 0.65,
  );
  const lightingReady = brightness?.status === "good";
  const preflightReady = faceReady && framingReady && lightingReady;

  useEffect(() => {
    if (countdown === undefined) return;
    if (countdown <= 0) {
      setCountdown(undefined);
      playCalibrationCue(880);
      if (current) {
        activeCollectionRef.current = {
          phase,
          stepId: current.id,
          target: current.target,
          startedAtMs: performance.now(),
          sampleCount: 0,
        };
        void logEvent("calibration_collection_started", {
          fields: {
            phase,
            stepId: current.id,
            target: current.target,
            collectMs: current.collectMs,
          },
        });
      }
      setCollecting(true);
      return;
    }
    const timer = window.setTimeout(
      () => setCountdown((value) => (value ?? 1) - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [countdown, current, phase, playCalibrationCue]);

  useEffect(() => {
    if (!collecting) return;
    const timer = window.setTimeout(() => {
      const finishedCollection = activeCollectionRef.current;
      activeCollectionRef.current = undefined;
      if (finishedCollection) {
        void logEvent("calibration_collection_finished", {
          fields: {
            phase: finishedCollection.phase,
            stepId: finishedCollection.stepId,
            target: finishedCollection.target,
            elapsedMs: performance.now() - finishedCollection.startedAtMs,
            firstTimestampUs: finishedCollection.firstTimestampUs,
            lastTimestampUs: finishedCollection.lastTimestampUs,
            sampleCount: finishedCollection.sampleCount,
          },
        });
      }
      playCalibrationCue(520);
      setCollecting(false);
      if (step < sequenceSteps.length - 1) {
        const nextStep = step + 1;
        setStep(nextStep);
        setCountdown(sequenceSteps[nextStep].settleSeconds);
      }
      else setStep(sequenceSteps.length);
    }, current?.collectMs ?? 2_200);
    return () => window.clearTimeout(timer);
  }, [collecting, current?.collectMs, playCalibrationCue, sequenceSteps, step]);

  const beginGuidedCalibration = () => {
    setPhase("training");
    setSequenceSteps(TRAINING_CALIBRATION_STEPS);
    setSamples([]);
    setValidationSamples([]);
    setWeakTargets([]);
    setResult(undefined);
    setQuickResult(undefined);
    activeCollectionRef.current = undefined;
    setCollecting(false);
    setStep(0);
    setCountdown(TRAINING_CALIBRATION_STEPS[0].settleSeconds);
  };

  const beginValidation = () => {
    const steps = shuffledValidationSteps();
    setPhase("validation");
    setSequenceSteps(steps);
    setValidationSamples([]);
    activeCollectionRef.current = undefined;
    setCollecting(false);
    setStep(0);
    setCountdown(steps[0].settleSeconds);
  };

  const beginQuickVerification = () => {
    setPhase("quick");
    setSequenceSteps(QUICK_LENS_VERIFICATION_STEPS);
    setSamples([]);
    setValidationSamples([]);
    setQuickResult(undefined);
    activeCollectionRef.current = undefined;
    setCollecting(false);
    setStep(0);
    setCountdown(QUICK_LENS_VERIFICATION_STEPS[0].settleSeconds);
  };

  const finish = async () => {
    if (!profile) return;
    const quality = scoreCalibration(samples.map((sample) => sample.feature));
    const targetQuality = scoreCalibrationTargets(samples);
    const draft: Calibration = {
      id: crypto.randomUUID(),
      profileId: profile.id,
      trackerId: tracker.trackerId,
      trackerVersion: tracker.trackerVersion,
      featureSchemaVersion: "1.0.0",
      algorithmVersion: ALGORITHM_VERSION,
      protocolVersion: CALIBRATION_PROTOCOL_VERSION,
      createdAt: new Date().toISOString(),
      setupNotes: setupNotes || undefined,
      setupFingerprint: calibrationFingerprint(profile),
      samples,
      validationSamples,
      quality: {
        ...quality,
        sampleCount: samples.length + validationSamples.length,
        heldOutAccuracy: 0,
        validationSampleCount: validationSamples.length,
        targetQuality,
      },
    };
    const heldOut = evaluateHeldOutCalibration(draft);
    const heldOutAccuracy = heldOut.accuracy;
    const requiredValidationTargets = [
      ...new Set(sequenceSteps.map((validationStep) => validationStep.target)),
    ];
    const insufficientValidationTargets = requiredValidationTargets.filter(
      (target) => (heldOut.byTarget[target]?.evaluated ?? 0) < 5,
    );
    const unstableTargetIds = Object.entries(targetQuality)
      .filter(([, target]) => target.score < 0.75)
      .map(([target]) => target as CalibrationTarget);
    const weakTargetIds = [
      ...new Set([
        ...Object.entries(heldOut.byTarget)
          .filter(([, target]) => target.accuracy < 0.85)
          .map(([target]) => target as CalibrationTarget),
        ...insufficientValidationTargets,
        ...unstableTargetIds,
      ]),
    ];
    const weakTargetLabels = Object.entries(heldOut.byTarget)
      .filter(([, target]) => target.accuracy < 0.85)
      .map(([target, targetResult]) =>
        `${CALIBRATION_GUIDES[target as CalibrationTarget]?.title ?? target}: ${Math.round(targetResult.accuracy * 100)}%`,
      );
    const gate = calibrationQualityGate(
      heldOutAccuracy,
      heldOut.byTarget,
      requiredValidationTargets,
    );
    const unstableTargetLabels = unstableTargetIds.map(
      (target) => CALIBRATION_GUIDES[target]?.title ?? target,
    );
    const value = {
      ...draft,
      quality: {
        ...draft.quality,
        heldOutAccuracy,
        heldOutByTarget: heldOut.byTarget,
      },
    };
    const finalResult = {
      score: Math.min(quality.score, heldOutAccuracy),
      accepted:
        quality.score >= 0.6 &&
        gate.accepted &&
        unstableTargetIds.length === 0,
      warnings: [
        ...quality.warnings,
        ...gate.reasons,
        ...(weakTargetLabels.length
          ? [`Weak targets — ${weakTargetLabels.join("; ")}.`]
          : []),
        ...(unstableTargetLabels.length
          ? [`Unstable holds — ${unstableTargetLabels.join("; ")}.`]
          : []),
      ],
    };
    setWeakTargets(weakTargetIds);
    void logEvent("calibration_validated", {
      correlationId: value.id,
      fields: {
        profileId: profile.id,
        trackerId: value.trackerId,
        trackerVersion: value.trackerVersion,
        sampleCount: value.quality.sampleCount,
        qualityScore: quality.score,
        heldOutAccuracy,
        accepted: finalResult.accepted,
      },
    });
    if (finalResult.accepted) {
      try {
        await store.calibrations.put(value);
        setResult(finalResult);
        onSaved(value);
      } catch (cause) {
        const message = `Calibration qualified but could not be saved: ${
          cause instanceof Error ? cause.message : String(cause)
        }`;
        setResult({
          ...finalResult,
          accepted: false,
          persistenceFailed: true,
          warnings: [...finalResult.warnings, message],
        });
        void logEvent("calibration_persistence_failed", {
          correlationId: value.id,
          level: "error",
          fields: { error: message },
        });
      }
    } else {
      setResult(finalResult);
      void store.calibrations.put({
        ...value,
        invalidatedAt: new Date().toISOString(),
        invalidationReason: "Rejected by calibration quality gate.",
      }).catch((cause) => {
        void logEvent("calibration_rejection_persistence_failed", {
          correlationId: value.id,
          level: "error",
          fields: {
            error: cause instanceof Error ? cause.message : String(cause),
          },
        });
      });
    }
  };

  const repeatWeakTargets = () => {
    const targets = new Set(weakTargets);
    const steps = targets.size
      ? TRAINING_CALIBRATION_STEPS.filter((value) => targets.has(value.target))
      : TRAINING_CALIBRATION_STEPS;
    setSamples((values) =>
      targets.size
        ? values.filter((sample) => !targets.has(sample.target))
        : [],
    );
    setValidationSamples([]);
    setResult(undefined);
    setQuickResult(undefined);
    setPhase("training");
    setSequenceSteps(steps);
    activeCollectionRef.current = undefined;
    setCollecting(false);
    setStep(0);
    setCountdown(steps[0].settleSeconds);
  };

  const finishQuickVerification = () => {
    if (!existingCalibration) return;
    const model = trainClassifier(existingCalibration);
    const usable = samples.filter((sample) => sample.target === "lens" && !sample.feature.blink);
    const contact = usable.filter((sample) => {
      const state = classifyFrame(model, sample.feature).rawState;
      return state === "contact" || state === "near_lens";
    }).length;
    setQuickResult(usable.length ? contact / usable.length : 0);
  };

  if (!profile || !stream) {
    return <section className="empty-state"><h1>Finish camera setup first.</h1><p>Select a profile and enable its camera.</p></section>;
  }
  return (
    <section
      className={`screen calibration-screen ${current ? "active-calibration" : ""}`}
    >
      {!current && (
        <div className="screen-copy">
          <p className="eyebrow">Calibration · {profile.name}</p>
          <h1>
            {step < 0
              ? "Teach the coach your natural lens contact."
              : "Validation"}
          </h1>
          <p className="lede">
            {step < 0
              ? existingCalibration
                ? "A compatible saved calibration is active. Verify it quickly or collect a full replacement."
                : invalidationReason
                  ? `The saved calibration cannot be reused: ${invalidationReason} Complete a full replacement.`
                  : "Keep your position steady. We’ll collect lens, glance, and head/eye separation samples."
              : "Calibration samples are ready for quality checks."}
          </p>
          <div className="calibration-controls guidance-above-preview">
            <div className="progress">
              <span
                style={{
                  width: `${Math.max(0, (step + 1) / sequenceSteps.length) * 100}%`,
                }}
              />
            </div>
          {step < 0 && (
            <button disabled={!preflightReady} onClick={beginGuidedCalibration}>
              Begin guided calibration
            </button>
          )}
          {step < 0 && existingCalibration && (
            <button
              className="secondary"
              disabled={!preflightReady}
              onClick={beginQuickVerification}
            >
              Quick lens verification
            </button>
          )}
          {step === sequenceSteps.length && phase === "training" && (
            <button onClick={beginValidation}>Begin independent validation</button>
          )}
          {step === sequenceSteps.length && phase === "validation" && (
            <button onClick={() => void finish()}>Score independent validation</button>
          )}
          {step === sequenceSteps.length && phase === "quick" && (
            <button onClick={finishQuickVerification}>Check saved calibration</button>
          )}
          {result && (
            <div className={result.accepted ? "notice success" : "notice warning"}>
              <strong>
                {result.persistenceFailed
                  ? "Calibration not saved"
                  : result.accepted
                    ? "Calibration saved"
                    : "Repeat calibration"}
              </strong>
              <span>Quality {Math.round(result.score * 100)}%</span>
              {result.warnings.map((warning) => <span key={warning}>{warning}</span>)}
              {!result.accepted && !result.persistenceFailed && <span>Rejected samples were retained locally for diagnostics and cannot become active.</span>}
              {!result.accepted && result.persistenceFailed && (
                <button onClick={() => void finish()}>Retry save</button>
              )}
              {!result.accepted && !result.persistenceFailed && (
                <button onClick={repeatWeakTargets}>
                  {weakTargets.length ? "Repeat weak targets" : "Repeat guided calibration"}
                </button>
              )}
            </div>
          )}
          {tracker.error && <div className="notice warning"><strong>Tracker unavailable</strong><span>{tracker.error}</span></div>}
          {quickResult !== undefined && (
            <div className={quickResult >= 0.85 ? "notice success" : "notice warning"}>
              <strong>{quickResult >= 0.85 ? "Saved calibration verified" : "Full recalibration recommended"}</strong>
              <span>{Math.round(quickResult * 100)}% of usable lens samples matched.</span>
            </div>
          )}
          </div>
        </div>
      )}
      <VideoPreview
        stream={stream}
        videoRef={videoRef}
        lensAnchor={profile.lensAnchor}
        showLensAnchor={!current}
        calibrationGuide={
          currentTarget && current && !(current.physicalLens && collecting)
            ? {
                ...calibrationGuidePoint(currentTarget, profile.lensAnchor),
                label: current.shortInstruction,
              }
            : undefined
        }
      />
      {step < 0 && (
        <div className="preflight-grid" aria-label="Calibration preflight">
          <div className={faceReady ? "pass" : "fail"}><strong>Face tracking</strong><span>{faceReady ? "Ready" : "Center your face"}</span></div>
          <div className={framingReady ? "pass" : "fail"}><strong>Framing</strong><span>{framingReady ? "Ready" : "Adjust distance"}</span></div>
          <div className={lightingReady ? "pass" : "fail"}><strong>Lighting</strong><span>{brightness ? brightness.status.replace("_", " ") : "Checking…"}</span></div>
        </div>
      )}
      {step < 0 && (
        <label className="setup-notes">
          Physical setup notes (optional)
          <textarea
            value={setupNotes}
            placeholder="Chair mark, camera mount, glasses, lighting, or display position"
            onChange={(event) => setSetupNotes(event.target.value)}
          />
        </label>
      )}
    </section>
  );
}

function Measure({
  profile,
  calibration,
  cameraStream,
  microphoneStream,
  videoRef,
  onSession,
  debug,
  calibrationIssue,
  onLiveAssistSnapshot,
  consents,
  onClipsProposed,
  followedRecommendationId,
  initialDrillId,
  promptPlacementIssue,
}: {
  profile?: CaptureProfile;
  calibration?: Calibration;
  cameraStream?: MediaStream;
  microphoneStream?: MediaStream;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onSession: (session: StoredSession) => void;
  debug: boolean;
  calibrationIssue?: string;
  onLiveAssistSnapshot?: (snapshot: {
    state?: GazeState;
    recording: boolean;
    liveAssist: boolean;
  }) => void;
  consents: ConsentRecord[];
  onClipsProposed?: (clips: ClipCandidate[]) => void;
  followedRecommendationId?: string;
  initialDrillId?: string;
  promptPlacementIssue?: string;
}) {
  const model = useMemo(() => calibration ? trainClassifier(calibration) : undefined, [calibration]);
  const pipeline = useRef<MeasurementPipeline | undefined>(undefined);
  const policyRef = useRef<FeedbackPolicyEngine | undefined>(undefined);
  const [prediction, setPrediction] = useState<GazePrediction>();
  const [lastFeature, setLastFeature] = useState<FeatureVector>();
  const [testing, setTesting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [liveDroppedFrames, setLiveDroppedFrames] = useState(0);
  const predictions = useRef<GazePrediction[]>([]);
  const features = useRef<FeatureVector[]>([]);
  const events = useRef<GazeEvent[]>([]);
  const cues = useRef<CueEvent[]>([]);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const recordRequested = useRef(false);
  const recorderError = useRef<string | undefined>(undefined);
  const mediaStartedAtUs = useRef<number | undefined>(undefined);
  const manifest = useRef<SessionManifest | undefined>(undefined);
  const lastCheckpoint = useRef(0);
  const droppedFramesAtStart = useRef(0);
  const stopping = useRef(false);
  const finalizedSessionId = useRef<string | undefined>(undefined);
  const stopRef = useRef<(status?: "complete" | "incomplete", recoveryNote?: string) => Promise<void>>(
    async () => undefined,
  );
  const [captureFailure, setCaptureFailure] = useState<string>();
  const builtinDrills = useBuiltinDrills();
  const [customDrills, setCustomDrills] = useState<DrillDefinition[]>([]);
  const drills = useMemo(
    () => [...builtinDrills, ...customDrills],
    [builtinDrills, customDrills],
  );
  const [selectedDrillId, setSelectedDrillId] = useState(
    initialDrillId ?? drills[0]?.id ?? "",
  );
  const selectedDrill = drills.find((drill) => drill.id === selectedDrillId) ?? drills[0];
  const [intensity, setIntensity] = useState<FeedbackIntensity>(
    selectedDrill?.contactPolicy.feedbackLevel ?? "standard",
  );
  const [sessionGoal, setSessionGoal] = useState("");
  const [comfortBefore, setComfortBefore] = useState(3);
  const [wantRecord, setWantRecord] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [liveAssist, setLiveAssist] = useState(false);
  const [handsFreeAudio, setHandsFreeAudio] = useState(true);
  const [preparingAudio, setPreparingAudio] = useState(false);
  const [datasetIntent, setDatasetIntent] = useState<DatasetIntent>("none");
  const [outfitLabel, setOutfitLabel] = useState("");
  const [backgroundLabel, setBackgroundLabel] = useState("");
  const [preflightMessage, setPreflightMessage] = useState<string>();

  useEffect(() => {
    void store.customDrills
      .all()
      .then(setCustomDrills)
      .catch((cause) => {
        setCaptureFailure(
          `Custom drills could not be restored: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      });
  }, []);

  useEffect(() => {
    if (initialDrillId) setSelectedDrillId(initialDrillId);
  }, [initialDrillId]);
  const [train, setTrain] = useState<TrainSessionState | undefined>();
  const [lastCueKind, setLastCueKind] = useState<string>();
  const [cueCount, setCueCount] = useState(0);
  const [sessionCues, setSessionCues] = useState<CueEvent[]>([]);
  const [manualSpeaking, setManualSpeaking] = useState(false);
  const trainRef = useRef<TrainSessionState | undefined>(undefined);
  const activeStartMs = useRef<number | undefined>(undefined);
  const beginMediaRef = useRef<() => void>(() => undefined);
  const lastSavedSessionRef = useRef<StoredSession | undefined>(undefined);
  const speakingSecRef = useRef(0);
  const speakingWindowsRef = useRef<Array<{ startUs: number; endUs: number }>>([]);
  const handsFreeCompletionRef = useRef<string | undefined>(undefined);
  // Never resume recording after restart — always start from false.
  useEffect(() => {
    const initial = selectedDrill ?? drills[0];
    if (initial) {
      setWantRecord(restartSafeRecordingFlag(null) || defaultRecordingIntent(initial));
    }
    // Intentionally once on mount so restart never re-enables recording from prior UI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only restart safety
  }, []);

  useEffect(() => {
    trainRef.current = train;
  }, [train]);

  const vad = useSpeakingVad(microphoneStream, testing);
  const speaking = vad.speaking || manualSpeaking;

  useEffect(() => {
    speakingSecRef.current = speakingSeconds(vad.windows);
    speakingWindowsRef.current = vad.windows.map((window) => ({
      startUs: window.startUs,
      endUs: window.endUs,
    }));
  }, [vad.windows]);

  useEffect(() => {
    onLiveAssistSnapshot?.({
      state: testing ? prediction?.state : undefined,
      recording,
      liveAssist,
    });
  }, [liveAssist, onLiveAssistSnapshot, prediction?.state, recording, testing]);

  const liveTracker = useTracker(videoRef, Boolean(cameraStream && model && testing), (feature) => {
    if (!model) return;
    setLastFeature(feature);
    if (feature.analysisLatencyMs !== undefined) {
      setLatencyHistory((current) => [...current.slice(-59), feature.analysisLatencyMs as number]);
    }
    if (typeof videoRef.current?.getVideoPlaybackQuality === "function") {
      setLiveDroppedFrames(
        Math.max(
          0,
          videoRef.current.getVideoPlaybackQuality().droppedVideoFrames -
            droppedFramesAtStart.current,
        ),
      );
    }
    features.current.push(feature);
    pipeline.current ??= new MeasurementPipeline(model);
    const frame = pipeline.current.process(feature);
    const next = frame.prediction;
    setPrediction(next);
    predictions.current.push(next);
    events.current.push(...frame.completedEvents);
    policyRef.current?.observeEvents(frame.completedEvents);
    const openBreak = events.current
      .filter((event) => event.type === "break" && event.endUs === undefined)
      .at(-1);
    const openBreakDurationMs = openBreak
      ? Math.max(0, (feature.timestampUs - openBreak.startUs) / 1000)
      : next.state === "off_lens"
        ? 0
        : 0;
    const recoveryJustOccurred = frame.completedEvents.some((event) => event.type === "recovery");
    const sessionRelativeUs = manifest.current
      ? feature.timestampUs - manifest.current.monotonicStartUs
      : feature.timestampUs;
    const cue = policyRef.current?.evaluate({
      prediction: next,
      openBreakDurationMs:
        openBreakDurationMs ||
        (next.state === "off_lens" && openBreak
          ? (feature.timestampUs - openBreak.startUs) / 1000
          : next.state === "off_lens"
            ? 0
            : 0),
      recoveryJustOccurred,
      speaking,
      sessionRelativeUs,
      noteAllowedWindows: selectedDrill && manifest.current
        ? noteWindowsFromDrill(selectedDrill, 0)
        : [],
      blink: feature.blink,
      intensity,
    });
    if (cue) {
      cues.current.push(cue);
      setCueCount(cues.current.length);
      setSessionCues([...cues.current]);
      setLastCueKind(cue.kind);
      window.setTimeout(() => setLastCueKind(undefined), 450);
    }
    if (
      manifest.current &&
      feature.timestampUs - lastCheckpoint.current >= SESSION_CHECKPOINT_INTERVAL_US
    ) {
      lastCheckpoint.current = feature.timestampUs;
      void store.sessions.put({
        manifest: { ...manifest.current, frameCount: predictions.current.length },
        calibrationSnapshot: calibration,
        features: [...features.current],
        predictions: [...predictions.current],
        events: [...events.current],
        corrections: [],
        cues: [...cues.current],
        speakingWindows: [...speakingWindowsRef.current],
      }).catch((cause) => {
        void logEvent("session_checkpoint_failed", {
          correlationId: manifest.current?.id,
          level: "error",
          fields: {
            stage: "periodic",
            error: cause instanceof Error ? cause.message : String(cause),
          },
        });
      });
    }
  });

  const start = (record: boolean, drill?: DrillDefinition) => {
    if (!profile || !calibration || !cameraStream || !model) return;
    const activeDrill = drill ?? selectedDrill ?? loadBuiltinDrills()[0];
    if (!activeDrill) return;
    const trainState = createTrainSession({
      drill: activeDrill,
      feedbackIntensity: intensity,
      sessionGoal: sessionGoal || undefined,
      comfortBefore,
      record,
      liveAssist,
      handsFreeAudio,
      countdownSec: handsFreeAudio ? HANDS_FREE_SETTLE_SECONDS : 3,
    });
    const counting = beginCountdown(trainState);
    setTrain(counting);
    trainRef.current = counting;
    predictions.current = [];
    features.current = [];
    events.current = [];
    cues.current = [];
    setCueCount(0);
    setSessionCues([]);
    lastSavedSessionRef.current = undefined;
    speakingSecRef.current = 0;
    speakingWindowsRef.current = [];
    pipeline.current = new MeasurementPipeline(model);
    policyRef.current = new FeedbackPolicyEngine({
      drill: activeDrill,
      intensity,
    });
    stopping.current = false;
    finalizedSessionId.current = undefined;
    handsFreeCompletionRef.current = undefined;
    setTesting(true);
    setRecording(false);
    setLatencyHistory([]);
    setLiveDroppedFrames(0);
    recordRequested.current = counting.config.record;
    recorderError.current = undefined;
    mediaStartedAtUs.current = undefined;
    activeStartMs.current = undefined;
    droppedFramesAtStart.current =
      typeof videoRef.current?.getVideoPlaybackQuality === "function"
        ? videoRef.current.getVideoPlaybackQuality().droppedVideoFrames
        : 0;
    setCaptureFailure(undefined);
    const startedAt = new Date();
    const baseManifest: SessionManifest = {
      schemaVersion: "1.0.0",
      id: crypto.randomUUID(),
      profileId: profile.id,
      calibrationId: calibration.id,
      trackerId: calibration.trackerId,
      trackerVersion: calibration.trackerVersion,
      algorithmVersion: ALGORITHM_VERSION,
      startedAt: startedAt.toISOString(),
      monotonicStartUs: Math.round(performance.now() * 1000),
      status: "recording",
      frameCount: 0,
      droppedFrameCount: 0,
    };
    let coached = buildCoachedManifest(baseManifest, counting);
    if (followedRecommendationId) {
      coached = { ...coached, followedRecommendationId };
    }
    if (datasetIntent !== "none") {
      const recordingConsent = consents.find(
        (entry) => !entry.revokedAt && entry.scopes.includes("recording"),
      );
      const datasetConsent = consents.find(
        (entry) => !entry.revokedAt && entry.scopes.includes("dataset_include"),
      );
      coached = attachDatasetIntent(coached, datasetIntent, {
        recordingConsentId: recordingConsent?.id,
        datasetConsentId: datasetConsent?.id,
        faceAnalysisConsentId: consents.find(
          (entry) => !entry.revokedAt && entry.scopes.includes("face_analysis"),
        )?.id,
        voiceAnalysisConsentId: consents.find(
          (entry) => !entry.revokedAt && entry.scopes.includes("voice_analysis"),
        )?.id,
      });
      if (coached.dataset) {
        coached = {
          ...coached,
          dataset: {
            ...coached.dataset,
            outfitLabel: outfitLabel || undefined,
            backgroundLabel: backgroundLabel || undefined,
          },
        };
      }
    }
    manifest.current = coached;
    lastCheckpoint.current = manifest.current.monotonicStartUs;
    void store.sessions.put({
      manifest: manifest.current,
      calibrationSnapshot: calibration,
      features: [],
      predictions: [],
      events: [],
      corrections: [],
      cues: [],
      speakingWindows: [],
    }).catch((cause) => {
      const message = `Initial session checkpoint failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`;
      setCaptureFailure(message);
      void logEvent("session_checkpoint_failed", {
        correlationId: manifest.current?.id,
        level: "error",
        fields: { stage: "initial", error: message },
      });
    });
    const beginMediaIfNeeded = () => {
      if (!recordRequested.current || !cameraStream) return;
      try {
        const tracks = [
          ...cameraStream.getVideoTracks(),
          ...(microphoneStream?.getAudioTracks() ?? []),
        ];
        const preferredMimeType =
          typeof MediaRecorder.isTypeSupported === "function" &&
          MediaRecorder.isTypeSupported("video/mp4;codecs=h264,aac")
            ? "video/mp4;codecs=h264,aac"
            : "video/webm";
        const options =
          typeof MediaRecorder.isTypeSupported !== "function" ||
          MediaRecorder.isTypeSupported(preferredMimeType)
            ? { mimeType: preferredMimeType }
            : undefined;
        const mediaRecorder = new MediaRecorder(new MediaStream(tracks), options);
        recorder.current = mediaRecorder;
        chunks.current = [];
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size) chunks.current.push(event.data);
        };
        mediaRecorder.onerror = (event) => {
          recorderError.current = `Media recorder failed: ${event.error.message}`;
          setCaptureFailure(recorderError.current);
          void logEvent("media_recorder_failed", {
            correlationId: manifest.current?.id,
            level: "error",
            fields: { error: event.error.message },
          });
          void stopRef.current("incomplete", recorderError.current);
        };
        mediaRecorder.onstart = () => {
          mediaStartedAtUs.current = Math.round(performance.now() * 1000);
        };
        mediaStartedAtUs.current = Math.round(performance.now() * 1000);
        mediaRecorder.start(1000);
        setRecording(true);
      } catch (cause) {
        const message = `Media recorder could not start: ${
          cause instanceof Error ? cause.message : String(cause)
        }`;
        recorderError.current = message;
        setCaptureFailure(message);
        void logEvent("media_recorder_start_failed", {
          correlationId: manifest.current?.id,
          level: "error",
          fields: { error: message },
        });
        void stopRef.current("incomplete", message);
      }
    };
    beginMediaRef.current = beginMediaIfNeeded;
    void logEvent("measurement_started", {
      correlationId: manifest.current.id,
      fields: {
        profileId: profile.id,
        calibrationId: calibration.id,
        drillId: activeDrill.id,
        record: recordRequested.current,
      },
    });
  };

  const vadFinishRef = useRef(vad.finish);
  useEffect(() => {
    vadFinishRef.current = vad.finish;
  }, [vad.finish]);

  const stop = useCallback(async (status: "complete" | "incomplete" = "complete", recoveryNote?: string) => {
    const activeManifest = manifest.current;
    if (!activeManifest || stopping.current) return;
    stopping.current = true;
    // Close VAD windows before disabling tracking so speaking seconds are available for completion.
    const closedWindows = vadFinishRef.current();
    speakingSecRef.current = speakingSeconds(closedWindows);
    const speakingWindows = closedWindows.map((window) => ({
      startUs: window.startUs,
      endUs: window.endUs,
    }));
    speakingWindowsRef.current = speakingWindows;
    manifest.current = { ...activeManifest, status: "finalizing" };
    try {
      await store.sessions.put({
        manifest: manifest.current,
        calibrationSnapshot: calibration,
        features: [...features.current],
        predictions: [...predictions.current],
        events: [...events.current],
        corrections: [],
        cues: [...cues.current],
        speakingWindows,
      });
    } catch (cause) {
      const message = `Finalizing checkpoint failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`;
      setCaptureFailure(message);
      void logEvent("session_checkpoint_failed", {
        correlationId: activeManifest.id,
        level: "error",
        fields: { stage: "finalizing", error: message },
      });
    }
    setTesting(false);
    events.current.push(
      ...(pipeline.current?.finish(Math.round(performance.now() * 1000)) ?? []),
    );
    const finalize = async () => {
      if (finalizedSessionId.current === activeManifest.id) return;
      finalizedSessionId.current = activeManifest.id;
      const media = chunks.current.length ? new Blob(chunks.current, { type: recorder.current?.mimeType }) : undefined;
      const mediaValidation = recordingFinalization(
        recordRequested.current,
        media?.size ?? 0,
        recorderError.current,
      );
      const finalStatus = status === "incomplete" ? status : mediaValidation.status;
      const finalRecoveryNote = recoveryNote ?? mediaValidation.recoveryNote;
      const endedAt = new Date();
      const droppedFrameCount =
        typeof videoRef.current?.getVideoPlaybackQuality === "function"
          ? Math.max(
              0,
              videoRef.current.getVideoPlaybackQuality().droppedVideoFrames -
                droppedFramesAtStart.current,
            )
          : 0;
      const trainSnapshot = trainRef.current;
      const coachedManifest = trainSnapshot
        ? buildCoachedManifest(activeManifest, trainSnapshot)
        : activeManifest;
      const complete: StoredSession = {
        manifest: {
          ...coachedManifest,
          endedAt: endedAt.toISOString(),
          status: finalStatus,
          frameCount: predictions.current.length,
          droppedFrameCount,
          media: media
            ? {
                mimeType: media.type,
                monotonicStartUs:
                  mediaStartedAtUs.current ?? activeManifest.monotonicStartUs,
                byteLength: media.size,
                durationUs: Math.max(
                  0,
                  Math.round(performance.now() * 1000) -
                    (mediaStartedAtUs.current ?? activeManifest.monotonicStartUs),
                ),
              }
            : undefined,
          recoveryNote: finalRecoveryNote,
        },
        calibrationSnapshot: calibration,
        features: features.current,
        predictions: predictions.current,
        events: events.current,
        corrections: [],
        cues: [...cues.current],
        speakingWindows,
        media,
      };
      // Auto-propose clip ranges for dataset-intent sessions (ranges only, no media copy).
      if (
        complete.manifest.dataset?.intent === "dataset_candidate" ||
        complete.manifest.dataset?.intent === "coaching_only"
      ) {
        const durationUs =
          complete.manifest.media?.durationUs ??
          Math.max(
            0,
            (predictions.current.at(-1)?.timestampUs ?? 0) -
              complete.manifest.monotonicStartUs,
          );
        const proposals = proposeSegments({
          sessionId: complete.manifest.id,
          durationUs: durationUs || 30_000_000,
          speakingWindows,
          events: events.current,
          predictions: predictions.current,
        }).map((proposal) => ({
          id: proposal.id,
          sessionId: proposal.sessionId,
          startUs: proposal.startUs,
          endUs: proposal.endUs,
          reasonTags: proposal.reasons,
          proposedBy: "auto" as const,
          pointsIntoMaster: true as const,
        }));
        if (proposals.length) onClipsProposed?.(proposals);
      }
      let savedSession = complete;
      try {
        await store.sessions.put(complete);
      } catch (cause) {
        const message = `Final session persistence failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`;
        savedSession = {
          ...complete,
          manifest: {
            ...complete.manifest,
            status: "invalid",
            recoveryNote: `${message}. In-memory evidence remains available until the app exits.`,
          },
        };
        setCaptureFailure(savedSession.manifest.recoveryNote);
        void logEvent("session_persistence_failed", {
          correlationId: activeManifest.id,
          level: "error",
          fields: { error: message },
        });
      }
      lastSavedSessionRef.current = savedSession;
      onSession(savedSession);
      setRecording(false);
      setPrediction(undefined);
      recorder.current = undefined;
      manifest.current = undefined;
      stopping.current = false;
      // Preserve reflect/stopped train chrome for post-session notes; re-save after reflection.
      setTrain((current) => {
        if (!current) return current;
        if (current.emergencyStopped || current.phase === "stopped") {
          const finished = finishReflection(
            current,
            current.reflectionNotes,
            current.comfortAfter,
            speakingSecRef.current,
          );
          const updated = applyReflectionToSession(savedSession, finished);
          lastSavedSessionRef.current = updated;
          void store.sessions.put(updated).then(() => onSession(updated));
          return finished;
        }
        if (current.phase === "active" || current.phase === "countdown") {
          const reflecting = requestStop({ ...current, recording: false });
          trainRef.current = reflecting;
          return reflecting;
        }
        return current;
      });
      void logEvent("measurement_finalized", {
        correlationId: savedSession.manifest.id,
        fields: {
          status: savedSession.manifest.status,
          frameCount: savedSession.manifest.frameCount,
          droppedFrameCount: savedSession.manifest.droppedFrameCount,
        },
      });
    };
    if (recorder.current?.state === "recording") {
      const activeRecorder = recorder.current;
      const fallback = { timer: undefined as number | undefined };
      const finalizeAfterStop = () => {
        if (fallback.timer !== undefined) window.clearTimeout(fallback.timer);
        void finalize();
      };
      activeRecorder.addEventListener("stop", finalizeAfterStop, { once: true });
      try {
        activeRecorder.stop();
        fallback.timer = window.setTimeout(finalizeAfterStop, 3_000);
      } catch (cause) {
        const message = `Media recorder could not stop cleanly: ${
          cause instanceof Error ? cause.message : String(cause)
        }`;
        recorderError.current = message;
        setCaptureFailure(message);
        void logEvent("media_recorder_stop_failed", {
          correlationId: activeManifest.id,
          level: "error",
          fields: { error: message },
        });
        await finalize();
      }
    } else {
      await finalize();
    }
  }, [calibration, onClipsProposed, onSession, videoRef]);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  // Countdown → active train loop (does not block measurement on transcription).
  const trainPhase = train?.phase;
  useEffect(() => {
    if (!trainPhase || (trainPhase !== "countdown" && trainPhase !== "active")) return;
    const timer = window.setInterval(() => {
      setTrain((current) => {
        if (!current) return current;
        if (current.phase === "countdown") {
          const next = tickCountdown(current);
          if (next.phase === "active") {
            activeStartMs.current = performance.now();
            if (next.config.handsFreeAudio) {
              void playCoachingTone("start");
            }
            beginMediaRef.current();
          }
          trainRef.current = next;
          return next;
        }
        if (current.phase === "active") {
          const next = tickActive(current, 1);
          trainRef.current = next;
          return next;
        }
        return current;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [trainPhase]);

  useEffect(() => {
    const activeManifest = manifest.current;
    if (
      !activeManifest ||
      train?.phase !== "active" ||
      !train.config.handsFreeAudio ||
      !shouldAutoCompleteHandsFreeDrill(
        train.config.drill,
        train.elapsedActiveSec,
      ) ||
      handsFreeCompletionRef.current === activeManifest.id
    ) {
      return;
    }
    handsFreeCompletionRef.current = activeManifest.id;
    void stopRef.current("complete");
    void playCoachingTone("complete");
  }, [
    train?.config.drill,
    train?.config.handsFreeAudio,
    train?.elapsedActiveSec,
    train?.phase,
  ]);

  useEffect(() => {
    return () => {
      cancelCoachingAudio();
      if (manifest.current && !stopping.current) {
        void stopRef.current(
          "incomplete",
          "The measurement view was closed before the session was finalized.",
        );
      }
    };
  }, []);

  useEffect(() => {
    const track = cameraStream?.getVideoTracks()[0];
    if (!track) return;
    const handleEnded = () => {
      setCaptureFailure("Camera disconnected. The session was stopped and marked incomplete.");
      void logEvent("camera_track_ended", {
        correlationId: manifest.current?.id,
        level: "warn",
      });
      if (testing) void stopRef.current("incomplete", "Camera device was removed during measurement.");
    };
    track.addEventListener("ended", handleEnded);
    return () => track.removeEventListener("ended", handleEnded);
  }, [cameraStream, testing]);

  useEffect(() => {
    const track = microphoneStream?.getAudioTracks()[0];
    if (!track) return;
    const handleEnded = () => {
      if (!recording) return;
      const message =
        "Microphone disconnected. The recording was stopped and marked incomplete.";
      setCaptureFailure(message);
      void logEvent("microphone_track_ended", {
        correlationId: manifest.current?.id,
        level: "warn",
      });
      void stopRef.current(
        "incomplete",
        "Microphone device was removed during recording.",
      );
    };
    track.addEventListener("ended", handleEnded);
    return () => track.removeEventListener("ended", handleEnded);
  }, [microphoneStream, recording]);

  useEffect(() => {
    if (!testing) return;
    const checkpoint = () => {
      if (!manifest.current) return;
      void store.sessions.put({
        manifest: {
          ...manifest.current,
          frameCount: predictions.current.length,
        },
        calibrationSnapshot: calibration,
        features: [...features.current],
        predictions: [...predictions.current],
        events: [...events.current],
        corrections: [],
        cues: [...cues.current],
        speakingWindows: [...speakingWindowsRef.current],
      }).catch((cause) => {
        void logEvent("session_checkpoint_failed", {
          correlationId: manifest.current?.id,
          level: "error",
          fields: {
            stage: "visibility",
            error: cause instanceof Error ? cause.message : String(cause),
          },
        });
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") checkpoint();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", checkpoint);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", checkpoint);
    };
  }, [calibration, testing]);

  if (!profile || !calibration || !cameraStream) {
    return (
      <section className="empty-state">
        <h1>Calibration required.</h1>
        <p>
          {calibrationIssue
            ? `Saved calibration unavailable: ${calibrationIssue}`
            : "Select a profile, enable preview, and save a valid calibration."}
        </p>
      </section>
    );
  }

  const elapsedActiveSec = train?.elapsedActiveSec ?? 0;
  const promptDrill = train?.config.drill ?? selectedDrill;

  return (
    <section className="measure-screen train-screen">
      <VideoPreview
        stream={cameraStream}
        videoRef={videoRef}
        state={testing ? prediction?.state ?? "unknown" : undefined}
        lensAnchor={profile.lensAnchor}
        cuePulse={lastCueKind === "pulse" || lastCueKind === "halo"}
        promptOverlay={
          testing && promptDrill && train && (train.phase === "active" || train.phase === "countdown") ? (
            <LensAdjacentPromptOverlay
              drill={promptDrill}
              anchor={profile.lensAnchor}
              elapsedSec={train.phase === "countdown" ? 0 : elapsedActiveSec}
              speaking={speaking}
              largeText={largeText}
              hiddenOverride={train.phase === "countdown"}
            />
          ) : undefined
        }
      />
      <div className="measure-copy">
        <p className="eyebrow">{profile.name} · Train</p>
        <h1>
          {train?.phase === "reflect"
            ? "Session complete."
            : testing
              ? "Speak naturally."
              : "Choose a drill and train."}
        </h1>
        <p>
          {testing
            ? "Lens-adjacent prompts stay near the camera. Cues stay restrained. No dense scores while you speak."
            : "Select a curriculum drill, feedback intensity, and optional goal. Recording never starts on its own after restart."}
        </p>
        {promptPlacementIssue && (
          <p className="tracking-warning" role="alert">
            {promptPlacementIssue}
          </p>
        )}
        <RecordingPrivacyBadge
          label={
            liveAssist
              ? recording
                ? "LIVE ASSIST — RECORDING"
                : "LIVE ASSIST — NOT RECORDING"
              : recording
                ? "RECORDING"
                : "NOT RECORDING"
          }
        />
        {!testing && train?.phase !== "reflect" && (
          <>
            <DrillSetupForm
              drills={drills}
              selectedId={selectedDrill?.id ?? ""}
              onSelectId={(id) => {
                setSelectedDrillId(id);
                const next = drills.find((drill) => drill.id === id);
                if (next) {
                  setIntensity(next.contactPolicy.feedbackLevel);
                  if (next.recordingDefault === "off" || next.liveAssist) {
                    setWantRecord(false);
                    setLiveAssist(next.liveAssist);
                  }
                }
              }}
              intensity={intensity}
              onIntensity={setIntensity}
              sessionGoal={sessionGoal}
              onSessionGoal={setSessionGoal}
              comfortBefore={comfortBefore}
              onComfortBefore={setComfortBefore}
              record={wantRecord}
              onRecord={setWantRecord}
              largeText={largeText}
              onLargeText={setLargeText}
              liveAssist={liveAssist}
              onLiveAssist={setLiveAssist}
              handsFreeAudio={handsFreeAudio}
              onHandsFreeAudio={setHandsFreeAudio}
              disabled={preparingAudio}
            />
            <CustomDrillImport
              disabled={preparingAudio}
              drills={customDrills}
              onCreate={async ({
                name,
                outline,
                durationTargetSec,
                phraseStartSec,
              }) => {
                const custom = drillFromOutline(outline, {
                  id: `custom-outline-${crypto.randomUUID()}`,
                  name,
                  durationTargetSec,
                  phraseStartSec,
                });
                const next = await store.customDrills.upsert(custom);
                setCustomDrills(next);
                setSelectedDrillId(custom.id);
                setIntensity(custom.contactPolicy.feedbackLevel);
              }}
              onUpdate={async (
                existing,
                { name, outline, durationTargetSec, phraseStartSec },
              ) => {
                const revised = reviseOutlineDrill(existing, outline, {
                  name,
                  durationTargetSec,
                  phraseStartSec,
                });
                const next = await store.customDrills.upsert(revised);
                setCustomDrills(next);
                setSelectedDrillId(revised.id);
                setIntensity(revised.contactPolicy.feedbackLevel);
              }}
              onDelete={async (drill) => {
                const next = await store.customDrills.remove(drill.id);
                setCustomDrills(next);
                if (selectedDrillId === drill.id) {
                  const fallback = builtinDrills[0];
                  setSelectedDrillId(fallback?.id ?? "");
                  if (fallback) {
                    setIntensity(fallback.contactPolicy.feedbackLevel);
                  }
                }
              }}
            />
            <div className="train-setup">
              <label>
                Dataset intent
                <select
                  value={datasetIntent}
                  onChange={(event) =>
                    setDatasetIntent(event.target.value as DatasetIntent)
                  }
                >
                  <option value="none">none (coaching only)</option>
                  <option value="coaching_only">coaching_only</option>
                  <option value="dataset_candidate">dataset_candidate</option>
                </select>
              </label>
              {datasetIntent !== "none" && (
                <>
                  <label>
                    Outfit label
                    <input
                      value={outfitLabel}
                      onChange={(event) => setOutfitLabel(event.target.value)}
                      placeholder="e.g. navy shirt"
                    />
                  </label>
                  <label>
                    Background label
                    <input
                      value={backgroundLabel}
                      onChange={(event) => setBackgroundLabel(event.target.value)}
                      placeholder="e.g. bookshelf"
                    />
                  </label>
                </>
              )}
            </div>
            {preflightMessage && (
              <p className="tracking-warning">{preflightMessage}</p>
            )}
            {!microphoneStream && wantRecord && (
              <p className="tracking-warning">
                Microphone is not active. A recorded test will contain video only.
              </p>
            )}
            <div className="button-row">
              <button
                type="button"
                disabled={preparingAudio}
                onClick={async () => {
                  if (datasetIntent !== "none") {
                    const recordingConsent = consents.find(
                      (entry) =>
                        !entry.revokedAt && entry.scopes.includes("recording"),
                    );
                    const datasetConsent = consents.find(
                      (entry) =>
                        !entry.revokedAt &&
                        entry.scopes.includes("dataset_include"),
                    );
                    const preflight = evaluatePreflight({
                      intent: datasetIntent,
                      consents,
                      recordingConsentId: recordingConsent?.id,
                      datasetConsentId: datasetConsent?.id,
                      faceDetectedRatio: 0.98,
                      faceScale: 0.28,
                      brightnessOk: true,
                      audioPeakDbfs: -12,
                      roomNoiseDbfs: -50,
                      diskFreeBytes: 50_000_000_000,
                      estimatedSessionBytes: 2_000_000_000,
                      outfitLabel: outfitLabel || undefined,
                      backgroundLabel: backgroundLabel || undefined,
                    });
                    if (!preflight.ready) {
                      setPreflightMessage(
                        `Preflight blocked: ${preflight.blockers.join(", ")}`,
                      );
                      return;
                    }
                    if (preflight.warnings.length) {
                      setPreflightMessage(
                        `Preflight warnings: ${preflight.warnings.join(", ")}`,
                      );
                    } else {
                      setPreflightMessage(undefined);
                    }
                  } else {
                    setPreflightMessage(undefined);
                  }
                  if (handsFreeAudio && selectedDrill) {
                    setPreparingAudio(true);
                    try {
                      await prepareHandsFreeDrill(selectedDrill);
                    } finally {
                      setPreparingAudio(false);
                    }
                  }
                  start(wantRecord && !liveAssist);
                }}
              >
                {preparingAudio ? "Giving audio instructions…" : "Start drill"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setManualSpeaking((value) => !value);
                }}
                title="Manual speaking override for hide-on-speech when no mic is active"
              >
                Speaking: {speaking ? "yes" : "no"}
                {vad.speaking ? " (VAD)" : manualSpeaking ? " (manual)" : ""}
              </button>
            </div>
          </>
        )}
        {train && (train.phase === "countdown" || train.phase === "active") && (
          <TrainActiveChrome
            train={{ ...train, recording }}
            onEmergencyStop={() => {
              cancelCoachingAudio();
              const stopped = emergencyStop(trainRef.current ?? train);
              setTrain(stopped);
              trainRef.current = stopped;
              void stop("incomplete", "Emergency stop");
            }}
            onStop={() => {
              if (train.config.handsFreeAudio) {
                void playCoachingTone("complete");
              }
              void stop("complete");
            }}
          />
        )}
        {train?.phase === "reflect" && (
          <ReflectionForm
            reflectionPrompts={train.config.drill.reflection}
            onFinish={(notes, comfortAfter) => {
              const finished = finishReflection(
                trainRef.current ?? train,
                notes,
                comfortAfter,
                speakingSecRef.current,
              );
              setTrain(finished);
              trainRef.current = finished;
              const prior = lastSavedSessionRef.current;
              if (prior) {
                const updated = applyReflectionToSession(prior, finished);
                lastSavedSessionRef.current = updated;
                void store.sessions.put(updated).then(() => onSession(updated));
              }
            }}
          />
        )}
        {sessionCues.length > 0 && (train?.phase === "reflect" || train?.phase === "complete") && (
          <div className="panel cue-rating-panel">
            <h2>Rate cues</h2>
            <p className="muted">Mark each cue helpful, unnecessary, or wrong.</p>
            {sessionCues.map((cue) => (
              <div key={cue.id} className="cue-rating-row">
                <span>
                  {cue.kind} @ {(cue.timestampUs / 1_000_000).toFixed(1)}s
                  {cue.rating ? ` · ${cue.rating}` : ""}
                </span>
                <div className="button-row">
                  {(["helpful", "unnecessary", "wrong"] as const).map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      className="secondary"
                      onClick={() => {
                        policyRef.current?.rateCue(cue.id, rating);
                        cues.current = cues.current.map((entry) =>
                          entry.id === cue.id ? { ...entry, rating } : entry,
                        );
                        setSessionCues([...cues.current]);
                        const prior = lastSavedSessionRef.current;
                        if (prior) {
                          const updated = rateSessionCue(prior, cue.id, rating);
                          lastSavedSessionRef.current = updated;
                          void store.sessions.put(updated).then(() => onSession(updated));
                        }
                      }}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {train?.phase === "complete" && (
          <p className="muted">
            {train.completed ? "Drill completion criteria met." : "Session saved without completion credit."}
            {" "}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setTrain(undefined);
                trainRef.current = undefined;
              }}
            >
              Train again
            </button>
          </p>
        )}
        {captureFailure && <p className="tracking-warning">{captureFailure}</p>}
        {liveTracker.error && <p className="tracking-warning">Tracker unavailable: {liveTracker.error}</p>}
        {testing && prediction?.state === "unknown" && <p className="tracking-warning">Tracking is uncertain—no correction is inferred.</p>}
        {debug && (
          <dl className="diagnostics">
            <div><dt>Confidence</dt><dd>{Math.round((prediction?.confidence ?? 0) * 100)}%</dd></div>
            <div><dt>Class probabilities</dt><dd>
              {prediction?.classProbabilities
                ? `contact ${Math.round(prediction.classProbabilities.contact * 100)}% · near ${Math.round(prediction.classProbabilities.near_lens * 100)}% · away ${Math.round(prediction.classProbabilities.off_lens * 100)}% · unknown ${Math.round(prediction.classProbabilities.unknown * 100)}%`
                : "—"}
            </dd></div>
            <div><dt>Frame latency</dt><dd>{lastFeature?.analysisLatencyMs?.toFixed(1) ?? "—"} ms</dd></div>
            <div><dt>Latency history</dt><dd><LatencySparkline values={latencyHistory} /></dd></div>
            <div><dt>Dropped frames</dt><dd>{liveDroppedFrames}</dd></div>
            <div><dt>Eye yaw / pitch</dt><dd>{lastFeature?.eyeYaw.toFixed(3) ?? "—"} / {lastFeature?.eyePitch.toFixed(3) ?? "—"}</dd></div>
            <div><dt>Head yaw / pitch</dt><dd>{lastFeature?.headYaw.toFixed(3) ?? "—"} / {lastFeature?.headPitch.toFixed(3) ?? "—"}</dd></div>
            <div><dt>Calibration</dt><dd>{calibration.id.slice(0, 8)}</dd></div>
            <div><dt>Tracker</dt><dd>{calibration.trackerId}</dd></div>
            <div><dt>Model</dt><dd>{calibration.trackerVersion}</dd></div>
            <div><dt>Drill</dt><dd>{selectedDrill?.id ?? "—"}</dd></div>
            <div><dt>Cues</dt><dd>{cueCount}</dd></div>
          </dl>
        )}
      </div>
    </section>
  );
}

function Review({
  sessions,
  onUpdated,
  featureFlags,
}: {
  sessions: StoredSession[];
  onUpdated: (session: StoredSession) => void;
  featureFlags: FeatureFlags;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [blind, setBlind] = useState(false);
  const [range, setRange] = useState({
    start: "0",
    end: "1",
    label: "contact" as Correction["label"],
    note: "",
  });
  const [comparison, setComparison] = useState<{
    trackerId?: string;
    trackerVersion?: string;
    algorithmVersion: string;
    predictions: GazePrediction[];
  }>();
  const [comparisonError, setComparisonError] = useState<string>();
  const [correctionError, setCorrectionError] = useState<string>();
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [timelineZoom, setTimelineZoom] =
    useState<ReviewTimelineZoom>(1);
  const [bookmarkNote, setBookmarkNote] = useState("");
  const [bookmarkError, setBookmarkError] = useState<string>();
  const [sentenceDraft, setSentenceDraft] = useState({
    start: "0",
    end: "1",
    text: "",
  });
  const [editingSentenceIndex, setEditingSentenceIndex] = useState<number>();
  const [editingWordIndex, setEditingWordIndex] = useState<number>();
  const [wordDraft, setWordDraft] = useState("");
  const [transcriptError, setTranscriptError] = useState<string>();
  const [transcriptNotice, setTranscriptNotice] = useState<string>();
  const [clipDraft, setClipDraft] = useState({
    start: "0",
    end: "1",
    note: "",
  });
  const [clipError, setClipError] = useState<string>();
  const playbackRef = useRef<HTMLVideoElement>(null);
  const selected = sessions.find((session) => session.manifest.id === selectedId) ?? sessions[0];
  const effectiveTranscript =
    selected?.correctedTranscript ?? selected?.transcript;
  const speechStructureAnalysis = useMemo(
    () =>
      selected && effectiveTranscript
        ? detectSpeechStructure(
            selected.manifest.id,
            effectiveTranscript.words,
            selected.speakingWindows,
          )
        : undefined,
    [effectiveTranscript, selected],
  );
  const reviewOriginUs =
    selected?.manifest.media?.monotonicStartUs ??
    selected?.manifest.monotonicStartUs ??
    0;
  const metrics = useMemo(
    () => selected ? calculateConfusionMatrix(selected.predictions, selected.corrections) : undefined,
    [selected],
  );
  const eventTiming = useMemo(
    () => selected ? calculateEventTiming(selected.predictions, selected.corrections) : undefined,
    [selected],
  );
  const comparisonMetrics = useMemo(
    () => selected && comparison
      ? calculateConfusionMatrix(comparison.predictions, selected.corrections)
      : undefined,
    [comparison, selected],
  );
  const comparisonEventTiming = useMemo(
    () => selected && comparison
      ? calculateEventTiming(comparison.predictions, selected.corrections)
      : undefined,
    [comparison, selected],
  );
  const playbackPrediction = useMemo(
    () => selected
      ? predictionAtPlaybackTime(
          selected.predictions,
          reviewOriginUs,
          playbackTime,
        )
      : undefined,
    [playbackTime, reviewOriginUs, selected],
  );
  const timelineDurationUs =
    selected?.media && playbackDuration > 0
      ? Math.round(playbackDuration * 1_000_000)
      : selected?.manifest.media?.durationUs ??
        Math.max(
          0,
          (selected?.predictions.at(-1)?.timestampUs ?? 0) -
            reviewOriginUs,
        );
  const timelineSegments = useMemo(
    () => selected
      ? predictionTimelineSegments(
          selected.predictions,
          reviewOriginUs,
          timelineDurationUs,
        )
      : [],
    [reviewOriginUs, selected, timelineDurationUs],
  );
  const reviewViewport = useMemo(
    () =>
      timelineViewport(
        timelineDurationUs || 1,
        timelineZoom,
        Math.round(playbackTime * 1_000_000),
      ),
    [playbackTime, timelineDurationUs, timelineZoom],
  );
  const reviewDrillId = selected?.manifest.coaching?.drillId;
  const reviewDrill = useMemo(
    () =>
      selected?.manifest.coaching?.drillSnapshot ??
      (reviewDrillId ? getDrillById(reviewDrillId) : undefined),
    [reviewDrillId, selected?.manifest.coaching?.drillSnapshot],
  );
  const multiLanes = useMemo(
    () =>
      selected
        ? buildReviewLanes({
            originUs: reviewOriginUs,
            durationUs: timelineDurationUs || 1,
            predictions: selected.predictions,
            events: selected.events,
            cues: selected.cues,
            drill: reviewDrill,
            speakingWindows: selected.speakingWindows,
            sentences: effectiveTranscript?.sentences,
            bookmarks: selected.bookmarks,
            reviewClips: selected.reviewClips,
          })
        : [],
    [
      effectiveTranscript?.sentences,
      reviewDrill,
      reviewOriginUs,
      selected,
      timelineDurationUs,
    ],
  );
  const mediaUrl = useMemo(() => selected?.media ? URL.createObjectURL(selected.media) : undefined, [selected]);
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);
  useEffect(() => {
    setPlaybackTime(0);
    setPlaybackDuration(0);
    setTimelineZoom(1);
    setBookmarkNote("");
    setBookmarkError(undefined);
    setSentenceDraft({ start: "0", end: "1", text: "" });
    setEditingSentenceIndex(undefined);
    setEditingWordIndex(undefined);
    setWordDraft("");
    setTranscriptError(undefined);
    setTranscriptNotice(undefined);
    setClipDraft({ start: "0", end: "1", note: "" });
    setClipError(undefined);
  }, [selected?.manifest.id]);

  const addCorrection = async () => {
    if (!selected) return;
    const startSeconds = Number(range.start);
    const endSeconds = Number(range.end);
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      endSeconds <= startSeconds
    ) {
      setCorrectionError("Enter a non-negative start and an end time greater than the start.");
      return;
    }
    const availableSeconds = timelineDurationUs / 1_000_000;
    if (availableSeconds <= 0 || endSeconds > availableSeconds + 0.05) {
      setCorrectionError(
        `The label must end within the ${availableSeconds.toFixed(2)}-second session.`,
      );
      return;
    }
    const correction: Correction = {
      id: crypto.randomUUID(),
      sessionId: selected.manifest.id,
      startUs: sessionRelativeSecondsToUs(reviewOriginUs, startSeconds),
      endUs: sessionRelativeSecondsToUs(reviewOriginUs, endSeconds),
      label: range.label,
      createdAt: new Date().toISOString(),
      note: range.note || undefined,
    };
    const updated = { ...selected, corrections: [...selected.corrections, correction] };
    try {
      await store.sessions.put(updated);
      onUpdated(updated);
      setCorrectionError(undefined);
    } catch (cause) {
      setCorrectionError(
        `Correction could not be saved: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  const loadComparison = async (file?: File) => {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as {
        trackerId?: string;
        trackerVersion?: string;
        algorithmVersion?: string;
        predictionOriginUs?: number;
        sourceSessionId?: string;
        predictions?: unknown[];
      };
      if (!value.algorithmVersion || !Array.isArray(value.predictions)) {
        throw new Error(
          "Comparison file does not contain an algorithm version and predictions.",
        );
      }
      const parsedPredictions = value.predictions.map((prediction) =>
        gazePredictionSchema.parse(prediction),
      );
      const crossTracker = Boolean(
        selected &&
        value.trackerId &&
        value.trackerId !== selected.manifest.trackerId,
      );
      if (
        selected &&
        value.sourceSessionId &&
        value.sourceSessionId !== selected.manifest.id
      ) {
        throw new Error(
          `Comparison output belongs to session ${value.sourceSessionId}, not the selected session.`,
        );
      }
      if (
        crossTracker &&
        !featureFlags.experimentalTrackerComparison
      ) {
        setComparison(undefined);
        setComparisonError(
          "This file uses a different tracker backend. Enable the experimental tracker-comparison flag to import it.",
        );
        return;
      }
      if (
        crossTracker &&
        (
          value.predictionOriginUs === undefined ||
          !Number.isFinite(value.predictionOriginUs)
        )
      ) {
        throw new Error(
          "Cross-tracker comparison needs predictionOriginUs so timestamps can be aligned.",
        );
      }
      const alignedPredictions =
        crossTracker && selected && value.predictionOriginUs !== undefined
          ? rebasePredictionTimestamps(
              parsedPredictions,
              value.predictionOriginUs,
              reviewOriginUs,
            )
          : parsedPredictions;
      setComparisonError(undefined);
      setComparison({
        trackerId: value.trackerId,
        trackerVersion: value.trackerVersion,
        algorithmVersion: value.algorithmVersion,
        predictions: alignedPredictions,
      });
    } catch (cause) {
      setComparison(undefined);
      setComparisonError(
        cause instanceof Error
          ? `Comparison import failed: ${cause.message}`
          : "Comparison import failed.",
      );
    }
  };

  const exportLabels = () => {
    if (!selected) return;
    downloadJson(`labels-${selected.manifest.id}.json`, {
      schemaVersion: "1.0.0",
      sessionId: selected.manifest.id,
      trackerId: selected.manifest.trackerId,
      trackerVersion: selected.manifest.trackerVersion,
      algorithmVersion: selected.manifest.algorithmVersion,
      corrections: selected.corrections,
      metrics,
      eventTiming,
    });
  };

  const exportAnalysis = () => {
    if (!selected) return;
    downloadJson(`session-${selected.manifest.id}.json`, {
      manifest: selected.manifest,
      calibrationSnapshot: selected.calibrationSnapshot,
      features: selected.features,
      predictions: selected.predictions,
      events: selected.events,
      corrections: selected.corrections,
      cues: selected.cues ?? [],
      speakingWindows: selected.speakingWindows ?? [],
      bookmarks: selected.bookmarks ?? [],
      reviewClips: selected.reviewClips ?? [],
      transcript: selected.transcript,
      correctedTranscript: selected.correctedTranscript,
      transcriptRevisions: selected.transcriptRevisions ?? [],
      speechStructureAnalysis,
    });
  };

  const exportSessionReport = () => {
    if (!selected) return;
    const report = buildSessionReport({
      manifest: selected.manifest,
      predictions: selected.predictions,
      events: selected.events,
      cues: selected.cues,
      drill: reviewDrill,
      speakingWindows: selected.speakingWindows,
      sentences: effectiveTranscript?.sentences,
      bookmarks: selected.bookmarks,
      reviewClips: selected.reviewClips,
      originUs: reviewOriginUs,
      durationUs: timelineDurationUs || 1,
    });
    downloadJson(`report-${selected.manifest.id}.json`, report);
    const markdownUrl = URL.createObjectURL(
      new Blob([report.markdown], { type: "text/markdown" }),
    );
    const link = document.createElement("a");
    link.href = markdownUrl;
    link.download = `report-${selected.manifest.id}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(markdownUrl), 1_000);
  };

  const seekToTimelineUs = (timestampUs: number) => {
    if (!playbackRef.current) return;
    playbackRef.current.currentTime = seekSecondsFromTimelineUs(timestampUs);
  };

  const handleTimelineKeyDown = (
    event: React.KeyboardEvent<HTMLElement>,
  ) => {
    const target = keyboardSeekSeconds({
      key: event.key,
      currentSeconds: playbackRef.current?.currentTime ?? playbackTime,
      durationSeconds:
        playbackRef.current?.duration ||
        playbackDuration ||
        timelineDurationUs / 1_000_000,
      shiftKey: event.shiftKey,
    });
    if (target === undefined || !playbackRef.current) return;
    event.preventDefault();
    playbackRef.current.currentTime = target;
    setPlaybackTime(target);
  };

  const addBookmark = async () => {
    if (!selected || !bookmarkNote.trim()) return;
    const bookmark: ReviewBookmark = {
      id: crypto.randomUUID(),
      sessionId: selected.manifest.id,
      timestampUs: Math.min(
        timelineDurationUs,
        Math.max(0, Math.round(playbackTime * 1_000_000)),
      ),
      note: bookmarkNote.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = {
      ...selected,
      bookmarks: [...(selected.bookmarks ?? []), bookmark],
    };
    try {
      await store.sessions.put(updated);
      onUpdated(updated);
      setBookmarkNote("");
      setBookmarkError(undefined);
    } catch (cause) {
      setBookmarkError(
        `Bookmark could not be saved: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  const removeBookmark = async (bookmarkId: string) => {
    if (!selected) return;
    const updated = {
      ...selected,
      bookmarks: (selected.bookmarks ?? []).filter(
        (bookmark) => bookmark.id !== bookmarkId,
      ),
    };
    try {
      await store.sessions.put(updated);
      onUpdated(updated);
      setBookmarkError(undefined);
    } catch (cause) {
      setBookmarkError(
        `Bookmark could not be deleted: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  const persistSentenceBoundaries = async (
    sentences: SentenceBoundary[],
    successMessage: string,
  ) => {
    if (!selected) return;
    try {
      const original =
        selected.transcript ??
        materializeTranscript(selected.manifest.id, {
          status: "absent",
          error: "manual_review_before_asr",
        });
      const { corrected } = applySentenceBoundaryCorrections(
        original,
        sentences,
        effectiveTranscript?.words ?? original.words,
      );
      const updated = appendTranscriptRevision({
        ...selected,
        transcript: original,
      }, corrected);
      await store.sessions.put(updated);
      onUpdated(updated);
      setTranscriptError(undefined);
      setTranscriptNotice(successMessage);
    } catch (cause) {
      setTranscriptError(
        `Sentence boundaries could not be saved: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      throw cause;
    }
  };

  const loadTranscript = async (file?: File) => {
    if (!file || !selected) return;
    try {
      const parsed = transcriptDocumentSchema.parse(
        JSON.parse(await file.text()),
      );
      if (parsed.sessionId !== selected.manifest.id) {
        throw new Error(
          `Transcript belongs to session ${parsed.sessionId}, not the selected session.`,
        );
      }
      const availableUs = timelineDurationUs;
      if (
        availableUs > 0 &&
        parsed.sentences.some((sentence) => sentence.endUs > availableUs + 50_000)
      ) {
        throw new Error("A sentence boundary falls outside the recorded session.");
      }
      let updated: StoredSession;
      if (parsed.origin === "user_corrected") {
        const original =
          selected.transcript ??
          materializeTranscript(selected.manifest.id, {
            status: "absent",
            error: "corrected_transcript_imported_without_original",
          });
        const corrected: TranscriptDocument = {
          ...applySentenceBoundaryCorrections(
            original,
            parsed.sentences,
            parsed.words,
          ).corrected,
          modelVersion: parsed.modelVersion,
          updatedAt: parsed.updatedAt ?? new Date().toISOString(),
        };
        updated = appendTranscriptRevision({
          ...selected,
          transcript: original,
        }, corrected);
      } else {
        updated = {
          ...selected,
          transcript: {
            ...parsed,
            updatedAt: parsed.updatedAt ?? new Date().toISOString(),
          },
          correctedTranscript: undefined,
          transcriptRevisions: undefined,
        };
      }
      await store.sessions.put(updated);
      onUpdated(updated);
      setTranscriptError(undefined);
      setTranscriptNotice(
        parsed.origin === "user_corrected"
          ? "Corrected transcript imported; the original evidence remains separate."
          : "Timestamped transcript imported and attached to this session.",
      );
    } catch (cause) {
      setTranscriptNotice(undefined);
      setTranscriptError(
        `Transcript import failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  const saveSentenceBoundary = async () => {
    if (!selected) return;
    const startSeconds = Number(sentenceDraft.start);
    const endSeconds = Number(sentenceDraft.end);
    const text = sentenceDraft.text.trim();
    const availableSeconds = timelineDurationUs / 1_000_000;
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      endSeconds <= startSeconds ||
      !text
    ) {
      setTranscriptError(
        "Enter sentence text, a non-negative start, and an end after the start.",
      );
      return;
    }
    if (availableSeconds <= 0 || endSeconds > availableSeconds + 0.05) {
      setTranscriptError(
        `The sentence must end within the ${availableSeconds.toFixed(2)}-second session.`,
      );
      return;
    }
    const current = effectiveTranscript?.sentences ?? [];
    const next = current.filter(
      (sentence) => sentence.index !== editingSentenceIndex,
    );
    next.push({
      index: editingSentenceIndex ?? next.length,
      startUs: Math.round(startSeconds * 1_000_000),
      endUs: Math.round(endSeconds * 1_000_000),
      text,
    });
    try {
      await persistSentenceBoundaries(
        next,
        editingSentenceIndex === undefined
          ? "Sentence boundary added."
          : "Sentence boundary updated.",
      );
      setSentenceDraft({ start: "0", end: "1", text: "" });
      setEditingSentenceIndex(undefined);
    } catch {
      // The persistence helper exposes a user-readable validation error.
    }
  };

  const editSentenceBoundary = (sentence: SentenceBoundary) => {
    setSentenceDraft({
      start: (sentence.startUs / 1_000_000).toFixed(2),
      end: (sentence.endUs / 1_000_000).toFixed(2),
      text: sentence.text,
    });
    setEditingSentenceIndex(sentence.index);
    setTranscriptError(undefined);
    setTranscriptNotice(undefined);
  };

  const removeSentenceBoundary = async (sentenceIndex: number) => {
    const remaining = (effectiveTranscript?.sentences ?? []).filter(
      (sentence) => sentence.index !== sentenceIndex,
    );
    try {
      await persistSentenceBoundaries(remaining, "Sentence boundary deleted.");
      if (editingSentenceIndex === sentenceIndex) {
        setEditingSentenceIndex(undefined);
        setSentenceDraft({ start: "0", end: "1", text: "" });
      }
    } catch {
      // The persistence helper exposes a user-readable validation error.
    }
  };

  const editTranscriptWord = (word: TranscriptWord, wordIndex: number) => {
    setEditingWordIndex(wordIndex);
    setWordDraft(word.text);
    setTranscriptError(undefined);
    setTranscriptNotice(undefined);
  };

  const saveTranscriptWord = async () => {
    if (
      !selected ||
      !effectiveTranscript ||
      editingWordIndex === undefined
    ) {
      return;
    }
    try {
      const original =
        selected.transcript ??
        materializeTranscript(selected.manifest.id, {
          status: "absent",
          error: "manual_word_review_before_asr",
        });
      const { corrected } = applyTranscriptWordTextCorrection(
        original,
        effectiveTranscript,
        editingWordIndex,
        wordDraft,
      );
      const updated = appendTranscriptRevision({
        ...selected,
        transcript: original,
      }, corrected);
      await store.sessions.put(updated);
      onUpdated(updated);
      setEditingWordIndex(undefined);
      setWordDraft("");
      setTranscriptError(undefined);
      setTranscriptNotice("Word text corrected; timing and original evidence were preserved.");
    } catch (cause) {
      setTranscriptError(
        `Word correction could not be saved: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  const addReviewClip = async () => {
    if (!selected) return;
    const startSeconds = Number(clipDraft.start);
    const endSeconds = Number(clipDraft.end);
    const availableSeconds = timelineDurationUs / 1_000_000;
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      endSeconds <= startSeconds
    ) {
      setClipError("Enter a non-negative in point and an out point after it.");
      return;
    }
    if (availableSeconds <= 0 || endSeconds > availableSeconds + 0.05) {
      setClipError(
        `The clip must end within the ${availableSeconds.toFixed(2)}-second session.`,
      );
      return;
    }
    const clip: ReviewClip = {
      id: crypto.randomUUID(),
      sessionId: selected.manifest.id,
      startUs: Math.round(startSeconds * 1_000_000),
      endUs: Math.round(endSeconds * 1_000_000),
      note: clipDraft.note.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    const updated: StoredSession = {
      ...selected,
      reviewClips: [...(selected.reviewClips ?? []), clip],
    };
    try {
      await store.sessions.put(updated);
      onUpdated(updated);
      setClipDraft({ start: "0", end: "1", note: "" });
      setClipError(undefined);
    } catch (cause) {
      setClipError(
        `Review clip could not be saved: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  const removeReviewClip = async (clipId: string) => {
    if (!selected) return;
    const updated: StoredSession = {
      ...selected,
      reviewClips: (selected.reviewClips ?? []).filter(
        (clip) => clip.id !== clipId,
      ),
    };
    try {
      await store.sessions.put(updated);
      onUpdated(updated);
      setClipError(undefined);
    } catch (cause) {
      setClipError(
        `Review clip could not be deleted: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  return (
    <section className="screen">
      <div className="screen-copy">
        <p className="eyebrow">Ground-truth review</p>
        <h1>Inspect evidence. Correct the model.</h1>
      </div>
      <div className="review-grid">
        <aside className="session-list">
          {sessions.map((session) => (
            <button key={session.manifest.id} onClick={() => setSelectedId(session.manifest.id)}>
              <strong>{new Date(session.manifest.startedAt).toLocaleString()}</strong>
              <span>{session.manifest.frameCount} analyzed frames · {session.manifest.status}</span>
            </button>
          ))}
        </aside>
        {!selected ? <div className="panel">No completed tests yet.</div> : (
          <div className="review-main">
            {mediaUrl ? (
              <div className="playback-shell">
                <video
                  ref={playbackRef}
                  className="playback"
                  src={mediaUrl}
                  controls
                  onLoadedMetadata={(event) => setPlaybackDuration(event.currentTarget.duration)}
                  onTimeUpdate={(event) => setPlaybackTime(event.currentTarget.currentTime)}
                />
                {!blind && playbackPrediction && (
                  <div className={`playback-state ${playbackPrediction.state}`} aria-live="polite">
                    <strong>{stateLabel[playbackPrediction.state]}</strong>
                    <span>{Math.round(playbackPrediction.confidence * 100)}% tracker confidence</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="panel">
                {selected.manifest.media
                  ? "Recorded media is unavailable, but the tracking evidence and manifest were recovered."
                  : "Practice session has no media."}
              </div>
            )}
            <label className="blind-toggle"><input type="checkbox" checked={blind} onChange={(event) => setBlind(event.target.checked)} /> Blind labeling</label>
            {selected.manifest.coaching && (
              <p className="muted">
                Drill {selected.manifest.coaching.drillId} v{selected.manifest.coaching.drillVersion}
                {" · "}
                {selected.manifest.coaching.feedbackIntensity}
                {selected.manifest.coaching.sessionGoal
                  ? ` · Goal: ${selected.manifest.coaching.sessionGoal}`
                  : ""}
              </p>
            )}
            <div className="timeline-toolbar">
              <span className="muted">
                Evidence timeline {(reviewViewport.startUs / 1_000_000).toFixed(1)}–
                {(reviewViewport.endUs / 1_000_000).toFixed(1)}s
              </span>
              <div className="button-row" aria-label="Timeline zoom">
                {REVIEW_TIMELINE_ZOOM_LEVELS.map((zoom) => (
                  <button
                    key={zoom}
                    type="button"
                    className={timelineZoom === zoom ? "active" : "secondary"}
                    onClick={() => setTimelineZoom(zoom)}
                  >
                    {zoom}×
                  </button>
                ))}
              </div>
            </div>
            <div
              className="review-lanes"
              aria-label="Multi-lane coaching timeline"
              tabIndex={0}
              onKeyDown={handleTimelineKeyDown}
              title="Arrow keys seek 1 second; Shift+Arrow seeks 5 seconds; Home/End jump to session bounds."
            >
              {multiLanes.map((lane) => (
                <div className="review-lane" key={lane.id}>
                  <span>{lane.name}</span>
                  <div className="review-lane-track">
                    {lane.segments.map((segment, index) => {
                      const placement = segmentPercentInViewport(
                        segment,
                        reviewViewport,
                      );
                      if (!placement) return null;
                      return (
                        <button
                          type="button"
                          key={`${lane.id}-seg-${index}`}
                          className="review-lane-seg"
                          title={segment.label}
                          style={{
                            left: `${placement.leftPct}%`,
                            width: `${Math.max(placement.widthPct, 0.2)}%`,
                            background:
                              lane.id === "contact"
                                ? contactColor(segment.label)
                                : lane.id === "notes"
                                  ? "#5b7cfa88"
                                  : "#7ee2b855",
                          }}
                          onClick={() => seekToTimelineUs(segment.startUs)}
                        />
                      );
                    })}
                    {lane.markers.map((marker) => {
                      const leftPct = timestampPercentInViewport(
                        marker.timestampUs,
                        reviewViewport,
                      );
                      if (leftPct === undefined) return null;
                      return (
                        <button
                          type="button"
                          key={`${lane.id}-m-${marker.id ?? marker.timestampUs}`}
                          className="review-lane-marker"
                          title={`${marker.label} @ ${(marker.timestampUs / 1_000_000).toFixed(2)}s`}
                          style={{
                            left: `${leftPct}%`,
                            background:
                              marker.kind === "cue"
                                ? "#e8c86b"
                                : marker.kind === "bookmark"
                                  ? "#9c8cff"
                                  : undefined,
                          }}
                          onClick={() => seekToTimelineUs(marker.timestampUs)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="panel transcript-panel">
              <h2>Transcript and sentence boundaries</h2>
              <p className="muted">
                {effectiveTranscript
                  ? `${effectiveTranscript.sentences.length} sentences · ${effectiveTranscript.origin} · ${effectiveTranscript.modelVersion}`
                  : "No timestamped transcript is attached. Import worker output or add boundaries manually."}
                {selected.correctedTranscript
                  ? " Original transcript evidence is preserved separately."
                  : ""}
                {(selected.transcriptRevisions?.length ?? 0) > 0
                  ? ` ${selected.transcriptRevisions?.length} correction revisions retained.`
                  : ""}
              </p>
              <label>
                Import timestamped transcript JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => void loadTranscript(event.target.files?.[0])}
                />
              </label>
              <details className="profile-editor">
                <summary>
                  Edit timestamped words ({effectiveTranscript?.words.length ?? 0})
                </summary>
                {(effectiveTranscript?.words ?? []).length ? (
                  (effectiveTranscript?.words ?? []).map((word, wordIndex) => (
                    <div
                      className="cue-rating-row"
                      key={`${word.startUs}-${wordIndex}`}
                    >
                      {editingWordIndex === wordIndex ? (
                        <>
                          <label>
                            Word at {(word.startUs / 1_000_000).toFixed(2)}s
                            <input
                              value={wordDraft}
                              maxLength={500}
                              autoFocus
                              onChange={(event) => setWordDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void saveTranscriptWord();
                                }
                              }}
                            />
                          </label>
                          <div className="button-row">
                            <button
                              type="button"
                              disabled={!wordDraft.trim()}
                              onClick={() => void saveTranscriptWord()}
                            >
                              Save word
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                setEditingWordIndex(undefined);
                                setWordDraft("");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => seekToTimelineUs(word.startUs)}
                          >
                            {(word.startUs / 1_000_000).toFixed(2)}–
                            {(word.endUs / 1_000_000).toFixed(2)}s · {word.text}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => editTranscriptWord(word, wordIndex)}
                          >
                            Edit word
                          </button>
                        </>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Import timestamped worker output before editing individual words.
                  </p>
                )}
              </details>
              {(selected.transcriptRevisions?.length ?? 0) > 0 && (
                <details className="profile-editor">
                  <summary>
                    Correction history ({selected.transcriptRevisions?.length})
                  </summary>
                  {(selected.transcriptRevisions ?? []).map((revision, index) => (
                    <p
                      className="muted"
                      key={`${revision.updatedAt ?? "revision"}-${index}`}
                    >
                      Revision {index + 1} ·{" "}
                      {revision.updatedAt
                        ? new Date(revision.updatedAt).toLocaleString()
                        : "time unavailable"}{" "}
                      · {revision.words.length} words · {revision.sentences.length} sentences
                    </p>
                  ))}
                </details>
              )}
              {speechStructureAnalysis && (
                <details className="profile-editor">
                  <summary>
                    Speech review candidates ({speechStructureAnalysis.events.length})
                  </summary>
                  <p className="muted">
                    {speechStructureAnalysis.version}. These timestamp-based hints
                    require human review; they never rewrite the transcript.
                  </p>
                  {speechStructureAnalysis.events.map((event) => (
                    <div className="cue-rating-row" key={event.id}>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => seekToTimelineUs(event.startUs)}
                      >
                        {(event.startUs / 1_000_000).toFixed(2)}–
                        {(event.endUs / 1_000_000).toFixed(2)}s ·{" "}
                        {event.kind.replaceAll("_", " ")}
                      </button>
                      <span className="muted">
                        {Math.round(event.confidence * 100)}% ·{" "}
                        {event.evidence.join(" · ")}
                      </span>
                    </div>
                  ))}
                  {speechStructureAnalysis.events.length === 0 && (
                    <p className="muted">
                      No pause, retake, false-start, or interruption candidates
                      were detected.
                    </p>
                  )}
                </details>
              )}
              <div className="correction-form">
                <label>
                  Start (s)
                  <input
                    value={sentenceDraft.start}
                    onChange={(event) =>
                      setSentenceDraft({
                        ...sentenceDraft,
                        start: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  End (s)
                  <input
                    value={sentenceDraft.end}
                    onChange={(event) =>
                      setSentenceDraft({
                        ...sentenceDraft,
                        end: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Sentence
                  <input
                    value={sentenceDraft.text}
                    placeholder="Timestamped sentence text"
                    onChange={(event) =>
                      setSentenceDraft({
                        ...sentenceDraft,
                        text: event.target.value,
                      })
                    }
                  />
                </label>
                <button type="button" onClick={() => void saveSentenceBoundary()}>
                  {editingSentenceIndex === undefined ? "Add boundary" : "Save boundary"}
                </button>
                {editingSentenceIndex !== undefined && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setEditingSentenceIndex(undefined);
                      setSentenceDraft({ start: "0", end: "1", text: "" });
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
              {(effectiveTranscript?.sentences ?? []).map((sentence) => (
                <div className="cue-rating-row" key={sentence.index}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => seekToTimelineUs(sentence.startUs)}
                  >
                    {(sentence.startUs / 1_000_000).toFixed(2)}–
                    {(sentence.endUs / 1_000_000).toFixed(2)}s · {sentence.text}
                  </button>
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => editSentenceBoundary(sentence)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void removeSentenceBoundary(sentence.index)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {transcriptNotice && <p className="muted">{transcriptNotice}</p>}
              {transcriptError && (
                <p className="tracking-warning">{transcriptError}</p>
              )}
            </div>
            <div className="panel bookmark-panel">
              <h2>Bookmarks and annotations</h2>
              <div className="correction-form">
                <label>
                  Note at {playbackTime.toFixed(1)}s
                  <input
                    value={bookmarkNote}
                    maxLength={1000}
                    placeholder="What should you revisit here?"
                    onChange={(event) => setBookmarkNote(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={!bookmarkNote.trim()}
                  onClick={() => void addBookmark()}
                >
                  Add bookmark
                </button>
              </div>
              {(selected.bookmarks ?? []).map((bookmark) => (
                <div className="cue-rating-row" key={bookmark.id}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => seekToTimelineUs(bookmark.timestampUs)}
                  >
                    {(bookmark.timestampUs / 1_000_000).toFixed(1)}s · {bookmark.note}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void removeBookmark(bookmark.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
              {(selected.bookmarks?.length ?? 0) === 0 && (
                <p className="muted">No bookmarks yet.</p>
              )}
              {bookmarkError && (
                <p className="tracking-warning">{bookmarkError}</p>
              )}
            </div>
            <div className="panel review-clip-panel">
              <h2>Review clip selections</h2>
              <p className="muted">
                These in/out points are review annotations only. They are not
                automatically promoted into the dataset.
              </p>
              <div className="correction-form">
                <label>
                  In (s)
                  <input
                    value={clipDraft.start}
                    onChange={(event) =>
                      setClipDraft({ ...clipDraft, start: event.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setClipDraft({
                      ...clipDraft,
                      start: playbackTime.toFixed(2),
                    })
                  }
                >
                  Set in
                </button>
                <label>
                  Out (s)
                  <input
                    value={clipDraft.end}
                    onChange={(event) =>
                      setClipDraft({ ...clipDraft, end: event.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setClipDraft({
                      ...clipDraft,
                      end: playbackTime.toFixed(2),
                    })
                  }
                >
                  Set out
                </button>
                <label>
                  Note
                  <input
                    value={clipDraft.note}
                    maxLength={1000}
                    placeholder="Why keep this range?"
                    onChange={(event) =>
                      setClipDraft({ ...clipDraft, note: event.target.value })
                    }
                  />
                </label>
                <button type="button" onClick={() => void addReviewClip()}>
                  Save clip
                </button>
              </div>
              {(selected.reviewClips ?? []).map((clip) => (
                <div className="cue-rating-row" key={clip.id}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => seekToTimelineUs(clip.startUs)}
                  >
                    {(clip.startUs / 1_000_000).toFixed(2)}–
                    {(clip.endUs / 1_000_000).toFixed(2)}s
                    {clip.note ? ` · ${clip.note}` : ""}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void removeReviewClip(clip.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
              {(selected.reviewClips?.length ?? 0) === 0 && (
                <p className="muted">No review clips selected.</p>
              )}
              {clipError && <p className="tracking-warning">{clipError}</p>}
            </div>
            {(selected.cues?.length ?? 0) > 0 && (
              <div className="panel cue-rating-panel">
                <h2>Cue ratings</h2>
                {selected.cues!.map((cue) => (
                  <div key={cue.id} className="cue-rating-row">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => seekToTimelineUs(Math.max(0, cue.timestampUs - reviewOriginUs))}
                    >
                      {cue.kind} · evidence: {cue.evidence.join(", ")}
                      {cue.rating ? ` · ${cue.rating}` : ""}
                    </button>
                    <div className="button-row">
                      {(["helpful", "unnecessary", "wrong"] as const).map((rating) => (
                        <button
                          key={rating}
                          type="button"
                          className="secondary"
                          onClick={() => {
                            const updated = rateSessionCue(selected, cue.id, rating);
                            void store.sessions.put(updated).then(() => onUpdated(updated));
                          }}
                        >
                          {rating}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              className={`timeline ${blind ? "blind" : ""}`}
              aria-label="Prediction timeline; click to seek playback"
              onKeyDown={handleTimelineKeyDown}
              onClick={(event) => {
                if (!playbackRef.current?.duration) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                playbackRef.current.currentTime =
                  ((event.clientX - bounds.left) / bounds.width) * playbackRef.current.duration;
              }}
            >
              {timelineSegments.map((segment, index) => (
                <span
                  key={`${segment.startUs}-${index}`}
                  className={segment.state}
                  style={{
                    left: `${segment.startRatio * 100}%`,
                    width: `${segment.widthRatio * 100}%`,
                  }}
                  title={blind ? undefined : stateLabel[segment.state]}
                />
              ))}
              <i
                className="playhead"
                style={{ left: `${Math.min(100, (playbackTime / Math.max(0.001, playbackDuration)) * 100)}%` }}
              />
            </button>
            <div className="correction-form">
              <label>Start (s)<input value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} /></label>
              <label>End (s)<input value={range.end} onChange={(event) => setRange({ ...range, end: event.target.value })} /></label>
              <label>Observed
                <select value={range.label} onChange={(event) => setRange({ ...range, label: event.target.value as Correction["label"] })}>
                  <option value="contact">Contact</option><option value="not_contact">Not contact</option><option value="unknown">Unknown</option>
                </select>
              </label>
              <label>Annotation<input value={range.note} placeholder="Optional false-cue note" onChange={(event) => setRange({ ...range, note: event.target.value })} /></label>
              <button onClick={() => void addCorrection()}>Add correction</button>
            </div>
            {correctionError && <p className="tracking-warning">{correctionError}</p>}
            <p className="muted">{selected.corrections.length} preserved correction intervals. Original predictions remain unchanged.</p>
            {blind ? (
              <p className="muted">Prediction metrics and comparison tools stay hidden until blind labeling is turned off.</p>
            ) : (
              <>
                <div className="metrics-grid">
                  <div><strong>{Math.round((metrics?.agreement ?? 0) * 100)}%</strong><span>Agreement</span></div>
                  <div><strong>{Math.round((metrics?.decisionCoverage ?? 0) * 100)}%</strong><span>Decision coverage</span></div>
                  <div><strong>{metrics?.falseCueRatePerMinute.toFixed(2) ?? "0.00"}</strong><span>False cues/min</span></div>
                  <div><strong>{metrics?.unknown ?? 0}</strong><span>Unknown frames</span></div>
                  <div><strong>{eventTiming?.medianBreakOnsetMs?.toFixed(0) ?? "—"} ms</strong><span>Median break detection</span></div>
                  <div><strong>{eventTiming?.medianRecoveryMs?.toFixed(0) ?? "—"} ms</strong><span>Median recovery detection</span></div>
                  <div><strong>{eventTiming?.missedBreaks ?? 0}</strong><span>Missed labeled breaks</span></div>
                  <div><strong>{eventTiming?.missedRecoveries ?? 0}</strong><span>Missed labeled recoveries</span></div>
                  <button className="secondary" onClick={exportLabels}>Export labels + metrics</button>
                </div>
                <button className="text-button" onClick={exportAnalysis}>Export complete analysis for reprocessing</button>
                <button className="text-button" onClick={exportSessionReport}>Export session report (JSON + Markdown)</button>
                <div className="comparison-panel">
                  <label>Compare reprocessed output
                    <input type="file" accept="application/json,.json" onChange={(event) => void loadComparison(event.target.files?.[0])} />
                  </label>
                  {comparisonError && <p className="tracking-warning">{comparisonError}</p>}
                  {comparison && (
                    <p>
                      <strong>{comparison.trackerId ?? selected.manifest.trackerId} · {comparison.algorithmVersion}</strong>:{" "}
                      {Math.round((comparisonMetrics?.agreement ?? 0) * 100)}% agreement,{" "}
                      {Math.round((comparisonMetrics?.decisionCoverage ?? 0) * 100)}% decision coverage,{" "}
                      {comparisonMetrics?.falseCueRatePerMinute.toFixed(2) ?? "0.00"} false cues/min,{" "}
                      {comparisonEventTiming?.medianBreakOnsetMs?.toFixed(0) ?? "—"} ms median break detection.
                      Current <strong>{selected.manifest.algorithmVersion}</strong>:{" "}
                      {Math.round((metrics?.agreement ?? 0) * 100)}% agreement,{" "}
                      {Math.round((metrics?.decisionCoverage ?? 0) * 100)}% coverage,{" "}
                      {metrics?.falseCueRatePerMinute.toFixed(2) ?? "0.00"} false cues/min,{" "}
                      {eventTiming?.medianBreakOnsetMs?.toFixed(0) ?? "—"} ms median break detection.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("setup");
  const [inventory, setInventory] = useState<DeviceInventory>();
  const [profiles, setProfiles] = useState<CaptureProfile[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [calibrations, setCalibrations] = useState<Calibration[]>([]);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [cameraStream, setCameraStream] = useState<MediaStream>();
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream>();
  const cameraStreamRef = useRef<MediaStream | undefined>(undefined);
  const microphoneStreamRef = useRef<MediaStream | undefined>(undefined);
  const cameraTimingRef = useRef<{
    profileId?: string;
    startedAt: number;
    requestLatencyMs?: number;
  } | undefined>(undefined);
  const profileMutationRef = useRef<Promise<void>>(Promise.resolve());
  const [error, setError] = useState<string>();
  const [debug, setDebug] = useState(false);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>({
    ...DEFAULT_FEATURE_FLAGS,
  });
  const [liveAssistHudVisible, setLiveAssistHudVisible] = useState(true);
  const [liveAssistEnabled, setLiveAssistEnabled] = useState(false);
  const [liveAssistSnapshot, setLiveAssistSnapshot] = useState<{
    state?: GazeState;
    recording: boolean;
    liveAssist: boolean;
  }>({ recording: false, liveAssist: false });
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [datasetClips, setDatasetClips] = useState<ClipCandidate[]>([]);
  const [datasetAssets] = useState<RecordingAsset[]>([]);
  const [pendingDrillId, setPendingDrillId] = useState<string>();
  const [pendingFollowedRecommendationId, setPendingFollowedRecommendationId] =
    useState<string>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeProfile = profiles.find((profile) => profile.id === activeId);
  const currentPromptDisplay = useCurrentDisplayPlacement();
  const activePromptPlacementIssue = getPromptPlacementIssue(
    activeProfile,
    currentPromptDisplay,
  );
  const activeCalibration = selectActiveCalibration(
    calibrations,
    activeProfile,
    MEDIAPIPE_TRACKER_ID,
    MEDIAPIPE_TRACKER_VERSION,
    ALGORITHM_VERSION,
  );
  const latestProfileCalibration = calibrations
    .filter((calibration) => calibration.profileId === activeProfile?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const calibrationIssue =
    activeProfile && latestProfileCalibration && !activeCalibration
      ? calibrationInvalidationReason(
          latestProfileCalibration,
          activeProfile,
          MEDIAPIPE_TRACKER_ID,
          MEDIAPIPE_TRACKER_VERSION,
          ALGORITHM_VERSION,
        )
      : undefined;

  const mutateStoredProfile = useCallback((
    id: string,
    mutate: (profile: CaptureProfile) => CaptureProfile,
  ): Promise<CaptureProfile | undefined> => {
    const mutation = profileMutationRef.current.then(async () => {
      const latest = (await store.profiles.all()).find((profile) => profile.id === id);
      if (!latest) return undefined;
      const updated = mutate(latest);
      await store.profiles.put(updated);
      setProfiles((values) =>
        values.map((profile) => profile.id === updated.id ? updated : profile),
      );
      return updated;
    });
    profileMutationRef.current = mutation.then(() => undefined, () => undefined);
    return mutation;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await enumerateDevices();
      setInventory(next);
      const stored = await store.profiles.all();
      const saved = reconcileProfileLabels(stored, next);
      for (let index = 0; index < stored.length; index += 1) {
        if (saved[index] !== stored[index]) await store.profiles.put(saved[index]);
      }
      const suggestions = suggestProfiles(next).filter(
        (suggestion) => !saved.some((profile) => profile.kind === suggestion.kind),
      );
      for (const suggestion of suggestions) await store.profiles.put(suggestion);
      const all = [...saved, ...suggestions];
      setProfiles(all);
      setActiveId((id) => id ?? all[0]?.id);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      refresh(),
      store.sessions.all(),
      store.consents.all(),
      store.clips.all(),
    ]).then(async ([, storedSessions, storedConsents, storedClips]) => {
      setConsents(storedConsents);
      setDatasetClips(storedClips);
      const recovered = await Promise.all(storedSessions.map(async (session) => {
        const recovered = recoverInterruptedSession(session);
        if (recovered.changed) {
          try {
            await store.sessions.put(recovered.session);
          } catch (cause) {
            return {
              ...recovered.session,
              manifest: {
                ...recovered.session.manifest,
                status: "invalid" as const,
                recoveryNote:
                  `Interrupted evidence was read but its recovered status could not be persisted: ${
                    cause instanceof Error ? cause.message : String(cause)
                  }`,
              },
            };
          }
        }
        return recovered.session;
      }));
      setSessions(recovered);
    }).catch((cause) => {
      setError(
        `Saved sessions could not be restored: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    });
  }, [refresh]);

  useEffect(() => {
    void Promise.all([
      store.settings.get<boolean>("debugDiagnostics"),
      store.settings.get<unknown>("featureFlags"),
    ]).then(([savedDebug, savedFlags]) => {
      setDebug(savedDebug ?? false);
      setFeatureFlags(parseFeatureFlags(savedFlags));
    }).catch((cause) => {
      setError(
        `Saved settings could not be restored: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    });
  }, []);

  useEffect(() => {
    return () => {
      stopMediaStream(cameraStreamRef.current);
      stopMediaStream(microphoneStreamRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    void store.calibrations.forProfile(activeId).then(setCalibrations).catch((cause) => {
      setCalibrations([]);
      setError(
        `Saved calibrations could not be restored: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    });
  }, [activeId]);

  useEffect(() => {
    const handleDeviceChange = () => void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
  }, [refresh]);

  useEffect(() => {
    const track = cameraStream?.getVideoTracks()[0];
    if (!track) return;
    const handleEnded = () => {
      if (cameraStreamRef.current !== cameraStream) return;
      cameraStreamRef.current = undefined;
      setCameraStream(undefined);
      setError("The active camera was disconnected. Reconnect it, refresh devices, and enable the camera again.");
    };
    track.addEventListener("ended", handleEnded);
    return () => track.removeEventListener("ended", handleEnded);
  }, [cameraStream]);

  useEffect(() => {
    const track = microphoneStream?.getAudioTracks()[0];
    if (!track) return;
    const handleEnded = () => {
      if (microphoneStreamRef.current !== microphoneStream) return;
      microphoneStreamRef.current = undefined;
      setMicrophoneStream(undefined);
      setError("The active microphone was disconnected. Reconnect it, refresh devices, and enable the microphone again.");
    };
    track.addEventListener("ended", handleEnded);
    return () => track.removeEventListener("ended", handleEnded);
  }, [microphoneStream]);

  const clearActiveStreams = useCallback(() => {
    stopMediaStream(cameraStreamRef.current);
    stopMediaStream(microphoneStreamRef.current);
    cameraStreamRef.current = undefined;
    microphoneStreamRef.current = undefined;
    cameraTimingRef.current = undefined;
    setCameraStream(undefined);
    setMicrophoneStream(undefined);
  }, []);

  const selectProfile = (id: string) => {
    if (id === activeId) return;
    clearActiveStreams();
    setActiveId(id);
    setError(undefined);
  };

  const enableCamera = async () => {
    try {
      cameraTimingRef.current = {
        profileId: activeProfile?.id,
        startedAt: performance.now(),
      };
      const stream = await requestCamera(
        activeProfile?.cameraDeviceId,
        activeProfile?.requestedVideo,
      );
      if (cameraTimingRef.current) {
        cameraTimingRef.current.requestLatencyMs =
          performance.now() - cameraTimingRef.current.startedAt;
      }
      stopMediaStream(cameraStreamRef.current);
      cameraStreamRef.current = stream;
      setCameraStream(stream);
      if (activeProfile) {
        await mutateStoredProfile(activeProfile.id, (profile) =>
          negotiatedProfile(
            profile,
            stream.getVideoTracks()[0],
            microphoneStream?.getAudioTracks()[0],
          ),
        );
      }
      await refresh();
    } catch (cause) {
      cameraTimingRef.current = undefined;
      setError(describeMediaError("camera", cause));
    }
  };

  const recordFirstFrame = async () => {
    const timing = cameraTimingRef.current;
    if (!timing || !activeProfile || timing.profileId !== activeProfile.id) return;
    cameraTimingRef.current = undefined;
    try {
      await mutateStoredProfile(activeProfile.id, (profile) => ({
        ...profile,
        captureDiagnostics: {
          cameraRequestLatencyMs: timing.requestLatencyMs ?? performance.now() - timing.startedAt,
          timeToFirstFrameMs: performance.now() - timing.startedAt,
          measuredAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      }));
    } catch (cause) {
      setError(
        `First-frame diagnostics could not be saved: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  const enableMicrophone = async () => {
    if (activeProfile && !activeProfile.microphoneDeviceId) {
      setError("This profile is configured for video only. Select a microphone in the profile editor before enabling audio.");
      return;
    }
    try {
      const stream = await requestMicrophone(activeProfile?.microphoneDeviceId);
      stopMediaStream(microphoneStreamRef.current);
      microphoneStreamRef.current = stream;
      setMicrophoneStream(stream);
      if (activeProfile) {
        const audio = stream.getAudioTracks()[0]?.getSettings();
        await mutateStoredProfile(activeProfile.id, (profile) => ({
          ...profile,
          negotiatedAudio: {
            sampleRate: audio?.sampleRate ?? 48_000,
            channelCount: audio?.channelCount ?? 1,
          },
          updatedAt: new Date().toISOString(),
        }));
      }
      await refresh();
    } catch (cause) {
      setError(describeMediaError("microphone", cause));
    }
  };

  const upsertSession = (session: StoredSession) =>
    setSessions((values) => [session, ...values.filter((value) => value.manifest.id !== session.manifest.id)]);

  const createProfile = async (
    name: string,
    cameraId: string,
    microphoneId: string,
    requestedVideo: CaptureProfile["requestedVideo"],
  ) => {
    const camera = inventory?.cameras.find((device) => device.deviceId === cameraId);
    const microphone = microphoneId
      ? inventory?.microphones.find((device) => device.deviceId === microphoneId)
      : undefined;
    if (!camera || (microphoneId && !microphone)) return;
    const profile: CaptureProfile = {
      id: crypto.randomUUID(),
      name,
      kind: "custom",
      cameraDeviceId: cameraId,
      cameraLabel: camera.label,
      microphoneDeviceId: microphone?.deviceId ?? "",
      microphoneLabel: microphone?.label ?? "No microphone",
      requestedVideo,
      lensAnchor: { x: 0.5, y: 0.015 },
      updatedAt: new Date().toISOString(),
    };
    try {
      await store.profiles.put(profile);
      clearActiveStreams();
      setProfiles((values) => [...values, profile]);
      setActiveId(profile.id);
    } catch (cause) {
      setError(
        `Profile could not be saved: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  const updateProfile = async (
    id: string,
    name: string,
    cameraId: string,
    microphoneId: string,
    requestedVideo: CaptureProfile["requestedVideo"],
  ) => {
    const existing = profiles.find((profile) => profile.id === id);
    const camera = inventory?.cameras.find((device) => device.deviceId === cameraId);
    const microphone = microphoneId
      ? inventory?.microphones.find((device) => device.deviceId === microphoneId)
      : undefined;
    if (!existing || !camera || (microphoneId && !microphone)) return;
    const updated: CaptureProfile = {
      ...existing,
      name,
      cameraDeviceId: cameraId,
      cameraLabel: camera.label,
      microphoneDeviceId: microphone?.deviceId ?? "",
      microphoneLabel: microphone?.label ?? "No microphone",
      requestedVideo,
      negotiatedVideo: undefined,
      negotiatedAudio: undefined,
      updatedAt: new Date().toISOString(),
    };
    try {
      await store.profiles.put(updated);
      clearActiveStreams();
      setProfiles((values) => values.map((profile) => profile.id === id ? updated : profile));
    } catch (cause) {
      setError(
        `Profile changes could not be saved: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  const updateLensAnchor = async (anchor: { x: number; y: number }) => {
    if (!activeProfile) return;
    try {
      const promptDisplay = await readCurrentDisplayPlacement();
      await mutateStoredProfile(activeProfile.id, (profile) => ({
        ...profile,
        lensAnchor: anchor,
        promptDisplay: promptDisplay ?? profile.promptDisplay,
        updatedAt: new Date().toISOString(),
      }));
    } catch (cause) {
      setError(
        `Lens anchor could not be saved: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  };

  return (
    <main>
      <header className="app-header">
        <a className="brand" href="#" onClick={() => setPage("setup")}><span>●</span> Presence</a>
        <nav aria-label="Primary">
          {(
            [
              "setup",
              "calibrate",
              "measure",
              "review",
              "progress",
              "consent",
              "curate",
              "dataset",
            ] as Page[]
          ).map((item) => (
            <button className={page === item ? "active" : ""} key={item} onClick={() => setPage(item)}>
              {item === "measure" ? "Train" : item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="privacy"><i /> Local only</div>
      </header>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError(undefined)}>Dismiss</button></div>}
      {page === "setup" && (
        <Setup
          inventory={inventory}
          profiles={profiles}
          activeProfile={activeProfile}
          stream={cameraStream}
          audioStream={microphoneStream}
          videoRef={videoRef}
          onRequestCamera={() => void enableCamera()}
          onRequestMicrophone={() => void enableMicrophone()}
          onSelectProfile={selectProfile}
          onRefresh={() => void refresh()}
          onCreateProfile={(name, cameraId, microphoneId, requestedVideo) =>
            void createProfile(name, cameraId, microphoneId, requestedVideo)}
          onUpdateProfile={(id, name, cameraId, microphoneId, requestedVideo) =>
            void updateProfile(id, name, cameraId, microphoneId, requestedVideo)}
          onLensAnchorChange={(anchor) => void updateLensAnchor(anchor)}
          onFirstFrame={() => void recordFirstFrame()}
          featureFlags={featureFlags}
          onFeatureFlagsChange={(flags) => {
            setFeatureFlags(flags);
            void store.settings.put("featureFlags", flags).catch((cause) => {
              setError(
                `Experimental settings could not be saved: ${
                  cause instanceof Error ? cause.message : String(cause)
                }`,
              );
            });
          }}
        />
      )}
      {page === "calibrate" && (
        <CalibrationWizard
          profile={activeProfile}
          stream={cameraStream}
          videoRef={videoRef}
          existingCalibration={activeCalibration}
          invalidationReason={calibrationIssue}
          onSaved={(value) => setCalibrations((values) => [value, ...values])}
        />
      )}
      {page === "measure" && (
        <Measure
          profile={activeProfile}
          calibration={activeCalibration}
          cameraStream={cameraStream}
          microphoneStream={microphoneStream}
          videoRef={videoRef}
          onSession={upsertSession}
          debug={debug}
          calibrationIssue={calibrationIssue}
          promptPlacementIssue={activePromptPlacementIssue}
          onLiveAssistSnapshot={setLiveAssistSnapshot}
          consents={consents}
          initialDrillId={pendingDrillId}
          followedRecommendationId={pendingFollowedRecommendationId}
          onClipsProposed={(proposals) => {
            void store.clips.all().then((existing) => {
              const merged = [
                ...proposals,
                ...existing.filter(
                  (clip) =>
                    !proposals.some((proposal) => proposal.id === clip.id),
                ),
              ];
              void store.clips.putAll(merged).then(() => setDatasetClips(merged));
            });
          }}
        />
      )}
      {page === "review" && (
        <Review
          sessions={sessions}
          onUpdated={upsertSession}
          featureFlags={featureFlags}
        />
      )}
      {page === "progress" && (
        <ProgressPanel
          sessions={sessions}
          onFollowDrill={(drillId, recommendationId) => {
            setPendingDrillId(drillId);
            setPendingFollowedRecommendationId(recommendationId);
            setPage("measure");
          }}
        />
      )}
      {page === "consent" && (
        <ConsentPanel consents={consents} onChange={setConsents} />
      )}
      {page === "curate" && (
        <CuratePanel
          sessions={sessions}
          clips={datasetClips}
          onClipsChange={setDatasetClips}
        />
      )}
      {page === "dataset" && (
        <DatasetPanel
          sessions={sessions}
          consents={consents}
          clips={datasetClips}
          assets={datasetAssets}
        />
      )}
      {(liveAssistEnabled || liveAssistSnapshot.liveAssist) && (
        <LiveAssistHud
          visible={liveAssistHudVisible}
          onToggleVisible={() => setLiveAssistHudVisible((value) => !value)}
          recording={liveAssistSnapshot.recording}
          state={liveAssistSnapshot.state ?? "unknown"}
        />
      )}
      <button
        className={`debug-toggle ${debug ? "enabled" : ""}`}
        aria-pressed={debug}
        onClick={() => {
          const next = !debug;
          setDebug(next);
          void store.settings.put("debugDiagnostics", next).catch((cause) => {
            setError(
              `Diagnostic setting could not be saved: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            );
          });
        }}
      >
        Diagnostics {debug ? "on" : "off"}
      </button>
      <button
        type="button"
        className={`debug-toggle ${liveAssistEnabled ? "enabled" : ""}`}
        aria-pressed={liveAssistEnabled}
        data-live-assist-toggle="true"
        onClick={() => {
          setLiveAssistEnabled((value) => !value);
          setLiveAssistHudVisible(true);
        }}
      >
        Live assist {liveAssistEnabled ? "on" : "off"}
      </button>
    </main>
  );
}
