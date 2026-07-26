/**
 * Real SHA-256 hex digests via Web Crypto (browser + modern Node).
 * Prefer this over FNV prototype digests for any integrity claim.
 */

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("crypto.subtle is required for SHA-256 digests");
  }
  // Copy into a plain ArrayBuffer — some runtimes reject SharedArrayBuffer views.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await subtle.digest("SHA-256", copy.buffer);
  return toHex(digest);
}

export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}
