import { describe, expect, it } from "vitest";
import { isSha256Hex, sha256Hex } from "./sha256";

describe("sha256Hex", () => {
  it("produces a 64-char hex digest that changes with content", async () => {
    const a = await sha256Hex(new Uint8Array([1, 2, 3]));
    const b = await sha256Hex(new Uint8Array([1, 2, 4]));
    expect(isSha256Hex(a)).toBe(true);
    expect(isSha256Hex(b)).toBe(true);
    expect(a).not.toBe(b);
    // empty input is still a valid SHA-256
    const empty = await sha256Hex(new Uint8Array());
    expect(isSha256Hex(empty)).toBe(true);
  });
});
