# Logitech Brio capture check

Date: 2026-07-25

Device: `Logitech BRIO`

Stable AVFoundation ID: `0x1200000046d085e`

## Capability inventory

AVFoundation exposes, among other modes:

- 3840×2160 at up to 30 fps;
- 4096×2160 at up to 30 fps;
- 2560×1440 at up to 30 fps;
- 1920×1080 at up to 60 fps;
- 1280×720 at up to 90 fps;
- 640×480 at up to 120 fps.

The media subtype for the target 4K and high-frame-rate modes is NV12 (`420v`).

## Short discard-only checks

No video file was written or retained.

| Requested mode | Observed frames | Observed duration | Result |
|---|---:|---:|---|
| 3840×2160 at 30 fps | 87 | 3.00 s | Pass, approximately 29 fps |
| 1920×1080 at 60 fps | 179 | 3.00 s | Pass, approximately 60 fps |

The device index changed between enumeration calls, while the stable AVFoundation ID and device name
remained constant. This confirms that persisted profiles must never rely on a transient numeric
index.

## Long soak

A planned longer 3840×2160/30 discard-only capture was stopped after 77.26 seconds. It delivered
2,319 frames at approximately 30 fps and exited normally after SIGTERM. No output file was created.
The product owner accepted this run as sufficient Phase 1 transport-stability evidence; longer
soaks are no longer required for this phase.

## Reproducible presenter geometry

Use this placement for the Studio Capture calibration and record any deviation in the profile notes:

- mount the Brio on a rigid tripod or monitor mount, centered horizontally;
- place the lens at eye height or no more than 50 mm above the seated eye line;
- begin 0.75–1.0 m from the subject and keep head-and-shoulders framing;
- use the 65° field of view for calibration and validation;
- place speaking notes or the primary content window immediately beneath the lens;
- disable automatic reframing and do not move the tripod after calibration;
- mark the tripod height, chair position, and camera distance for later-day reproduction.

This geometry minimizes resting head pitch and the angular distance between the physical lens and
on-screen content. It is a separate setup from MacBook Practice and therefore requires its own
calibration.
