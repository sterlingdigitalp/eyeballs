import { execFileSync } from "node:child_process";
import { featureVectorSchema } from "../../packages/contracts/src";

const executable =
  "native/capture-macos/.build/debug/vision-benchmark";
const fixture = "fixtures/synthetic/synthetic-av.mp4";
const lines = execFileSync(executable, ["--input", fixture], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
})
  .split(/\r?\n/)
  .filter(Boolean);
const records = lines.map((line) => {
  const raw = JSON.parse(line) as Record<string, unknown>;
  featureVectorSchema.parse(raw);
  return raw;
});

if (records.length !== 240) {
  throw new Error(`Vision fixture expected 240 frames; received ${records.length}.`);
}
if (
  records[0].timestampUs !== 0 ||
  records.at(-1)?.timestampUs !== 7_966_666
) {
  throw new Error("Vision fixture timestamps did not preserve the 30 fps media clock.");
}
if (records.some((record) => record.faceDetected !== false)) {
  throw new Error("Vision invented a face detection in the geometric fixture.");
}
if (records.some((record) => record.providerId !== "apple-vision")) {
  throw new Error("Vision fixture output is missing its provider identity.");
}

console.info(
  "Validated Apple Vision decoding and timestamps across 240 synthetic frames.",
);
