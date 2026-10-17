import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EXAMPLE_SOURCE } from "../packages/contracts/src/example";
const job = path.resolve(".data/probe");
mkdirSync(job, { recursive: true });
writeFileSync(path.join(job, "Source.java"), EXAMPLE_SOURCE);
const classes = path.resolve(".data/java");
const analysisProcess = spawnSync(
  "java",
  ["--add-modules", "jdk.compiler", "-cp", classes, "codeviz.Analyzer", job],
  { encoding: "utf8", timeout: 15000 },
);
if (analysisProcess.status !== 0)
  throw new Error(analysisProcess.stderr || analysisProcess.stdout);
const analysis = JSON.parse(analysisProcess.stdout);
console.log(
  "Detected:",
  analysis.entryPoints.map((x: { displayName: string }) => x.displayName),
);
writeFileSync(
  path.join(job, "invocation.json"),
  JSON.stringify({
    entry: analysis.entryPoints[0],
    classNames: analysis.classNames,
    args: ["hello", "ll"],
    stdin: "",
  }),
);
const trace = spawnSync(
  "java",
  ["--add-modules", "jdk.jdi", "-cp", classes, "codeviz.Tracer", job],
  { encoding: "utf8", timeout: 25000, maxBuffer: 10 * 1024 * 1024 },
);
writeFileSync(path.join(job, "trace.ndjson"), trace.stdout || "");
console.log(trace.stderr);
const events = (trace.stdout || "")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((x) => JSON.parse(x));
console.log(
  JSON.stringify(
    {
      status: trace.status,
      events: events.length,
      result: events.find((x) => x.kind === "result"),
      errors: events.filter((x) => ["engine-error", "limit"].includes(x.kind)),
      observations: events.filter((x) => x.kind === "observation").slice(-4),
    },
    null,
    2,
  ),
);
if (!events.some((x) => x.kind === "result" && x.value?.text === "2"))
  process.exitCode = 1;
