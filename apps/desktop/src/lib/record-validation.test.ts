import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { mergeRecordsById, parseRecordList } from "./record-validation";

describe("stored record validation", () => {
  it("keeps valid records and rejects malformed records independently", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      parseRecordList(
        z.object({ id: z.string(), value: z.number() }),
        [{ id: "valid", value: 1 }, { id: "broken", value: "wrong" }],
        "fixture",
      ),
    ).toEqual([{ id: "valid", value: 1 }]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("merges redundant stores without losing records unique to either side", () => {
    const merged = mergeRecordsById(
      [{ id: "shared", version: 2 }, { id: "browser", version: 1 }],
      [{ id: "shared", version: 1 }, { id: "native", version: 1 }],
      (browser, native) => browser.version >= native.version,
    );
    expect(merged).toEqual([
      { id: "shared", version: 2 },
      { id: "native", version: 1 },
      { id: "browser", version: 1 },
    ]);
  });
});
