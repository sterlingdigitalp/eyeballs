# Blue Yeti signal check

Date: 2026-07-25

Device: `Yeti Stereo Microphone`

Stable AVFoundation ID:
`AppleUSBAudioEngine:Generic:Blue Microphones:LT_2007152009165F390492_111000:1`

## Capability inventory

- 48,000 Hz, 16-bit, 2-channel linear PCM
- 44,100 Hz, 16-bit, 2-channel linear PCM

## Discard-only sample-flow check

Command:

```sh
ffmpeg -hide_banner -f avfoundation -i ':0' -t 3 \
  -af 'astats=metadata=1:reset=1' -f null -
```

Observed:

- negotiated input: 48,000 Hz stereo;
- three seconds completed at approximately real-time speed;
- 500 KiB of decoded audio reached the null sink;
- both channels carried samples;
- no NaNs, infinities, or denormal samples;
- no media file was written or retained.

The ambient level during this silent check was approximately -47.2 dB RMS with a -41.5 dB peak.
Speaking-level gain, hardware mute/unmute, and in-app negotiated channel count remain separate
acceptance checks.
