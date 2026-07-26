import { describe, expect, it } from "vitest";
import {
  sparklinePoints,
  sparklinePolyline,
} from "./trend-sparkline";

describe("progress trend sparkline", () => {
  it("maps a series from left to right with higher values higher on the chart", () => {
    const points = sparklinePoints([1, 2, 3], 100, 30, 2);
    expect(points[0].x).toBe(2);
    expect(points.at(-1)?.x).toBe(98);
    expect(points[0].y).toBeGreaterThan(points.at(-1)!.y);
  });

  it("centers flat and single-value series without invalid coordinates", () => {
    expect(sparklinePoints([4, 4], 100, 30)).toEqual([
      { x: 2, y: 15 },
      { x: 98, y: 15 },
    ]);
    expect(sparklinePoints([4], 100, 30)).toEqual([{ x: 50, y: 15 }]);
    expect(sparklinePoints([])).toEqual([]);
  });

  it("formats points for an SVG polyline", () => {
    expect(
      sparklinePolyline([
        { x: 2, y: 10 },
        { x: 20.125, y: 5.5 },
      ]),
    ).toBe("2.00,10.00 20.13,5.50");
  });
});
