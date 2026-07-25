# Synthetic A/V fixture

`synthetic-av.mp4` is generated locally and contains no person, voice, or biometric data. It is an
eight-second 1280×720/30 video with a one-second visual flash and synchronized 1 kHz audio pulse.
It supports deterministic playback, recorder, timestamp, and A/V-alignment smoke tests without
using the owner's camera data.

With the pinned local FFmpeg 8.1.1 generator, its SHA-256 is
`83e3732537617ab45a6fb3bc3fc6f4fc4e8474c9f324561af10f49c4dcccd3e1`.

Regenerate and inspect it with:

```sh
npm run fixture:av
```

`review-labels.json` provides deterministic session-relative intervals for review and time-range
tests. It does not claim the geometric fixture is usable for face tracking.
