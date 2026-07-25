import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";

const tauriConfigPath = "apps/desktop/src-tauri/tauri.conf.json";
const packagePath = "package.json";
const infoPlistPath = "apps/desktop/src-tauri/Info.plist";
const fixturePath = "fixtures/synthetic/synthetic-av.mp4";
const expectedFixtureHash =
  "83e3732537617ab45a6fb3bc3fc6f4fc4e8474c9f324561af10f49c4dcccd3e1";

const tauriConfig = z.object({
  productName: z.string().min(1),
  version: z.string().min(1),
  identifier: z.string().regex(/^[a-zA-Z0-9.-]+$/),
  build: z.object({
    frontendDist: z.string().min(1),
  }),
  app: z.object({
    security: z.object({
      csp: z.string().min(1),
    }),
  }),
}).parse(JSON.parse(await readFile(tauriConfigPath, "utf8")));

const packageDocument = z.object({
  version: z.string().min(1),
}).parse(JSON.parse(await readFile(packagePath, "utf8")));

if (tauriConfig.version !== packageDocument.version) {
  throw new Error(
    `Version mismatch: Tauri is ${tauriConfig.version}, package.json is ${packageDocument.version}.`,
  );
}
if (tauriConfig.app.security.csp.includes("https:")) {
  throw new Error("Production CSP must not allow external HTTPS resources.");
}
if (!tauriConfig.app.security.csp.includes("connect-src 'self' ipc: http://ipc.localhost")) {
  throw new Error("Production CSP must restrict network connections to local Tauri IPC.");
}

const infoPlist = await readFile(infoPlistPath, "utf8");
for (const permissionKey of [
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
]) {
  if (!infoPlist.includes(`<key>${permissionKey}</key>`)) {
    throw new Error(`Info.plist is missing ${permissionKey}.`);
  }
}

const fixtureHash = createHash("sha256")
  .update(await readFile(fixturePath))
  .digest("hex");
if (fixtureHash !== expectedFixtureHash) {
  throw new Error(
    `Synthetic A/V fixture hash mismatch: expected ${expectedFixtureHash}, got ${fixtureHash}.`,
  );
}

console.info(
  `Validated ${tauriConfig.productName} ${tauriConfig.version} configuration, local-only CSP, and synthetic fixture.`,
);
