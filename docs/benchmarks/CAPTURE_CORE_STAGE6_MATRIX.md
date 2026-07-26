# CaptureCore Stage 6 — recovery matrix & soak plan

**Status:** Scaffolding ready for unattended soaks (2026-07-26)  
**Branch:** `feature/capture-core`  
**Authority:** Charter Stage 6 exit + product Stage 6 matrix

Stage 6 proves **honesty under adverse conditions**, not a redesign.

---

## Tools (soak-ready)

| Tool | Purpose |
|---|---|
| `scripts/dev/run-capture-core-soak.sh` | Unattended soak (Terminal / packaged CaptureCore.app) |
| `scripts/dev/validate-capture-session.sh` | Every segment: decode (ffprobe) + SHA-256 vs seal |
| Session `recording-finished.json` | Negotiated format, **measuredVideoFps**, A/V offset |
| Session `session-seal.json` | Rust hashes + `capture` metrics block |
| Run dir `SOAK_RESULT.txt` | Single-file pass/fail after soak |

### Unattended 1h Brio 4K + Yeti

```sh
# In Terminal.app — leave Mac awake; walk away
cd /Users/sterlingdigital/eyeballs-capture-core
# optional: caffeinate is invoked inside the script when available
sh scripts/dev/run-capture-core-soak.sh brio-yeti 3600
# when you return:
cat /tmp/capture-core-soak/brio-yeti-*/SOAK_RESULT.txt
```

### Unattended 1h MacBook camera + built-in mic

```sh
sh scripts/dev/run-capture-core-soak.sh macbook 3600
```

### Lower-cost dual (1080p) after 4K proof

```sh
sh scripts/dev/run-capture-core-soak.sh brio-yeti-1080 3600
```

### Validate any existing session

```sh
sh scripts/dev/validate-capture-session.sh "/path/to/sessionRoot"
```

**TCC note:** Live soaks must use Terminal or packaged/Tauri product parent — **not** the agent host.

**Device ID overrides** (if list-devices differs):

```sh
export BRIO_CAMERA_ID='…'
export YETI_MIC_ID='…'
export MACBOOK_CAMERA_ID='…'
export MACBOOK_MIC_ID='…'
```

---

## Matrix

Fill `Result` with PASS / FAIL / SKIP and link run dir or commit note.

| # | Test | Procedure | Acceptance | Result | Evidence |
|---|---|---|---|---|---|
| 1 | **1h Brio 4K + Yeti soak** | `run-capture-core-soak.sh brio-yeti 3600` | exit 0; validation PASS; honest measured FPS; hashes; disk growth sane | **PASS** | `docs/benchmarks/soaks/brio-yeti-20260726T115313Z-SUMMARY.md` · runDir `/tmp/capture-core-soak/brio-yeti-20260726T115313Z` · measured **~23.97 fps** · 345 segments · 0 drops · ~14 GiB · validation RESULT=PASS |
| 2 | **1h MacBook + built-in mic** | `run-capture-core-soak.sh macbook 3600` | same as #1 for built-in profile | | |
| 3 | **Segmented multi-hour** | e.g. `brio-yeti-1080` 7200–10800 after #1 | no crash; memory/handles stable; drift noted | | |
| 4 | **Camera unplug mid open segment** | Start soak; unplug Brio mid-segment | prior segments playable; no false complete | | |
| 5 | **Mic unplug mid record** | Unplug Yeti mid-take | policy-documented behavior; honest incomplete/degraded | | |
| 6 | **Yeti mute / prolonged silence** | Mute ~30s+ | no crash; silence/mute observable or warned; no fake continuity | | |
| 7 | **CaptureCore SIGKILL** | Kill -9 after >segmentDuration | no complete finish marker; prior segs survive; orphan scan finds session | **PASS (class)** Stage 2 | `/tmp/capture-core-stage2-kill` |
| 8 | **Tauri force quit** | Live Dataset record; force quit app | child dead or orphaned; relaunch does not continue take | | |
| 9 | **Disk-pressure** | Constrained volume only — **not** system disk | preflight/runtime warning; incomplete finalize; no false complete | | |
| 10 | **Signed release bundle** | `package:app` / signed .app; Finder launch | TCC; embedded sidecar; restart/reconnect | | |

---

## Acceptance conditions (production-ready)

CaptureCore is production-ready when **all** are true and committed:

1. Every **closed** segment is decodable and hash-valid (validator PASS on soaks).  
2. At most the **currently open** segment is lost after abrupt kill.  
3. No failure path produces a **false complete**.  
4. Segment boundaries have **measured** timing continuity (report).  
5. **Actual delivered FPS** is recorded honestly on each seal/finish.  
6. **A/V drift** evidence exists for the complete soak(s).  
7. **Release-bundle TCC** works without Terminal.  
8. This matrix + soak reports are committed.  
9. **ADR-004** moves Provisional → **Accepted**.

### Scaffolding status

| Condition | Scaffolding |
|---|---|
| Closed segment decode + hash | `validate-capture-session.sh` (**proven** on 690 files, 1h soak) |
| Honest measured FPS | `recording-finished.json` → `measuredVideoFps` + seal `capture` (**~24 fps** on 4K Brio soak) |
| A/V initial offset | `avInitialOffsetUs` on finish (**53.4 ms** on 1h soak; hour-scale drift still open) |
| Boundary continuity | **Not automated yet** — post-soak analysis of events |
| Unattended 1h run | `run-capture-core-soak.sh` (**proven**) |
| Terminal soak seal | soak script now writes `session-seal.json` after capture |
| Matrix document | this file |

---

## After a soak (human + agent)

1. Paste or share `SOAK_RESULT.txt` + path under `/tmp/capture-core-soak/…`  
2. Agent updates this matrix Result/Evidence columns  
3. If FAIL: fix code or re-run; if PASS: proceed to next matrix row  

Do **not** declare Stage 6 complete until acceptance list is green.
