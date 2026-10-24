import { openDB } from "idb";
import { empty, validate, type Data } from "./model";
let database: ReturnType<typeof openDB> | undefined;
const db = () =>
  (database ??= openDB("musicsensor", 1, {
    upgrade(db) {
      db.createObjectStore("state");
    },
  }));
export async function load(): Promise<Data> {
  const d = await db();
  const value = await d.get("state", "main");
  return value ? validate(value) : empty();
}
export async function save(value: Data) {
  const d = await db();
  await d.put("state", value, "main");
}
