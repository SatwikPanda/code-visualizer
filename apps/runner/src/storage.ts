import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import type { TraceEvent } from "../../../packages/contracts/src/index";

export const dataRoot = path.resolve(process.env.RUNNER_DATA_DIR || ".data");
mkdirSync(dataRoot, { recursive: true });
export const db = new DatabaseSync(path.join(dataRoot, "metadata.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,lease TEXT,cancel INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS chunks (run TEXT NOT NULL,first INTEGER NOT NULL,last INTEGER NOT NULL,path TEXT NOT NULL,checksum TEXT NOT NULL,PRIMARY KEY(run,first));
CREATE TABLE IF NOT EXISTS idempotency (owner TEXT NOT NULL,key TEXT NOT NULL,run TEXT NOT NULL,PRIMARY KEY(owner,key));`);
db.exec(
  "CREATE INDEX IF NOT EXISTS records_history ON records(owner,kind,created DESC,id DESC)",
);
export function insert(
  kind: string,
  id: string,
  owner: string,
  data: Record<string, unknown>,
) {
  const now = Date.now();
  db.prepare(
    "INSERT INTO records(id,kind,owner,status,data,created,updated) VALUES(?,?,?,?,?,?,?)",
  ).run(id, kind, owner, String(data.status), JSON.stringify(data), now, now);
}
export function get<T>(id: string, owner?: string): T | undefined {
  const row = db
    .prepare("SELECT data,owner FROM records WHERE id=?")
    .get(id) as { data: string; owner: string } | undefined;
  return row && (!owner || row.owner === owner)
    ? JSON.parse(row.data)
    : undefined;
}
export function update(
  id: string,
  data: Record<string, unknown>,
  lease?: string,
) {
  return (
    db
      .prepare(
        `UPDATE records SET status=?,data=?,updated=? WHERE id=?${lease ? " AND lease=?" : ""}`,
      )
      .run(
        String(data.status),
        JSON.stringify(data),
        Date.now(),
        id,
        ...(lease ? [lease] : []),
      ).changes > 0
  );
}
export function cancelled(id: string) {
  return !!(
    db.prepare("SELECT cancel FROM records WHERE id=?").get(id) as
      | { cancel: number }
      | undefined
  )?.cancel;
}
export function requestCancel(id: string) {
  db.prepare("UPDATE records SET cancel=1 WHERE id=?").run(id);
}
export function claim(
  lease: string,
): { id: string; kind: string; owner: string; data: string } | undefined {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        "SELECT id,kind,owner,data FROM records WHERE status='queued' ORDER BY created LIMIT 1",
      )
      .get() as
      | { id: string; kind: string; owner: string; data: string }
      | undefined;
    if (row)
      db.prepare(
        "UPDATE records SET status='preparing',lease=?,updated=? WHERE id=?",
      ).run(lease, Date.now(), row.id);
    db.exec("COMMIT");
    return row;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function recover() {
  const rows = db
    .prepare(
      "SELECT id,data FROM records WHERE status NOT IN ('queued','completed','ready','invalid','failed','runtime_error','compile_error','internal_error','interrupted','cancelled','timed_out','resource_limited','trace_limited','unsupported_execution')",
    )
    .all() as { id: string; data: string }[];
  for (const row of rows) {
    const value = JSON.parse(row.data);
    value.status = "interrupted";
    value.traceCompleteness = "partial";
    value.error = {
      type: "RunnerRestart",
      message: "The execution service restarted. Start a new run.",
    };
    update(row.id, value);
  }
}
export function saveChunk(run: string, events: TraceEvent[]) {
  if (!events.length) return;
  const dir = path.join(dataRoot, "traces", run);
  mkdirSync(dir, { recursive: true });
  const raw = Buffer.from(JSON.stringify(events));
  const filename = `${events[0].seq}.json.gz`;
  const final = path.join(dir, filename);
  writeFileSync(final + ".tmp", gzipSync(raw));
  renameSync(final + ".tmp", final);
  db.prepare(
    "INSERT INTO chunks(run,first,last,path,checksum) VALUES(?,?,?,?,?)",
  ).run(
    run,
    events[0].seq,
    events.at(-1)!.seq,
    filename,
    createHash("sha256").update(raw).digest("hex"),
  );
}
export function readTrace(run: string, after = 0, limit = 500): TraceEvent[] {
  const chunks = db
    .prepare(
      "SELECT path,checksum FROM chunks WHERE run=? AND last>? ORDER BY first",
    )
    .all(run, after) as { path: string; checksum: string }[];
  const result: TraceEvent[] = [];
  for (const c of chunks) {
    const raw = gunzipSync(
      readFileSync(path.join(dataRoot, "traces", run, c.path)),
    );
    if (createHash("sha256").update(raw).digest("hex") !== c.checksum)
      throw new Error("Trace checksum mismatch");
    for (const event of JSON.parse(raw.toString()))
      if (event.seq > after) {
        result.push(event);
        if (result.length >= limit) return result;
      }
  }
  return result;
}
export function deleteRecord(id: string) {
  db.prepare("DELETE FROM chunks WHERE run=?").run(id);
  db.prepare("DELETE FROM idempotency WHERE run=?").run(id);
  db.prepare("DELETE FROM records WHERE id=?").run(id);
  for (const folder of ["traces", "jobs"]) {
    const dir = path.join(dataRoot, folder, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}
