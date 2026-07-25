import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { FeatureVector } from "../../../../packages/contracts/src";
import type { AnalysisFrame, TrackingProvider } from "./provider";
import { unknownFeature } from "./provider";
import { geometricTrackingConfidence, isBilateralBlink } from "./quality";
import { headPoseFromFacialTransformation } from "./head-pose";

const MODEL_PATH = "/models/face_landmarker.task";
const WASM_PATH = "/mediapipe/wasm";
export const MEDIAPIPE_TRACKER_ID = "mediapipe-face-landmarker";
export const MEDIAPIPE_TRACKER_VERSION = "0.10.22/face-landmarker-float16-v1+pose-matrix.2";

const average = (landmarks: NormalizedLandmark[], indices: number[]) => ({
  x: indices.reduce((sum, index) => sum + landmarks[index].x, 0) / indices.length,
  y: indices.reduce((sum, index) => sum + landmarks[index].y, 0) / indices.length,
});

const normalizedPosition = (
  value: number,
  start: number,
  end: number,
): number => ((value - start) / Math.max(0.0001, end - start) - 0.5) * 2;

export class MediaPipeTrackingProvider implements TrackingProvider {
  readonly id = MEDIAPIPE_TRACKER_ID;
  readonly version = MEDIAPIPE_TRACKER_VERSION;
  private landmarker?: FaceLandmarker;

  async initialize(): Promise<void> {
    const files = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.landmarker = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
  }

  async analyze(frame: AnalysisFrame): Promise<FeatureVector> {
    if (!this.landmarker) throw new Error("Tracker is not initialized.");
    const started = performance.now();
    const result = this.landmarker.detectForVideo(frame.video, frame.timestampMs);
    const landmarks = result.faceLandmarks[0];
    if (!landmarks || landmarks.length < 478) return unknownFeature(frame.timestampMs);

    const leftIris = average(landmarks, [468, 469, 470, 471, 472]);
    const rightIris = average(landmarks, [473, 474, 475, 476, 477]);
    const leftYaw = normalizedPosition(leftIris.x, landmarks[33].x, landmarks[133].x);
    const rightYaw = normalizedPosition(rightIris.x, landmarks[362].x, landmarks[263].x);
    const leftPitch = normalizedPosition(leftIris.y, landmarks[159].y, landmarks[145].y);
    const rightPitch = normalizedPosition(rightIris.y, landmarks[386].y, landmarks[374].y);
    const faceWidth = Math.abs(landmarks[454].x - landmarks[234].x);
    const faceHeight = Math.abs(landmarks[152].y - landmarks[10].y);
    const nose = landmarks[1];
    const faceCenterX = (landmarks[234].x + landmarks[454].x) / 2;
    const faceCenterY = (landmarks[10].y + landmarks[152].y) / 2;
    const leftEyeOpen = Math.abs(landmarks[159].y - landmarks[145].y) / Math.max(faceHeight, 0.001);
    const rightEyeOpen = Math.abs(landmarks[386].y - landmarks[374].y) / Math.max(faceHeight, 0.001);
    const blendshapes = result.faceBlendshapes[0]?.categories ?? [];
    const headPose = headPoseFromFacialTransformation(
      result.facialTransformationMatrixes[0],
    );
    const leftBlinkScore =
      blendshapes.find((shape) => shape.categoryName === "eyeBlinkLeft")?.score ?? 0;
    const rightBlinkScore =
      blendshapes.find((shape) => shape.categoryName === "eyeBlinkRight")?.score ?? 0;

    return {
      schemaVersion: "1.0.0",
      timestampUs: Math.round(frame.timestampMs * 1000),
      confidence: geometricTrackingConfidence({
        faceScale: Math.sqrt(faceWidth * faceHeight),
        leftYaw,
        rightYaw,
        leftPitch,
        rightPitch,
      }),
      faceDetected: true,
      blink: isBilateralBlink({
        leftBlendshape: leftBlinkScore,
        rightBlendshape: rightBlinkScore,
        leftEyeOpen,
        rightEyeOpen,
      }),
      eyeYaw: (leftYaw + rightYaw) / 2,
      eyePitch: (leftPitch + rightPitch) / 2,
      headYaw: headPose?.yaw ?? (nose.x - faceCenterX) / Math.max(faceWidth, 0.001),
      headPitch: headPose?.pitch ?? (nose.y - faceCenterY) / Math.max(faceHeight, 0.001),
      headRoll: headPose?.roll ??
        Math.atan2(landmarks[263].y - landmarks[33].y, landmarks[263].x - landmarks[33].x),
      faceScale: Math.sqrt(faceWidth * faceHeight),
      analysisLatencyMs: performance.now() - started,
    };
  }

  async shutdown(): Promise<void> {
    this.landmarker?.close();
    this.landmarker = undefined;
  }
}
