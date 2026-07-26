# Camera Presence Coach

Local-first macOS camera-contact coaching application. Status (see
`CAMERA_PRESENCE_PRESENTER_TWIN_BUILD_PLAN.md`):

- **Phase 1:** measurement kernel largely implemented; human/hardware acceptance still open
- **Phase 2:** integrated coaching **prototype** (drills, cues, train/review/progress) — not an accepted MVP
- **Phase 3:** dataset scaffolding + CaptureCore seal ingest (production masters via CaptureCore branch)
- **Phase 4:** controlled presenter-twin proof **contracts + readiness UI** begun — no provider upload yet

CaptureCore live stages and Stage 6 soaks: branch `feature/capture-core` (see that worktree handoff).

## Development

```sh
npm install
npm run prepare:assets
npm run dev
```

The app does not request camera or microphone access at launch. Enable each device separately in
Setup, choose a matched profile, calibrate it, then run a practice or recorded test.

## Verification

```sh
npm run verify
npm run package:app
```

Hardware acceptance and human-label accuracy require the actual MacBook/Brio/Yeti setups and are
tracked in `docs/acceptance/PHASE_1_ACCEPTANCE.md`.
