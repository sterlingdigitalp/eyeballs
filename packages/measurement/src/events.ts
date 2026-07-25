import type { GazeEvent, GazePrediction } from "../../contracts/src";

export class GazeEventBuilder {
  private openBreak: GazeEvent | undefined;
  private openUnknown: GazeEvent | undefined;

  update(prediction: GazePrediction): GazeEvent[] {
    const completed: GazeEvent[] = [];
    if (prediction.state === "off_lens" && !this.openBreak) {
      this.openBreak = {
        id: crypto.randomUUID(),
        type: "break",
        startUs: prediction.timestampUs,
        confidence: prediction.confidence,
      };
    }
    if (prediction.state !== "off_lens" && this.openBreak) {
      const endUs = prediction.timestampUs;
      completed.push({ ...this.openBreak, endUs });
      if (prediction.state === "contact" || prediction.state === "near_lens") {
        completed.push({
          id: crypto.randomUUID(),
          type: "recovery",
          startUs: endUs,
          endUs,
          confidence: prediction.confidence,
        });
      }
      this.openBreak = undefined;
    }
    if (prediction.state === "unknown" && !this.openUnknown) {
      this.openUnknown = {
        id: crypto.randomUUID(),
        type: "unknown",
        startUs: prediction.timestampUs,
        confidence: prediction.confidence,
      };
    } else if (prediction.state !== "unknown" && this.openUnknown) {
      completed.push({ ...this.openUnknown, endUs: prediction.timestampUs });
      this.openUnknown = undefined;
    }
    return completed;
  }

  finish(timestampUs: number): GazeEvent[] {
    const events: GazeEvent[] = [];
    if (this.openBreak) events.push({ ...this.openBreak, endUs: timestampUs });
    if (this.openUnknown) events.push({ ...this.openUnknown, endUs: timestampUs });
    this.openBreak = undefined;
    this.openUnknown = undefined;
    return events;
  }
}
