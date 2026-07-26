# CaptureCore handoff (Stages 1–6 scaffolding)

**Branch:** `feature/capture-core`  
**Updated:** 2026-07-26

## Done

| Area | Status |
|---|---|
| Stages 1–5 | Complete (CLI, Tauri slice, preview) |
| Stage 6 scaffolding | Soak launcher, validator, analysis, policies |
| 1h Brio 4K + Yeti | **PASS** (~24 fps honest) |
| 1h MacBook + built-in | **PASS** (~30 fps honest) |
| SIGKILL recovery (class) | PASS — prior segments playable |

Evidence: `docs/benchmarks/CAPTURE_CORE_STAGE6_MATRIX.md`, `docs/benchmarks/soaks/`.

## Remaining human tests (when you have time)

| # | Test | Approx time |
|---|---|---|
| 3 | Multi-hour dual (e.g. `brio-yeti-1080 7200`) | 2–3h unattended |
| 4 | Camera unplug mid open segment | 15 min |
| 5 | Mic unplug mid record | 15 min |
| 6 | Yeti mute / silence | 15 min |
| 8 | Tauri force quit mid Dataset live | 10 min |
| 9 | Disk-pressure on **small volume** | 30 min |
| 10 | Signed/ad-hoc **release** `.app` TCC | 30 min |

Policies: `docs/benchmarks/CAPTURE_CORE_STAGE6_FAILURE_POLICIES.md`.

## Commands

```sh
cd /Users/sterlingdigital/eyeballs-capture-core
sh scripts/dev/run-capture-core-soak.sh macbook 3600
sh scripts/dev/run-capture-core-soak.sh brio-yeti 3600
sh scripts/dev/validate-capture-session.sh /path/to/session
python3 scripts/dev/analyze-capture-session.py /path/to/session /path/to/events.jsonl
```

Live soaks: **Terminal.app**, not agent host (TCC).

## Integration note

Main app work (Phase 2–4 prototype) lives on `agent/phase-2-prototype-checkpoint` and already ingests CaptureCore seals via `packages/dataset/src/capture-seal.ts`.  
Merge path: land CaptureCore after Stage 6 acceptance (or land Stage 1–5 now with Stage 6 open).

## ADR-004

Remains **Provisional** until failure matrix + soak reports complete and are reviewed.