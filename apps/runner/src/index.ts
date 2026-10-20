import http from "node:http";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  analysisRequest,
  runRequest,
  adapterEvent,
  validateInput,
  terminal,
  summarizeExecution,
  type Analysis,
  type Run,
  type TraceEvent,
} from "../../../packages/contracts/src/index";
import {
  changes,
  applyEvent,
  type ReplayState,
} from "../../../packages/trace-model/src/index";
import {
  javaAdapter,
  javaManifest,
  backend,
} from "../../../packages/language-java/src/adapter";
import {
  db,
  dataRoot,
  insert,
  get,
  update,
  claim,
  cancelled,
  requestCancel,
  recover,
  saveChunk,
  readTrace,
  deleteRecord,
} from "./storage";
import { ProcessFailure } from "./process";
import { cppAdapter, cppManifest } from "../../../packages/language-cpp/src/adapter";

const key = process.env.RUNNER_SECRET;
if (!key)
  throw new Error(
    "RUNNER_SECRET is required. Start through npm run dev or npm run dev:local.",
  );
if (backend === "local" && process.env.CODEVIZ_ALLOW_LOCAL !== "1")
  throw new Error("Local execution requires explicit CODEVIZ_ALLOW_LOCAL=1.");
recover();
const listeners = new Map<string, Set<http.ServerResponse>>();
const controllers = new Map<string, AbortController>();
const adapters = new Map([["java", javaAdapter], ["cpp", cppAdapter]]);
function notify(id: string) {
  for (const res of listeners.get(id) || []) {
    if (!res.destroyed)
      res.write(`event: progress\ndata: ${JSON.stringify({ runId: id })}\n\n`);
  }
}
function json(res: http.ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function body(req: http.IncomingMessage) {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (Buffer.byteLength(raw) > 140000)
      throw Object.assign(new Error("Request is too large"), { status: 413 });
  }
  return JSON.parse(raw || "{}");
}
function fail(message: string, status = 422): never {
  throw Object.assign(new Error(message), { status });
}
const active = new Set<string>();
let busy = false;
async function work() {
  if (busy) return;
  const lease = randomUUID();
  const job = claim(lease);
  if (!job) return;
  busy = true;
  const signal = new AbortController();
  controllers.set(job.id, signal);
  active.add(job.id);
  const dir = path.join(dataRoot, "jobs", job.id);
  let record = JSON.parse(job.data);
  const adapter = adapters.get(record.languageId || "java")!;
  const setStatus = (status: string) => {
    record = { ...record, status, updatedAt: Date.now() };
    update(job.id, record, lease);
    notify(job.id);
  };
  try {
    if (cancelled(job.id)) throw new ProcessFailure("Cancelled", "cancelled");
    if (job.kind === "analysis") {
      setStatus("analyzing");
      const result = await adapter.analyze(dir, record.source, signal.signal);
      record = {
        ...record,
        ...result,
        status: result.valid ? "ready" : "invalid",
      };
      update(job.id, record, lease);
    } else {
      const run = record as Run;
      setStatus("compiling");
      const result = await adapter.analyze(dir, run.source, signal.signal);
      if (!result.valid) {
        record.error = {
          type: "CompileError",
          message:
            result.diagnostics?.map((d) => d.message).join("\n") ||
            "Compilation failed",
        };
        setStatus("compile_error");
        return;
      }
      let sequence = 0,
        bytes = 0,
        chunk: TraceEvent[] = [],
        state: ReplayState = {};
      let outcome: Record<string, unknown> | undefined;
      let observations = 0;
      const flush = () => {
        if (!chunk.length) return;
        saveChunk(job.id, chunk);
        chunk = [];
        record.eventCount = sequence;
        update(job.id, record, lease);
        notify(job.id);
      };
      const commit = (raw: Partial<TraceEvent>) => {
        const event = {
          ...raw,
          schemaVersion: 1,
          runId: job.id,
          attemptId: run.attemptId,
          seq: ++sequence,
        } as TraceEvent;
        const size = Buffer.byteLength(JSON.stringify(event));
        if (
          size > 256 * 1024 ||
          (bytes += size) > 8 * 1024 * 1024 ||
          sequence > 10000
        )
          throw new ProcessFailure("Trace size limit reached", "trace_limited");
        if (
          chunk.length >= 250 ||
          Buffer.byteLength(JSON.stringify(chunk)) + size > 256 * 1024
        )
          flush();
        chunk.push(event);
        state = applyEvent(state, event);
      };
      record.runtimeVersion = result.runtimeVersion;
      record.conditions = result.conditions;
      setStatus("running");
      commit({ kind: "checkpoint", state: {}, stateThroughSeq: 0 });
      const timer = setInterval(flush, 250);
      try {
        await adapter.execute(
          dir,
          { ...run, ...result } as unknown as Analysis,
          run.entry,
          record.args,
          record.stdin,
          signal.signal,
          (line) => {
            const raw = adapterEvent.parse(
              JSON.parse(line),
            ) as unknown as Partial<TraceEvent>;
            if (raw.kind === "engine-error")
              throw new ProcessFailure(
                raw.message || "Debugger failure",
                "internal_error",
              );
            if (raw.kind === "limit")
              throw new ProcessFailure(
                raw.message || "Trace limit",
                raw.message?.includes("CONCURRENCY")
                  ? "unsupported_execution"
                  : raw.message?.includes("seconds")
                    ? "timed_out"
                    : "trace_limited",
              );
            if (raw.kind === "result") {
              outcome = raw;
              return;
            }
            if (raw.kind === "observation" && raw.frameId && raw.variables) {
              Object.assign(
                raw,
                changes(state[raw.frameId] || [], raw.variables),
              );
              observations++;
            }
            if (raw.kind === "output") {
              const channel = raw.channel === "stderr" ? "stderr" : "stdout";
              record[channel] = (record[channel] || "") + (raw.text || "");
            }
            commit(raw);
            if (
              observations > 0 &&
              observations % 100 === 0 &&
              raw.kind === "observation"
            )
              commit({
                kind: "checkpoint",
                state: structuredClone(state),
                stateThroughSeq: sequence,
              });
          },
        );
        if (!outcome)
          throw new ProcessFailure(
            "The runtime did not report a completed invocation",
            "interrupted",
          );
        record.outcome = outcome.outcome;
        record.result = outcome.value;
        record.error = outcome.error;
        record.traceCompleteness = "complete";
        setStatus(
          outcome.outcome === "returned" ? "completed" : "runtime_error",
        );
      } finally {
        clearInterval(timer);
        flush();
      }
    }
  } catch (error) {
    const e = error as Error;
    record.error = job.kind === "analysis" ? e.message : { type: e.name, message: e.message };
    record.traceCompleteness = "partial";
    setStatus(
      job.kind === "analysis"
        ? signal.signal.aborted
          ? "cancelled"
          : "failed"
        : e instanceof ProcessFailure
          ? e.code
          : signal.signal.aborted
            ? "cancelled"
            : "internal_error",
    );
  } finally {
    controllers.delete(job.id);
    active.delete(job.id);
    busy = false;
    notify(job.id);
    if (job.kind === "run")
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    setTimeout(() => void work(), 10);
  }
}
const server = http.createServer(async (req, res) => {
  try {
    const supplied = Buffer.from(String(req.headers["x-runner-key"] || "")),
      expected = Buffer.from(key);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return json(res, 401, { error: "Unauthorized" });
    const owner = String(req.headers["x-owner"] || "");
    if (!/^[\w-]{16,80}$/.test(owner))
      return json(res, 401, { error: "Session required" });
    const url = new URL(req.url || "/", "http://localhost");
    const pieces = url.pathname.split("/").filter(Boolean);
    const id = pieces[1];
    if (req.method === "GET" && pieces[0] === "languages")
      return json(res, 200, {
        languages: [javaManifest, cppManifest],
        backend,
        runtime:
          backend === "local"
            ? "Local runtimes · JDK / Clang C++20"
            : "Isolated Docker / Java 21 / C++20",
        limits: { events: 10000, executionSeconds: 15 },
      });
    if (req.method === "GET" && pieces.length === 1 && pieces[0] === "runs") {
      const limit = Number(url.searchParams.get("limit") || 30);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        fail("Choose a history limit from 1 to 50", 400);
      const language = url.searchParams.get("languageId") || "java";
      if (!adapters.has(language)) fail("Unknown language", 400);
      let before: { created: number; id: string } | undefined;
      const cursor = url.searchParams.get("cursor");
      if (cursor) {
        try {
          if (cursor.length > 250) throw new Error();
          before = JSON.parse(Buffer.from(cursor, "base64url").toString());
          if (
            !before ||
            !Number.isSafeInteger(before.created) ||
            !/^[-\w]{36}$/.test(before.id)
          )
            throw new Error();
        } catch {
          fail("Invalid history cursor", 400);
        }
      }
      const rows = db
        .prepare(
          `SELECT id,created,data FROM records
        WHERE owner=? AND kind='run' AND COALESCE(json_extract(data,'$.languageId'),'java')=?
        ${before ? "AND (created < ? OR (created = ? AND id < ?))" : ""}
        ORDER BY created DESC,id DESC LIMIT ?`,
        )
        .all(
          owner,
          language,
          ...(before ? [before.created, before.created, before.id] : []),
          limit + 1,
        ) as { id: string; created: number; data: string }[];
      const page = rows.slice(0, limit),
        last = page.at(-1);
      return json(res, 200, {
        executions: page.map((row) =>
          summarizeExecution(JSON.parse(row.data) as Run),
        ),
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(
                JSON.stringify({ created: last.created, id: last.id }),
              ).toString("base64url")
            : null,
      });
    }
    if (
      req.method === "POST" &&
      pieces.length === 1 &&
      pieces[0] === "analyses"
    ) {
      const input = analysisRequest.parse(await body(req));
      if (
        Buffer.byteLength(input.source) > 65536 ||
        input.source.split("\n").length > 2000
      )
        fail("Source exceeds 64 KiB or 2,000 lines", 413);
      const queued = db
        .prepare(
          "SELECT count(*) AS n FROM records WHERE status IN ('queued','preparing','analyzing','compiling','running')",
        )
        .get() as { n: number };
      if (queued.n >= 20) fail("Execution queue is full", 429);
      const source = input.source.replace(/\r\n/g, "\n");
      const analysis = {
        id: randomUUID(),
        languageId: input.languageId,
        source,
        sourceHash: createHash("sha256").update(source).digest("hex"),
        status: "queued",
        entryPoints: [],
        diagnostics: [],
        warnings: [],
        classNames: [],
      };
      insert("analysis", analysis.id, owner, analysis);
      json(res, 202, analysis);
      void work();
      return;
    }
    if (req.method === "POST" && pieces.length === 1 && pieces[0] === "runs") {
      const input = runRequest.parse(await body(req));
      const existing = db
        .prepare("SELECT run FROM idempotency WHERE owner=? AND key=?")
        .get(owner, input.idempotencyKey) as { run: string } | undefined;
      if (existing) return json(res, 202, get(existing.run, owner));
      const analysis = get<Analysis>(input.analysisId, owner);
      if (!analysis) fail("Analysis not found", 404);
      if (analysis.status !== "ready")
        fail("Analyze valid code before running");
      if (analysis.sourceHash !== input.sourceHash)
        fail("Source changed; analyze it again", 409);
      const entry = analysis.entryPoints.find(
        (e) => e.id === input.entryPointId,
      );
      if (!entry?.supported) fail("Choose a supported entry point");
      if (input.args.length !== entry.parameters.length)
        fail("Argument count does not match the method");
      const args = input.args.map((v, i) =>
        validateInput(v, entry.parameters[i].type),
      );
      if (
        Buffer.byteLength(JSON.stringify(args)) +
          Buffer.byteLength(input.stdin) >
        65536
      )
        fail("Inputs exceed 64 KiB", 413);
      const outstanding = db
        .prepare(
          "SELECT count(*) AS n FROM records WHERE owner=? AND kind='run' AND status IN ('queued','preparing','compiling','running')",
        )
        .get(owner) as { n: number };
      if (outstanding.n > 0) fail("Stop or finish the current run first", 429);
      const run = {
        id: randomUUID(),
        languageId: analysis.languageId || "java",
        analysisId: analysis.id,
        sourceHash: analysis.sourceHash,
        source: analysis.source,
        entry,
        conditions: analysis.conditions,
        status: "queued",
        attemptId: randomUUID(),
        traceCompleteness: "none",
        eventCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        backend,
        args,
        stdin: input.stdin,
        stdout: "",
        stderr: "",
      };
      db.exec("BEGIN IMMEDIATE");
      try {
        insert("run", run.id, owner, run);
        db.prepare("INSERT INTO idempotency(owner,key,run) VALUES(?,?,?)").run(
          owner,
          input.idempotencyKey,
          run.id,
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      json(res, 202, run);
      void work();
      return;
    }
    if (!id || !/^[-\w]{36}$/.test(id))
      return json(res, 404, { error: "Not found" });
    const record = get<Run | Analysis>(id, owner);
    if (!record) return json(res, 404, { error: "Not found" });
    if (req.method === "GET" && pieces.length === 2)
      return json(res, 200, record);
    if (req.method === "DELETE" && pieces.length === 2) {
      if (active.has(id)) {
        requestCancel(id);
        controllers.get(id)?.abort();
        return json(res, 202, { status: "cancel_requested" });
      }
      deleteRecord(id);
      return json(res, 200, { deleted: true });
    }
    if (req.method === "POST" && pieces[2] === "cancel") {
      requestCancel(id);
      controllers.get(id)?.abort();
      if (record.status === "queued") {
        record.status = "cancelled";
        update(id, record as unknown as Record<string, unknown>);
      }
      return json(res, 200, {
        status: terminal(record.status) ? record.status : "cancel_requested",
      });
    }
    if (req.method === "GET" && pieces[2] === "trace") {
      if (pieces[3] === "checkpoint") {
        const at = Math.max(
          0,
          Number(url.searchParams.get("atOrBeforeSeq")) || 0,
        );
        const all = readTrace(id, 0, 10000);
        const checkpoint =
          all.filter((e) => e.kind === "checkpoint" && e.seq <= at).at(-1) ||
          all.find((e) => e.kind === "checkpoint");
        return json(
          res,
          200,
          checkpoint
            ? {
                attemptId: checkpoint.attemptId,
                checkpointSeq: checkpoint.seq,
                stateThroughSeq: checkpoint.stateThroughSeq,
                state: checkpoint.state,
                nextAfterSeq: checkpoint.seq,
              }
            : { state: {}, nextAfterSeq: 0 },
        );
      }
      const after = Math.max(0, Number(url.searchParams.get("afterSeq")) || 0),
        limit = Math.min(
          1000,
          Math.max(1, Number(url.searchParams.get("limit")) || 500),
        );
      const events = readTrace(id, after, limit);
      return json(res, 200, {
        events,
        nextAfterSeq: events.at(-1)?.seq || after,
        terminal: terminal(record.status),
      });
    }
    if (req.method === "GET" && pieces[2] === "export")
      return json(res, 200, {
        schemaVersion: 1,
        run: record,
        events: readTrace(id, 0, 10000),
      });
    if (req.method === "GET" && pieces[2] === "events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`event: progress\ndata: ${JSON.stringify({ runId: id })}\n\n`);
      const set = listeners.get(id) || new Set();
      set.add(res);
      listeners.set(id, set);
      const heartbeat = setInterval(() => {
        if (res.writableLength > 65536) {
          res.end();
          return;
        }
        res.write(": heartbeat\n\n");
      }, 15000);
      req.on("close", () => {
        clearInterval(heartbeat);
        set.delete(res);
      });
      return;
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    const e = error as Error & { status?: number };
    json(res, e.status || (e.name === "ZodError" ? 422 : 500), {
      error: e.message,
    });
  }
});
server.listen(Number(process.env.RUNNER_PORT ?? 4317), "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 4317;
  console.log(
    process.env.CODEVIZ_DESKTOP_MODE === "1"
      ? `CODEVIZ_RUNNER_READY ${port}`
      : `Execution service: http://127.0.0.1:${port} (${backend})`,
  );
});
setInterval(() => void work(), 500).unref();
setInterval(() => {
  const expired = db
    .prepare("SELECT id FROM records WHERE created<?")
    .all(Date.now() - 86400000) as { id: string }[];
  for (const row of expired) if (!active.has(row.id)) deleteRecord(row.id);
}, 60000).unref();
for (const event of ["SIGINT", "SIGTERM"] as const)
  process.on(event, () => {
    for (const controller of controllers.values()) controller.abort();
    server.close();
    setTimeout(() => process.exit(), 2000).unref();
  });
