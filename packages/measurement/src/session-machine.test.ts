import { describe, expect, it } from "vitest";
import { transitionSession } from "./session-machine";

describe("session state machine", () => {
  it("follows the recorded test lifecycle", () => {
    let state = transitionSession("idle", "begin_setup");
    state = transitionSession(state, "ready");
    state = transitionSession(state, "begin_countdown");
    state = transitionSession(state, "record");
    state = transitionSession(state, "stop");
    state = transitionSession(state, "finalized");
    state = transitionSession(state, "analyzed");
    expect(state).toBe("review_ready");
  });

  it("has deterministic device-loss recovery", () => {
    let state = transitionSession("recording", "device_removed");
    expect(state).toBe("device_lost");
    state = transitionSession(state, "recover");
    expect(state).toBe("recovery_required");
    expect(transitionSession(state, "reset")).toBe("idle");
  });

  it("rejects impossible transitions", () => {
    expect(() => transitionSession("idle", "record")).toThrow(/Invalid session transition/);
  });
});
