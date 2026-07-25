import type {
  FeatureVector,
  GazeEvent,
  GazePrediction,
} from "../../contracts/src";
import {
  classifyFrame,
  type ClassifierModel,
  TemporalClassifier,
  type TemporalPolicy,
} from "./classifier";
import { GazeEventBuilder } from "./events";

export interface PipelineFrame {
  prediction: GazePrediction;
  completedEvents: GazeEvent[];
}

export class MeasurementPipeline {
  private readonly temporal: TemporalClassifier;
  private events = new GazeEventBuilder();

  constructor(
    private readonly model: ClassifierModel,
    policy?: TemporalPolicy,
  ) {
    this.temporal = new TemporalClassifier(policy);
  }

  process(feature: FeatureVector): PipelineFrame {
    const prediction = this.temporal.update(classifyFrame(this.model, feature));
    return {
      prediction,
      completedEvents: this.events.update(prediction),
    };
  }

  finish(timestampUs: number): GazeEvent[] {
    return this.events.finish(timestampUs);
  }

  reset(): void {
    this.temporal.reset();
    this.events = new GazeEventBuilder();
  }
}
