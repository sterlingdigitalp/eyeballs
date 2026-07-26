import type { ExportPackage } from "./versioning";
import { serializeExportArchive } from "./versioning";

/** Trigger a browser download of the export archive bytes. */
export function downloadBytes(filename: string, bytes: Uint8Array, mimeType: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function downloadExportPackage(
  pkg: ExportPackage,
  fileContents: Record<string, Uint8Array>,
  filename = `presenter-dataset-v${pkg.version}.json`,
): Promise<void> {
  const archive = await serializeExportArchive(pkg, fileContents);
  downloadBytes(filename, archive, "application/json");
}
