import { z } from "zod";

export type InputType = {
  kind:
    | "string"
    | "integer"
    | "float"
    | "boolean"
    | "character"
    | "array"
    | "unsupported";
  languageType: string;
  nullable?: boolean;
  min?: string;
  max?: string;
  element?: InputType;
};
export interface Parameter {
  id: string;
  name: string;
  type: InputType;
}
export interface EntryPoint {
  id: string;
  className: string;
  methodName: string;
  descriptor: string;
  displayName: string;
  mode: "method" | "program";
  isStatic: boolean;
  constructible: boolean;
  parameters: Parameter[];
  parameterTypes: string[];
  returnType: string;
  supported: boolean;
  reason?: string;
  line: number;
}
export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  line: number;
  column?: number;
}
export interface ConditionOperand {
  id: string;
  expression: string;
  start: number;
  end: number;
}
export interface ConditionResult {
  id: string;
  value: boolean;
  operands?: { id: string; value: TraceValue }[];
}
export interface ConditionDefinition {
  id: string;
  kind: "if" | "while" | "do-while" | "for" | "ternary";
  expression: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  recordable: boolean;
  reason?: string | null;
  operands?: ConditionOperand[];
}
export interface ConditionMarker extends ConditionDefinition {
  value?: boolean;
  capturedOperands?: ConditionResult["operands"];
}
export interface Analysis {
  id: string;
  sourceHash: string;
  source: string;
  status: string;
  valid?: boolean;
  entryPoints: EntryPoint[];
  diagnostics: Diagnostic[];
  warnings: { line: number; message: string }[];
  classNames: string[];
  conditions?: ConditionDefinition[];
  runtimeVersion?: string;
  fileName?: string;
  error?: string;
}
export type TraceValue = {
  kind:
    | "integer"
    | "float"
    | "boolean"
    | "char"
    | "string"
    | "null"
    | "void"
    | "array"
    | "object"
    | "reference"
    | "unavailable";
  type?: string;
  text?: string;
  value?: string | boolean;
  refId?: string;
  items?: TraceValue[];
  fields?: Record<string, TraceValue>;
  length?: number;
  truncated?: boolean;
  reason?: string;
};
export interface Binding {
  id: string;
  name: string;
  type: string;
  value: TraceValue;
}
export interface TraceEvent {
  schemaVersion: 1;
  runId: string;
  attemptId: string;
  seq: number;
  kind: string;
  elapsedMs?: number;
  frameId?: string;
  parentFrameId?: string;
  method?: string;
  className?: string;
  line?: number;
  phase?: string;
  condition?: ConditionResult;
  setup?: boolean;
  variables?: Binding[];
  changed?: string[];
  removed?: string[];
  value?: TraceValue;
  root?: boolean;
  channel?: string;
  text?: string;
  message?: string;
  outcome?: string;
  error?: { type: string; message: string };
  state?: Record<string, Binding[]>;
  stateThroughSeq?: number;
}
export interface Run {
  id: string;
  analysisId: string;
  sourceHash: string;
  source: string;
  entry: EntryPoint;
  status: string;
  attemptId: string;
  outcome?: string;
  result?: TraceValue;
  error?: { type: string; message: string };
  traceCompleteness: "none" | "partial" | "complete";
  eventCount: number;
  createdAt: number;
  updatedAt: number;
  backend: string;
  conditions?: ConditionDefinition[];
  runtimeVersion?: string;
  stdout?: string;
  stderr?: string;
  args?: unknown[];
  stdin?: string;
  languageId?: string;
}
export interface ExecutionSummary {
  id: string;
  languageId: string;
  methodName: string;
  className: string;
  arguments: string;
  status: string;
  createdAt: number;
  result?: string;
  errorType?: string;
}
export interface ExecutionPage {
  executions: ExecutionSummary[];
  nextCursor: string | null;
}
export function summarizeExecution(run: Run): ExecutionSummary {
  const describe = (value: unknown, type?: InputType): string => {
    if (value === null) return "null";
    if (type?.kind === "array" && Array.isArray(value))
      return `[${value.map((item) => describe(item, type.element)).join(", ")}]`;
    if (
      type?.kind === "integer" ||
      type?.kind === "float" ||
      type?.kind === "boolean"
    )
      return String(value);
    if (type?.kind === "character")
      return `'${String(value).replaceAll("'", "\\'")}'`;
    return JSON.stringify(value) ?? "—";
  };
  const args = (run.args || [])
    .map((value, index) => describe(value, run.entry.parameters[index]?.type))
    .join(", ");
  return {
    id: run.id,
    languageId: run.languageId || "java",
    methodName: run.entry.methodName,
    className: run.entry.className,
    arguments: args.length > 180 ? args.slice(0, 177) + "…" : args,
    status: run.status,
    createdAt: run.createdAt,
    result: run.result ? formatValue(run.result).slice(0, 100) : undefined,
    errorType: run.error?.type,
  };
}
export const terminal = (status: string) =>
  [
    "completed",
    "runtime_error",
    "compile_error",
    "internal_error",
    "interrupted",
    "cancelled",
    "timed_out",
    "resource_limited",
    "trace_limited",
    "unsupported_execution",
  ].includes(status);
export const analysisRequest = z.object({
  source: z.string().min(1).max(65536),
  languageId: z.literal("java").default("java"),
});
export const runRequest = z.object({
  analysisId: z.string().uuid(),
  sourceHash: z.string(),
  entryPointId: z.string().max(1000),
  args: z.array(z.unknown()).max(100),
  stdin: z.string().max(65536).default(""),
  idempotencyKey: z.string().uuid(),
});
export const adapterEvent = z
  .object({
    kind: z.enum([
      "run-start",
      "frame-enter",
      "observation",
      "frame-return",
      "frame-unwind",
      "exception",
      "output",
      "result",
      "limit",
      "run-end",
      "engine-error",
    ]),
    frameId: z.string().optional(),
    parentFrameId: z.string().nullable().optional(),
    method: z.string().optional(),
    className: z.string().optional(),
    line: z.number().optional(),
    phase: z.string().optional(),
    condition: z
      .object({
        id: z.string(),
        value: z.boolean(),
        operands: z
          .array(
            z.object({
              id: z.string(),
              value: z.object({ kind: z.string() }).passthrough(),
            }),
          )
          .max(24)
          .optional(),
      })
      .optional(),
    setup: z.boolean().optional(),
    variables: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          value: z.object({ kind: z.string() }).passthrough(),
        }),
      )
      .max(1000)
      .optional(),
  })
  .passthrough();

export function validateInput(value: unknown, type: InputType): unknown {
  if (value === null) {
    if (type.nullable) return null;
    throw new Error(`${type.languageType} cannot be null`);
  }
  switch (type.kind) {
    case "string":
      if (typeof value !== "string") throw new Error("Enter a string");
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw new Error("Choose true or false");
      return value;
    case "character":
      if (typeof value !== "string" || value.length !== 1)
        throw new Error("Enter one UTF-16 code unit");
      return value;
    case "integer": {
      if (typeof value !== "string" || !/^-?\d+$/.test(value))
        throw new Error("Enter an exact decimal integer");
      const n = BigInt(value);
      if (n < BigInt(type.min!) || n > BigInt(type.max!))
        throw new Error(`Must be between ${type.min} and ${type.max}`);
      return n.toString();
    }
    case "float":
      if (
        typeof value !== "string" ||
        !/^(?:NaN|[+-]?Infinity|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/.test(
          value,
        )
      )
        throw new Error("Enter a floating-point number");
      return value;
    case "array":
      if (!Array.isArray(value) || value.length > 10000 || !type.element)
        throw new Error("Enter a JSON array with at most 10,000 elements");
      return value.map((v) =>
        validateInput(
          typeof v === "number" &&
            ["integer", "float"].includes(type.element!.kind)
            ? Number.isSafeInteger(v) || type.element!.kind === "float"
              ? String(v)
              : (() => {
                  throw new Error("Quote large integers to preserve precision");
                })()
            : v,
          type.element!,
        ),
      );
    default:
      throw new Error(`Unsupported input: ${type.languageType}`);
  }
}
export function formatValue(v?: TraceValue): string {
  if (!v) return "—";
  if (v.kind === "null" || v.kind === "void") return v.kind;
  if (v.kind === "string")
    return JSON.stringify(v.value) + (v.truncated ? "…" : "");
  if (v.kind === "char") return `'${v.value}'`;
  if (v.kind === "boolean") return String(v.value);
  if (v.kind === "array")
    return `[${(v.items || []).map(formatValue).join(", ")}${v.truncated ? ", …" : ""}]`;
  if (v.kind === "object" || v.kind === "reference")
    return `${v.type} @${v.refId}`;
  if (v.kind === "unavailable") return "unavailable";
  return v.text || "—";
}
