# Camera Presence Coach

Local-first macOS camera-contact measurement application. This repository currently implements the
Phase 1 measurement kernel described in
`CAMERA_PRESENCE_PRESENTER_TWIN_BUILD_PLAN.md`.

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
