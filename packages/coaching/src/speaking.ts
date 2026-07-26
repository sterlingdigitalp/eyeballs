/**
 * Lightweight speaking detection for coaching.
 * Live coaching must never wait on full transcription.
 */

export interface VadSample {
  /** RMS in linear amplitude 0–1, or approximate level. */
  rms: number;
  timestampUs: number;
}

export interface SpeakingWindow {
  startUs: number;
  endUs: number;
}

export interface VadConfig {
  /** RMS threshold to treat as speech. */
  speechRmsThreshold: number;
  /** Require this many consecutive speech frames to start speaking. */
  hangoverSpeechFrames: number;
  /** Require this many consecutive silence frames to end speaking. */
  hangoverSilenceFrames: number;
  /** Minimum speaking window length (us) retained for metrics. */
  minSpeakingUs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  speechRmsThreshold: 0.02,
  hangoverSpeechFrames: 3,
  hangoverSilenceFrames: 8,
  minSpeakingUs: 200_000,
};

/**
 * Streaming VAD: updates speaking state from successive audio level samples.
 */
export class StreamingVad {
  private speaking = false;
  private speechRun = 0;
  private silenceRun = 0;
  private windowStartUs: number | undefined;
  private readonly completed: SpeakingWindow[] = [];

  constructor(private readonly config: VadConfig = DEFAULT_VAD_CONFIG) {}

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get windows(): readonly SpeakingWindow[] {
    return this.completed;
  }

  push(sample: VadSample): boolean {
    const isSpeech = sample.rms >= this.config.speechRmsThreshold;
    if (isSpeech) {
      this.speechRun += 1;
      this.silenceRun = 0;
      if (!this.speaking && this.speechRun >= this.config.hangoverSpeechFrames) {
        this.speaking = true;
        this.windowStartUs = sample.timestampUs;
      }
    } else {
      this.silenceRun += 1;
      this.speechRun = 0;
      if (this.speaking && this.silenceRun >= this.config.hangoverSilenceFrames) {
        this.closeWindow(sample.timestampUs);
      }
    }
    return this.speaking;
  }

  finish(timestampUs: number): SpeakingWindow[] {
    if (this.speaking) this.closeWindow(timestampUs);
    return [...this.completed];
  }

  private closeWindow(endUs: number): void {
    if (this.windowStartUs === undefined) {
      this.speaking = false;
      return;
    }
    const startUs = this.windowStartUs;
    const duration = endUs - startUs;
    if (duration >= this.config.minSpeakingUs) {
      this.completed.push({ startUs, endUs });
    }
    this.windowStartUs = undefined;
    this.speaking = false;
    this.silenceRun = 0;
    this.speechRun = 0;
  }
}

/** Total speaking duration in seconds from windows. */
export function speakingSeconds(windows: readonly SpeakingWindow[]): number {
  return windows.reduce((sum, window) => sum + (window.endUs - window.startUs) / 1_000_000, 0);
}

export interface TranscriptWord {
  text: string;
  startUs: number;
  endUs: number;
}

export interface SentenceBoundary {
  index: number;
  startUs: number;
  endUs: number;
  text: string;
}

/**
 * Post-session (or stub) sentence boundary inference from timestamped words.
 * Does not run on the live coaching loop.
 */
export function sentenceBoundariesFromWords(words: TranscriptWord[]): SentenceBoundary[] {
  if (!words.length) return [];
  const sentences: SentenceBoundary[] = [];
  let buffer: TranscriptWord[] = [];
  let index = 0;
  const flush = () => {
    if (!buffer.length) return;
    sentences.push({
      index,
      startUs: buffer[0].startUs,
      endUs: buffer[buffer.length - 1].endUs,
      text: buffer.map((word) => word.text).join(" "),
    });
    index += 1;
    buffer = [];
  };
  for (const word of words) {
    buffer.push(word);
    if (/[.!?]["']?$/.test(word.text)) flush();
  }
  flush();
  return sentences;
}

/**
 * Explicit stub when ASR is not integrated: empty transcript with reason.
 */
export function stubTranscript(reason = "asr_not_integrated"): {
  words: TranscriptWord[];
  sentences: SentenceBoundary[];
  stubReason: string;
} {
  return { words: [], sentences: [], stubReason: reason };
}
