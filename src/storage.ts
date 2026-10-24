import { openDB } from "idb";
import { empty, validate, migrateReviews, type Data } from "./model";
export type StorageOptions = {
  recording?: { id: string; blob: Blob };
  clearAudio?: boolean;
};
let database: ReturnType<typeof openDB> | undefined;
const db = () =>
  (database ??= openDB("musicsensor", 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
      if (!db.objectStoreNames.contains("debugAudio"))
        db.createObjectStore("debugAudio");
    },
  }));
export async function load(): Promise<Data> {
  const d = await db();
  const value = await d.get("state", "main");
  return value ? migrateReviews(validate(value)) : empty();
}
export async function save(value: Data, options: StorageOptions = {}) {
  const d = await db();
  const tx = d.transaction(["state", "debugAudio"], "readwrite");
  const audio = tx.objectStore("debugAudio");
  await tx.objectStore("state").put(value, "main");
  if (options.clearAudio) await audio.clear();
  const keep = new Set(value.debug.map((a) => a.id));
  for (const key of await audio.getAllKeys())
    if (!keep.has(String(key))) await audio.delete(key);
  const recording = options.recording;
  if (
    recording &&
    keep.has(recording.id) &&
    recording.blob.size > 0 &&
    recording.blob.size <= 1048576
  )
    await audio.put(recording.blob, recording.id);
  await tx.done;
}
export async function loadRecordings(
  ids: string[],
): Promise<Record<string, Blob>> {
  const d = await db();
  const result: Record<string, Blob> = {};
  for (const id of ids) {
    const blob = await d.get("debugAudio", id);
    if (blob instanceof Blob) result[id] = blob;
  }
  return result;
}
