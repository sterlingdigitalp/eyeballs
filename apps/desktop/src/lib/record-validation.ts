import type { ZodType } from "zod";

export function parseRecordList<T>(
  schema: ZodType<T>,
  values: unknown[],
  bucket: string,
): T[] {
  return values.flatMap((value, index) => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return [parsed.data];
    console.error(`Discarded invalid ${bucket} record at index ${index}.`);
    return [];
  });
}

export function mergeRecordsById<T extends { id: string }>(
  browserRecords: T[],
  nativeRecords: T[],
  preferBrowser: (browser: T, native: T) => boolean = () => true,
): T[] {
  const merged = new Map(nativeRecords.map((record) => [record.id, record]));
  for (const browser of browserRecords) {
    const native = merged.get(browser.id);
    if (!native || preferBrowser(browser, native)) merged.set(browser.id, browser);
  }
  return [...merged.values()];
}
