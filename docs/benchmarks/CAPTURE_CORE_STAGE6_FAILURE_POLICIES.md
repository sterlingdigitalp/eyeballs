# CaptureCore Stage 6 — failure policies (documented before adverse tests)

These policies define **honest** behavior for unplug/mute/disk cases.
Implementations may still be partial; tests score against this document.

## Camera unplug during an open segment

| Expectation | Detail |
|---|---|
| Prior finalized segments | Remain on disk and **decodable** |
| Open segment | May be incomplete / undecodable |
| Session status | **incomplete** (no `status: complete` finish marker) |
| Auto-restart | **Forbidden** |
| Seal | Either absent or `status` not `complete` |

## Microphone unplug during recording

| Expectation | Detail |
|---|---|
| Video | Prefer **continue** writing video masters if camera still healthy |
| Audio | Stop appending; last audio segment finalized if possible |
| Protocol | Emit `error` or health flag `audioDeviceLost=true` (target) |
| Session status | **incomplete** or **complete_with_degraded_audio** once coded; until then incomplete is acceptable |
| Fabrication | **Never** invent silence as continuous “good” audio without flags |

## Yeti mute / prolonged silence

| Expectation | Detail |
|---|---|
| Crash | **Must not** crash |
| Detection | Target: health `audioPeak` / silence streak (not yet required for PASS if documented skip) |
| Continuity | Muted signal is real zeros — OK; must not claim rich audio |
| Warning | Target: `health` / `error` with `audioSilence=true` after N seconds |

## CaptureCore SIGKILL / Tauri force quit

| Expectation | Detail |
|---|---|
| Finish marker | No `recording-finished` with `status: complete` |
| Prior segments | Survive and validate when closed |
| Orphan scan | Session identifiable as incomplete |
| Resume | Relaunch **must not** append as continuous same take |

## Disk pressure (constrained volume only)

| Expectation | Detail |
|---|---|
| Preflight | Prefer warn when free space &lt; threshold (target) |
| Runtime | Health `diskFreeBytes` trending; stop with incomplete if write fails |
| False complete | **Forbidden** after writer failure |

## Operator notes

- Never fill the **system** disk for tests — use a small APFS volume or sparse image.
- Agent host cannot grant TCC; adverse camera tests use Terminal / packaged app.
