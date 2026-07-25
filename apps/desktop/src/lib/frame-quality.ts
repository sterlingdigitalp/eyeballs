export interface BrightnessAssessment {
  averageLuma: number;
  status: "too_dark" | "good" | "too_bright";
}

export function assessBrightness(pixels: Uint8ClampedArray): BrightnessAssessment {
  if (pixels.length < 4) return { averageLuma: 0, status: "too_dark" };
  let total = 0;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    total += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
    count += 1;
  }
  const averageLuma = total / count;
  return {
    averageLuma,
    status: averageLuma < 45 ? "too_dark" : averageLuma > 215 ? "too_bright" : "good",
  };
}

export function sampleVideoBrightness(video: HTMLVideoElement): BrightnessAssessment | undefined {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 36;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return assessBrightness(context.getImageData(0, 0, canvas.width, canvas.height).data);
}
