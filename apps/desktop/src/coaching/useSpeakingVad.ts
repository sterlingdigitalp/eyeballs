import { useCallback, useEffect, useRef, useState } from "react";
import {
  StreamingVad,
  type SpeakingWindow,
} from "../../../../packages/coaching/src";
import { rmsDbfs } from "../lib/audio-level";

/**
 * Live VAD from microphone stream. Never blocks on transcription.
 * Returns speaking boolean, completed windows, and finish() to close an open window.
 */
export function useSpeakingVad(
  stream: MediaStream | undefined,
  enabled: boolean,
): {
  speaking: boolean;
  windows: SpeakingWindow[];
  /** Close any open speaking window and return the full list for metrics. */
  finish: () => SpeakingWindow[];
} {
  const [speaking, setSpeaking] = useState(false);
  const [windows, setWindows] = useState<SpeakingWindow[]>([]);
  const vadRef = useRef<StreamingVad | undefined>(undefined);
  const windowsRef = useRef<SpeakingWindow[]>([]);

  const finish = useCallback((): SpeakingWindow[] => {
    const vad = vadRef.current;
    if (!vad) return [...windowsRef.current];
    const closed = vad.finish(Math.round(performance.now() * 1000));
    windowsRef.current = [...closed];
    setWindows([...closed]);
    setSpeaking(false);
    return [...closed];
  }, []);

  useEffect(() => {
    if (!enabled || !stream?.getAudioTracks().length) {
      setSpeaking(false);
      return;
    }
    const vad = new StreamingVad();
    vadRef.current = vad;
    windowsRef.current = [];
    setWindows([]);
    let cancelled = false;
    let context: AudioContext | undefined;
    let processor: ScriptProcessorNode | undefined;
    let source: MediaStreamAudioSourceNode | undefined;

    try {
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (event) => {
        if (cancelled) return;
        const input = event.inputBuffer.getChannelData(0);
        const dbfs = rmsDbfs(input);
        const rms = dbfs <= -120 ? 0 : Math.min(1, Math.pow(10, dbfs / 20));
        const nowUs = Math.round(performance.now() * 1000);
        const priorCount = vad.windows.length;
        const next = vad.push({ rms, timestampUs: nowUs });
        setSpeaking(next);
        if (vad.windows.length !== priorCount) {
          windowsRef.current = [...vad.windows];
          setWindows([...vad.windows]);
        }
      };
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
    } catch {
      setSpeaking(false);
    }

    return () => {
      cancelled = true;
      const finished = vad.finish(Math.round(performance.now() * 1000));
      windowsRef.current = [...finished];
      setWindows([...finished]);
      try {
        processor?.disconnect();
        source?.disconnect();
        void context?.close();
      } catch {
        // ignore teardown errors
      }
      // Keep vadRef available until next enable so finish() after stop still works
      // only if we clear it — clear after copying windows.
      vadRef.current = undefined;
    };
  }, [enabled, stream]);

  return { speaking, windows, finish };
}
