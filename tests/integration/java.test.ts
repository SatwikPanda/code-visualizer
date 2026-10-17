import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { EXAMPLE_SOURCE } from "../../packages/contracts/src/example";
import {
  terminal,
  type Analysis,
  type Run,
  type TraceEvent,
  type ExecutionPage,
} from "../../packages/contracts/src/index";
const port = 5417,
  secret = randomUUID(),
  owner = randomUUID(),
  base = `http://127.0.0.1:${port}`;
let child: ChildProcess;
async function api<T>(
  route: string,
  body?: unknown,
  identity = owner,
): Promise<T> {
  const r = await fetch(base + "/" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-runner-key": secret,
      "x-owner": identity,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(JSON.stringify(data)), { status: r.status });
  return data as T;
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function analyze(source: string) {
  let a = await api<Analysis>("analyses", { source, languageId: "java" });
  for (let n = 0; !["ready", "invalid", "failed"].includes(a.status); n++) {
    assert.ok(n < 160, "analysis timeout");
    await delay(100);
    a = await api(`analyses/${a.id}`);
  }
  return a;
}
async function run(a: Analysis, args: unknown[], entryIndex = 0, stdin = "") {
  let r = await api<Run>("runs", {
    analysisId: a.id,
    sourceHash: a.sourceHash,
    entryPointId: a.entryPoints[entryIndex].id,
    args,
    stdin,
    idempotencyKey: randomUUID(),
  });
  for (let n = 0; !terminal(r.status); n++) {
    assert.ok(n < 250, "run timeout");
    await delay(100);
    r = await api(`runs/${r.id}`);
  }
  const trace = await api<{ events: TraceEvent[] }>(
    `runs/${r.id}/trace?limit=1000`,
  );
  return { run: r, events: trace.events };
}
before(async () => {
  child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/runner/src/index.ts"],
    {
      env: {
        ...process.env,
        RUNNER_PORT: String(port),
        RUNNER_SECRET: secret,
        RUNNER_DATA_DIR: path.resolve(".data", `integration-${randomUUID()}`),
        CODEVIZ_BACKEND: "local",
        CODEVIZ_ALLOW_LOCAL: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let logs = "";
  child.stderr?.on("data", (b) => (logs += b));
  for (let n = 0; n < 100; n++) {
    try {
      await api("languages");
      return;
    } catch {}
    await delay(100);
  }
  throw new Error("Runner did not start: " + logs);
});
after(() => {
  child?.kill();
});
test("supplied example: detect inputs, real changing variables, final 2, export and ownership", async () => {
  const a = await analyze(EXAMPLE_SOURCE);
  assert.equal(a.status, "ready");
  assert.equal(a.warnings.length, 0);
  assert.deepEqual(
    a.entryPoints[0].parameters.map((p) => p.name),
    ["haystack", "needle"],
  );
  const { run: r, events } = await run(a, ["hello", "ll"]);
  assert.equal(r.status, "completed", JSON.stringify(r.error));
  assert.equal(r.result?.text, "2");
  assert.equal(r.stdout, "");
  const matchCondition = r.conditions?.find((c) =>
    c.expression.includes("j == needleLength - 1"),
  );
  assert.ok(matchCondition?.recordable);
  const matchResults = events
    .filter((e) => e.condition?.id === matchCondition.id)
    .map((e) => e.condition!.value);
  assert.ok(matchResults.includes(false));
  assert.equal(matchResults.at(-1), true);
  const rows = events.filter((e) => e.kind === "observation" && !e.setup);
  assert.ok(rows.length > 20);
  assert.ok(
    rows.some((e) =>
      e.variables?.some((v) => v.name === "occurence" && v.value.text === "2"),
    ),
  );
  assert.ok(
    rows.some((e) =>
      e.variables?.some((v) => v.name === "j" && v.value.text === "1"),
    ),
  );
  assert.ok(
    rows.some((e) =>
      e.changed?.some(
        (id) => e.variables?.find((v) => v.id === id)?.name === "occurence",
      ),
    ),
  );
  const exported = await api<{ schemaVersion: number; events: TraceEvent[] }>(
    `runs/${r.id}/export`,
  );
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.events.length, events.length);
  const checkpoint = await api<{ state: unknown; nextAfterSeq: number }>(
    `runs/${r.id}/trace/checkpoint?atOrBeforeSeq=20`,
  );
  assert.ok(checkpoint.state);
  assert.ok(checkpoint.nextAfterSeq >= 1);
  await assert.rejects(() => api(`runs/${r.id}`, undefined, randomUUID()), {
    status: 404,
  });
});
test("conditions are recorded once while preserving side effects and short-circuit behavior", async () => {
  const a = await analyze(`class Solution {
    private boolean explode() { throw new IllegalStateException("Short circuit was broken"); }
    public int check() {
        int i = 0;
        if (++i == 1 || explode()) {
            if (++i < 0 && explode()) return -100;
        }
        return i;
    }
 }`);
  assert.equal(a.status, "ready");
  assert.ok(a.conditions?.every((c) => c.recordable));
  const result = await run(a, []);
  assert.equal(result.run.result?.text, "2");
  assert.equal(result.run.status, "completed");
  assert.deepEqual(
    result.events.filter((e) => e.condition).map((e) => e.condition!.value),
    [true, false],
  );
  const conditionEvents = result.events.filter((e) => e.condition);
  assert.deepEqual(
    conditionEvents.map((e) =>
      e.condition!.operands?.map((operand) => operand.value.text),
    ),
    [["1"], ["2"]],
  );
  assert.ok(
    !result.events.some(
      (e) => e.kind === "frame-enter" && e.method === "explode",
    ),
  );
});
test("operands preserve earlier values of repeated side effects and clear skipped values on every evaluation", async () => {
  const a = await analyze(`class Solution {
    public int check() {
        int i = 0;
        if (i++ == 0 && i++ == 1) { }
        if (i++ < 0 && i++ < 10) { }
        return i;
    }
 }`);
  assert.equal(a.status, "ready");
  assert.ok(a.conditions?.every((c) => c.recordable));
  const result = await run(a, []);
  assert.equal(result.run.result?.text, "3");
  const conditions = result.events.filter((e) => e.condition);
  assert.deepEqual(
    conditions.map((e) =>
      e.condition!.operands?.map((operand) => operand.value.text),
    ),
    [["0", "1"], ["2"]],
  );
  assert.equal(
    conditions[0].variables?.find((binding) => binding.name === "i")?.value
      .text,
    "2",
  );
  assert.deepEqual(
    conditions.map((e) => e.condition!.value),
    [true, false],
  );
});
test("loop and nested ternary conditions record their actual evaluation order", async () => {
  const a = await analyze(`class Solution {
    public int check(int n) {
        int x = 0;
        for (int i = 0; i < n; i++) {
            while (x < 1) x++;
            do { x++; } while (x < 3);
        }
        return (x > 2 ? x % 2 == 0 : false) ? x : -x;
    }
 }`);
  assert.equal(a.status, "ready");
  assert.ok(a.conditions?.every((c) => c.recordable));
  const result = await run(a, ["1"]);
  assert.equal(result.run.status, "completed");
  assert.equal(result.run.result?.text, "-3");
  assert.deepEqual(
    result.events.filter((e) => e.condition).map((e) => e.condition!.value),
    [true, true, false, true, false, false, true, false],
  );
});
test("condition probes preserve pattern scopes and fall back when constant flow typing requires it", async () => {
  const pattern = await analyze(`class Solution {
    public int size(String input) {
        if ((Object) input instanceof String s && s.length() > 0) return s.length();
        return 0;
    }
 }`);
  assert.equal(pattern.status, "ready");
  assert.equal(pattern.conditions?.[0].recordable, false);
  assert.equal((await run(pattern, ["abc"])).run.result?.text, "3");
  const constant = await analyze(`class Solution {
    public int value() {
        int x;
        if (true) x = 7;
        return x;
    }
 }`);
  assert.equal(constant.status, "ready");
  assert.equal(constant.conditions?.[0].recordable, false);
  assert.equal((await run(constant, [])).run.result?.text, "7");
});
test("original algorithm bugs and library-thrown exception are preserved", async () => {
  const a = await analyze(EXAMPLE_SOURCE);
  for (const [args, expected] of [
    [["a", "a"], "-1"],
    [["aaab", "aab"], "0"],
    [["helxo", "ll"], "2"],
  ] as const) {
    const r = await run(a, [...args]);
    assert.equal(r.run.result?.text, expected);
  }
  const failure = await run(a, ["a", ""]);
  assert.equal(failure.run.status, "runtime_error");
  assert.equal(
    failure.run.error?.type,
    "java.lang.StringIndexOutOfBoundsException",
  );
  assert.ok(
    failure.events.some((e) => e.kind === "exception" && e.line === 12),
  );
});
test("64-bit values, arrays, packages and exact overload selection", async () => {
  const a = await analyze(
    "package demo; public class Demo { public static long add(long x, long[] a) {\n a[0] = x;\n return a[0];\n}\n public static int add(int x) { return x + 1; } }",
  );
  assert.equal(a.status, "ready");
  const r = await run(a, ["9223372036854775807", ["0"]]);
  assert.equal(r.run.result?.text, "9223372036854775807");
  assert.ok(
    r.events.some((e) =>
      e.variables?.some(
        (v) =>
          v.name === "a" && v.value.items?.[0]?.text === "9223372036854775807",
      ),
    ),
  );
  const second = await run(a, ["4"], 1);
  assert.equal(second.run.result?.text, "5");
});
test("recursion and construction calling the selected method retain the real root", async () => {
  const a = await analyze(
    "class Solution {\n Solution() { fact(2); }\n public int fact(int n) {\n if (n <= 1) return 1;\n int sub = fact(n-1);\n return n*sub;\n }\n}",
  );
  const r = await run(a, ["4"]);
  assert.equal(r.run.result?.text, "24");
  assert.equal(
    r.events.filter((e) => e.kind === "frame-return" && e.root).length,
    1,
  );
  assert.ok(
    r.events.filter((e) => e.kind === "frame-enter" && e.method === "fact")
      .length >= 6,
  );
});
test("main mode sends stdin once, closes at EOF and keeps console separate", async () => {
  const a = await analyze(
    'import java.util.Scanner; class Main {\n public static void main(String[] args) {\n Scanner s = new Scanner(System.in);\n int n = s.nextInt();\n System.out.println(args[0] + n);\n System.err.println("error stream");\n }\n}',
  );
  assert.equal(a.entryPoints[0].mode, "program");
  const r = await run(a, [["answer="]], 0, "42\n");
  assert.equal(r.run.status, "completed", JSON.stringify(r.run.error));
  assert.equal(r.run.result?.kind, "void");
  assert.match(r.run.stdout || "", /answer=42/);
  assert.match(r.run.stderr || "", /error stream/);
});
test("syntax diagnostics, unsupported construction and compact-loop warnings", async () => {
  const invalid = await analyze("class Broken { public int x( { return; }");
  assert.notEqual(invalid.status, "ready");
  assert.ok(invalid.diagnostics.length || invalid.error);
  const constructor = await analyze(
    "class Solution { Solution(int x) {} public int f(int y) { return y; } }",
  );
  assert.equal(constructor.entryPoints[0].supported, false);
  const compact = await analyze(
    "class Solution { public int f(int n) { for(int i=0;i<n;i++) n--; return n; } }",
  );
  assert.ok(compact.warnings.length);
});
test("cancellation terminates a compact infinite loop and retains partial state", async () => {
  const a = await analyze(
    "class Solution { public int f() { while(true) {} } }",
  );
  let r = await api<Run>("runs", {
    analysisId: a.id,
    sourceHash: a.sourceHash,
    entryPointId: a.entryPoints[0].id,
    args: [],
    stdin: "",
    idempotencyKey: randomUUID(),
  });
  for (let n = 0; n < 100 && r.status !== "running"; n++) {
    await delay(100);
    r = await api(`runs/${r.id}`);
  }
  assert.equal(r.status, "running");
  await api(`runs/${r.id}/cancel`, {});
  for (let n = 0; n < 100 && !terminal(r.status); n++) {
    await delay(100);
    r = await api(`runs/${r.id}`);
  }
  assert.equal(r.status, "cancelled");
  assert.equal(r.traceCompleteness, "partial");
});
test("execution history is durable, paginated, newest first, and scoped to the session owner", async () => {
  const a = await analyze(
    "class Solution { public int answer(int value) { return value; } }",
  );
  const first = (await run(a, ["7"])).run;
  const second = (await run(a, ["9"])).run;
  const page = await api<ExecutionPage>("runs?languageId=java&limit=1");
  assert.equal(page.executions.length, 1);
  assert.equal(page.executions[0].id, second.id);
  assert.equal(page.executions[0].arguments, "9");
  assert.equal(page.executions[0].result, "9");
  assert.equal(page.executions[0].status, "completed");
  assert.equal(page.executions[0].languageId, "java");
  assert.ok(!("source" in page.executions[0]));
  assert.ok(page.nextCursor);
  const older = await api<ExecutionPage>(
    `runs?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`,
  );
  assert.equal(older.executions[0].id, first.id);
  assert.notEqual(older.executions[0].id, page.executions[0].id);
  const foreign = await api<ExecutionPage>("runs", undefined, randomUUID());
  assert.deepEqual(foreign.executions, []);
  assert.equal(foreign.nextCursor, null);
  const reopened = await api<Run>(`runs/${first.id}`);
  assert.deepEqual(reopened.args, ["7"]);
  await assert.rejects(() => api("runs?cursor=broken"), { status: 400 });
  await assert.rejects(() => api("runs?limit=500"), { status: 400 });
});
