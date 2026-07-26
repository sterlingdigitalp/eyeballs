import type { GazeState } from "../../../../packages/contracts/src";
import { RecordingPrivacyBadge } from "./TrainPanel";

export interface LiveAssistHudProps {
  visible: boolean;
  onToggleVisible: () => void;
  state?: GazeState;
  recording: boolean;
  /** Always defaults recording off for live assist. */
  recordingDefaultOff?: boolean;
}
/**
 * Compact private live-assist HUD chrome (halo + privacy state + hide/show).
 * Does not inject into any outgoing virtual camera path.
 */
export function LiveAssistHud({
  visible,
  onToggleVisible,
  state = "unknown",
  recording,
}: LiveAssistHudProps) {
  const privacy = recording ? "LIVE ASSIST — RECORDING" : "LIVE ASSIST — NOT RECORDING";
  return (
    <div
      className={`live-assist-hud ${visible ? "" : "hidden-hud"}`}
      data-live-assist="true"
      data-recording={recording ? "true" : "false"}
      data-recording-default="off"
    >
      <RecordingPrivacyBadge label={privacy} />
      <div className={`live-assist-halo ${state}`} aria-label={`Contact halo ${state}`} />
      <p className="muted">Private HUD · not on the outgoing video</p>
      <button type="button" className="secondary" onClick={onToggleVisible}>
        {visible ? "Hide HUD" : "Show HUD"}
      </button>
    </div>
  );
}
