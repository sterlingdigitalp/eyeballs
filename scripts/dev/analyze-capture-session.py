#!/usr/bin/env python3
"""Post-soak analysis: segment boundary timing, health trends, A/V offset.

Usage:
  python3 scripts/dev/analyze-capture-session.py /path/to/sessionRoot [/path/to/events.jsonl]

Writes:
  sessionRoot/ANALYSIS_REPORT.txt
  sessionRoot/analysis.json
"""
from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path


def load_events(path: Path) -> list[dict]:
    events: list[dict] = []
    if not path.is_file():
        return events
    for line in path.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def num(payload: dict, *keys: str):
    for k in keys:
        if k in payload and payload[k] is not None:
            try:
                return float(payload[k])
            except (TypeError, ValueError):
                pass
    return None


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: analyze-capture-session.py <sessionRoot> [events.jsonl]", file=sys.stderr)
        return 2

    session = Path(sys.argv[1]).resolve()
    events_path = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else session.parent / "events.jsonl"
    if not events_path.is_file():
        # also try session-adjacent log layout from soak runner
        alt = session.parent / "events.jsonl"
        events_path = alt if alt.is_file() else events_path

    finished_path = session / "recording-finished.json"
    finished = json.loads(finished_path.read_text()) if finished_path.is_file() else {}
    events = load_events(events_path)

    segs: list[dict] = []
    health: list[dict] = []
    for ev in events:
        typ = ev.get("type")
        payload = ev.get("payload") or {}
        ts = ev.get("timestampUs")
        if typ == "segment_finalized":
            segs.append(
                {
                    "index": payload.get("segmentIndex"),
                    "reason": payload.get("reason"),
                    "firstVideoPtsUs": num(payload, "firstVideoPtsUs"),
                    "firstAudioPtsUs": num(payload, "firstAudioPtsUs"),
                    "videoByteLength": num(payload, "videoByteLength"),
                    "audioByteLength": num(payload, "audioByteLength"),
                    "eventTimestampUs": ts,
                }
            )
        elif typ == "health":
            health.append(
                {
                    "eventTimestampUs": ts,
                    "videoFrames": num(payload, "videoFrames"),
                    "droppedVideo": num(payload, "droppedVideo"),
                    "segmentIndex": payload.get("segmentIndex"),
                    "finalizedSegments": payload.get("finalizedSegments"),
                    "diskFreeBytes": num(payload, "diskFreeBytes"),
                    "previewAchievedFps": num(payload, "previewAchievedFps"),
                }
            )

    segs.sort(key=lambda s: (s["index"] is None, s["index"] if s["index"] is not None else 0))

    # Boundary gaps: consecutive segment firstVideoPtsUs delta, and event wall clock between finalizations
    video_gaps_us: list[float] = []
    wall_gaps_us: list[float] = []
    for a, b in zip(segs, segs[1:]):
        if a["firstVideoPtsUs"] is not None and b["firstVideoPtsUs"] is not None:
            video_gaps_us.append(b["firstVideoPtsUs"] - a["firstVideoPtsUs"])
        if a["eventTimestampUs"] is not None and b["eventTimestampUs"] is not None:
            wall_gaps_us.append(float(b["eventTimestampUs"]) - float(a["eventTimestampUs"]))

    def stats_us(values: list[float]) -> dict:
        if not values:
            return {"count": 0}
        return {
            "count": len(values),
            "minUs": min(values),
            "maxUs": max(values),
            "meanUs": statistics.mean(values),
            "medianUs": statistics.median(values),
            "stdevUs": statistics.pstdev(values) if len(values) > 1 else 0.0,
            "minMs": min(values) / 1000.0,
            "maxMs": max(values) / 1000.0,
            "meanMs": statistics.mean(values) / 1000.0,
            "medianMs": statistics.median(values) / 1000.0,
        }

    # Instantaneous fps from health samples (Δframes / Δwall)
    inst_fps: list[float] = []
    for a, b in zip(health, health[1:]):
        if (
            a["eventTimestampUs"] is not None
            and b["eventTimestampUs"] is not None
            and a["videoFrames"] is not None
            and b["videoFrames"] is not None
        ):
            dt = (float(b["eventTimestampUs"]) - float(a["eventTimestampUs"])) / 1_000_000.0
            df = b["videoFrames"] - a["videoFrames"]
            if dt > 0.05 and df >= 0:
                inst_fps.append(df / dt)

    disk_start = health[0]["diskFreeBytes"] if health else None
    disk_end = health[-1]["diskFreeBytes"] if health else None
    disk_delta = None
    if disk_start is not None and disk_end is not None:
        disk_delta = disk_start - disk_end  # bytes consumed (approx)

    analysis = {
        "sessionRoot": str(session),
        "eventsPath": str(events_path) if events_path.is_file() else None,
        "eventCount": len(events),
        "segmentFinalizedCount": len(segs),
        "healthSampleCount": len(health),
        "finished": {
            "measuredVideoFps": finished.get("measuredVideoFps"),
            "wallDurationSec": finished.get("wallDurationSec"),
            "negotiatedWidth": finished.get("negotiatedWidth"),
            "negotiatedHeight": finished.get("negotiatedHeight"),
            "negotiatedFrameRate": finished.get("negotiatedFrameRate"),
            "avInitialOffsetUs": finished.get("avInitialOffsetUs"),
            "videoFrames": finished.get("videoFrames"),
            "droppedVideo": finished.get("droppedVideo"),
            "finalizedSegments": finished.get("finalizedSegments"),
            "previewFrames": finished.get("previewFrames"),
        },
        "boundary": {
            "videoPtsGap": stats_us(video_gaps_us),
            "finalizeWallGap": stats_us(wall_gaps_us),
            "note": (
                "videoPtsGap is Δ firstVideoPtsUs between consecutive segment_finalized events. "
                "Near segmentDurationSec (e.g. 10s) is healthy; large outliers need review."
            ),
        },
        "healthTrends": {
            "instantaneousFps": {
                "count": len(inst_fps),
                "min": min(inst_fps) if inst_fps else None,
                "max": max(inst_fps) if inst_fps else None,
                "mean": statistics.mean(inst_fps) if inst_fps else None,
                "median": statistics.median(inst_fps) if inst_fps else None,
            },
            "diskFreeBytesStart": disk_start,
            "diskFreeBytesEnd": disk_end,
            "approxBytesWrittenFromDiskFree": disk_delta,
        },
    }

    # Simple continuity flags
    expected_seg_us = float(finished.get("segmentDurationSec") or 10) * 1_000_000
    outliers = []
    for i, gap in enumerate(video_gaps_us):
        # allow 20% slop around segment duration for first-PTS method
        if gap < expected_seg_us * 0.5 or gap > expected_seg_us * 1.5:
            outliers.append({"afterSegmentIndex": segs[i].get("index"), "gapUs": gap, "gapSec": gap / 1e6})
    analysis["boundary"]["outlierGaps"] = outliers[:50]
    analysis["boundary"]["outlierCount"] = len(outliers)

    out_json = session / "analysis.json"
    out_txt = session / "ANALYSIS_REPORT.txt"
    out_json.write_text(json.dumps(analysis, indent=2, sort_keys=True) + "\n")

    lines = [
        "CaptureCore session analysis (Stage 6)",
        f"sessionRoot={session}",
        f"events={events_path if events_path.is_file() else 'MISSING'}",
        f"eventCount={len(events)}",
        f"segmentFinalizedCount={len(segs)}",
        f"healthSampleCount={len(health)}",
        "",
        "## Finished honesty",
        f"measuredVideoFps={finished.get('measuredVideoFps')}",
        f"negotiated={finished.get('negotiatedWidth')}x{finished.get('negotiatedHeight')}@{finished.get('negotiatedFrameRate')}",
        f"wallDurationSec={finished.get('wallDurationSec')}",
        f"avInitialOffsetUs={finished.get('avInitialOffsetUs')} ({(finished.get('avInitialOffsetUs') or 0)/1000:.2f} ms)",
        f"videoFrames={finished.get('videoFrames')} droppedVideo={finished.get('droppedVideo')}",
        f"previewFrames={finished.get('previewFrames')}",
        "",
        "## Segment boundary (firstVideoPtsUs gaps)",
    ]
    vg = analysis["boundary"]["videoPtsGap"]
    if vg.get("count"):
        lines += [
            f"count={vg['count']}",
            f"meanSec={vg['meanMs']/1000:.4f} medianSec={vg['medianMs']/1000:.4f}",
            f"minSec={vg['minMs']/1000:.4f} maxSec={vg['maxMs']/1000:.4f}",
            f"outlierCount={analysis['boundary']['outlierCount']} (outside 50–150% of segmentDuration)",
        ]
    else:
        lines.append("no firstVideoPtsUs pairs on consecutive segment_finalized events")
        lines.append("(CaptureCore may only emit first PTS on early segments — improve instrumentation if empty)")

    lines += ["", "## Health instantaneous FPS (between health samples)"]
    hf = analysis["healthTrends"]["instantaneousFps"]
    if hf.get("count"):
        lines.append(
            f"count={hf['count']} mean={hf['mean']:.3f} median={hf['median']:.3f} "
            f"min={hf['min']:.3f} max={hf['max']:.3f}"
        )
    else:
        lines.append("insufficient health samples")

    lines += ["", "## Disk free (from health)"]
    lines.append(f"start={disk_start} end={disk_end} approxConsumedBytes={disk_delta}")

    lines += ["", "RESULT=ANALYZED"]
    out_txt.write_text("\n".join(lines) + "\n")
    print(out_txt.read_text())
    print(f"wrote {out_txt}")
    print(f"wrote {out_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
