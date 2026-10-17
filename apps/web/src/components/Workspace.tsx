"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowRight,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  ScanLine,
  Square,
  Download,
  RotateCcw,
  Terminal,
  Table2,
  Code2,
  SlidersHorizontal,
  Check,
  AlertTriangle,
  LoaderCircle,
  X,
  GitBranch,
  FileCode2,
} from "lucide-react";
import { EXAMPLE_SOURCE } from "../../../../packages/contracts/src/example";
import {
  conditionMarkers,
  conditionExplanation,
} from "../../../../packages/trace-model/src/index";
import ConditionDetails from "./ConditionDetails";
import ExecutionNavigation from "./ExecutionNavigation";
import {
  formatValue,
  terminal,
  validateInput,
  summarizeExecution,
  type Analysis,
  type EntryPoint,
  type InputType,
  type Run,
  type TraceEvent,
  type Binding,
  type ExecutionSummary,
  type ExecutionPage,
} from "../../../../packages/contracts/src/index";
const CodeEditor = dynamic(() => import("./CodeEditor"), {
  ssr: false,
  loading: () => <div className="editor-loading">Loading code editor…</div>,
});
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Establish the session once before parallel analysis/history requests, including Strict Mode remounts.
let runtimeInfo: Promise<{ backend: string; runtime: string }> | undefined;
function defaultInput(type: InputType): string {
  return type.kind === "array"
    ? "[]"
    : type.kind === "boolean"
      ? "false"
      : type.kind === "integer" || type.kind === "float"
        ? "0"
        : "";
}

export default function Workspace() {
  const [source, setSource] = useState(EXAMPLE_SOURCE),
    [analysis, setAnalysis] = useState<Analysis | null>(null),
    [entryId, setEntryId] = useState(""),
    [inputs, setInputs] = useState<Record<string, string>>({}),
    [nulls, setNulls] = useState<Record<string, boolean>>({}),
    [stdin, setStdin] = useState("");
  const [analyzing, setAnalyzing] = useState(false),
    [run, setRun] = useState<Run | null>(null),
    [events, setEvents] = useState<TraceEvent[]>([]),
    [error, setError] = useState(""),
    [info, setInfo] = useState<{ backend: string; runtime: string } | null>(
      null,
    );
  const [cursor, setCursor] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(500),
    [frame, setFrame] = useState("all"),
    [changesOnly, setChangesOnly] = useState(false),
    [showSetup, setShowSetup] = useState(false),
    [tab, setTab] = useState("code"),
    [consoleTab, setConsoleTab] = useState("result"),
    [inspected, setInspected] = useState<Binding | null>(null),
    [savedSource, setSavedSource] = useState(false),
    [history, setHistory] = useState<ExecutionSummary[]>([]),
    [historyCursor, setHistoryCursor] = useState<string | null>(null),
    [historyLoading, setHistoryLoading] = useState(true),
    [historyError, setHistoryError] = useState(""),
    [openingRun, setOpeningRun] = useState<string>();
  const revision = useRef(0),
    navigationRevision = useRef(0),
    historyRevision = useRef(0),
    tableRef = useRef<HTMLDivElement>(null),
    latestSource = useRef(source),
    nextSeq = useRef(0);
  const entry =
    analysis?.entryPoints.find((e) => e.id === entryId) ||
    (savedSource && run ? run.entry : undefined);
  const dirty = !!analysis && analysis.source !== source;
  const running = !!run && !terminal(run.status);
  const observations = useMemo(
    () =>
      events.filter(
        (e) =>
          e.kind === "observation" &&
          (showSetup || !e.setup) &&
          (frame === "all" || e.frameId === frame) &&
          (!changesOnly || !!e.changed?.length || !!e.removed?.length),
      ),
    [events, frame, changesOnly, showSetup],
  );
  const selected =
    observations[Math.min(cursor, Math.max(0, observations.length - 1))];
  const markers = useMemo(
    () =>
      savedSource && run && selected
        ? conditionMarkers(
            run.conditions || [],
            events,
            selected.seq,
            selected.frameId,
          )
        : [],
    [savedSource, run?.conditions, events, selected?.seq, selected?.frameId],
  );
  const conditionAtCursor = useMemo(() => {
    if (!selected) return undefined;
    const current =
      markers.find((marker) => marker.id === selected.condition?.id) ||
      (selected.phase === "before-instruction"
        ? markers.find(
            (marker) =>
              selected.line !== undefined &&
              selected.line >= marker.line &&
              selected.line <= marker.endLine,
          )
        : undefined);
    if (current) return { marker: current, current: true };
    const previous = events.findLast(
      (event) =>
        event.seq <= selected.seq &&
        event.frameId === selected.frameId &&
        event.condition,
    );
    const marker = markers.find((item) => item.id === previous?.condition?.id);
    return marker ? { marker, current: false } : undefined;
  }, [selected, markers, events]);
  const columns = useMemo(() => {
    const map = new Map<string, { key: string; name: string; type: string }>();
    for (const e of observations)
      for (const v of e.variables || [])
        if (v.name !== "this") {
          const key =
            frame === "all"
              ? `${e.method}:${v.name}:${v.id.split(":").slice(1).join(":")}`
              : v.id;
          map.set(key, { key, name: v.name, type: v.type });
        }
    return [...map.values()];
  }, [observations, frame]);
  const frames = useMemo(
    () =>
      events.filter((e) => e.kind === "frame-enter" && (showSetup || !e.setup)),
    [events, showSetup],
  );
  const virtualizer = useVirtualizer({
    count: observations.length,
    getScrollElement: () => tableRef.current,
    estimateSize: () => 39,
    overscan: 12,
    scrollPaddingStart: 36,
    paddingStart: 36, // The sticky table header occupies real scroll space before row zero.
  });
  const pendingReveal = useRef(false);
  const renderedRange = virtualizer
    .getVirtualItems()
    .map((row) => row.index)
    .join(",");
  const available =
    !!analysis &&
    analysis.status === "ready" &&
    !!entry?.supported &&
    !dirty &&
    !analyzing &&
    !running &&
    !openingRun;
  latestSource.current = source;
  const configureEntry = useCallback(
    (
      result: Pick<Analysis, "source" | "entryPoints">,
      id: string,
      args?: unknown[],
    ) => {
      setEntryId(id);
      const e = result.entryPoints.find((x) => x.id === id);
      const initial: Record<string, string> = {};
      const missing: Record<string, boolean> = {};
      for (const [index, p] of (e?.parameters || []).entries()) {
        const supplied = args !== undefined && index < args.length;
        const value = args?.[index];
        if (supplied && value === null) missing[p.id] = true;
        initial[p.id] =
          supplied && value !== null
            ? p.type.kind === "array"
              ? JSON.stringify(value)
              : String(value)
            : result.source === EXAMPLE_SOURCE && p.name === "haystack"
              ? "hello"
              : result.source === EXAMPLE_SOURCE && p.name === "needle"
                ? "ll"
                : defaultInput(p.type);
      }
      setInputs(initial);
      setNulls(missing);
    },
    [],
  );
  const loadHistory = useCallback(async (after?: string | null) => {
    const token = ++historyRevision.current;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const page = await api<ExecutionPage>(
        `runs?languageId=java&limit=30${after ? `&cursor=${encodeURIComponent(after)}` : ""}`,
      );
      if (token !== historyRevision.current) return;
      setHistory((current) =>
        after
          ? [
              ...current,
              ...page.executions.filter(
                (item) => !current.some((old) => old.id === item.id),
              ),
            ]
          : page.executions,
      );
      setHistoryCursor(page.nextCursor);
    } catch (e) {
      if (token === historyRevision.current)
        setHistoryError((e as Error).message);
    } finally {
      if (token === historyRevision.current) setHistoryLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!run) return;
    const summary = summarizeExecution(run);
    setHistory((current) =>
      [summary, ...current.filter((item) => item.id !== summary.id)].sort(
        (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
      ),
    );
  }, [run?.id, run?.status, run?.updatedAt]);
  const analyze = useCallback(
    async (code: string) => {
      const token = ++revision.current;
      setAnalyzing(true);
      setError("");
      try {
        let result = await api<Analysis>("analyses", {
          source: code,
          languageId: "java",
        });
        for (
          let i = 0;
          !["ready", "invalid", "failed", "cancelled"].includes(result.status);
          i++
        ) {
          if (i > 120)
            throw new Error(
              "Analysis took too long. Check the execution service.",
            );
          await wait(250);
          result = await api<Analysis>(`analyses/${result.id}`);
          if (token !== revision.current) return;
        }
        if (token !== revision.current || latestSource.current !== code) return;
        setAnalysis(result);
        if (result.error) throw new Error(result.error);
        const preferred =
          result.entryPoints.find((e) => e.supported && e.mode === "method") ||
          result.entryPoints.find((e) => e.supported);
        configureEntry(result, preferred?.id || "");
      } catch (e) {
        if (token === revision.current) setError((e as Error).message);
      } finally {
        if (token === revision.current) setAnalyzing(false);
      }
    },
    [configureEntry],
  );
  useEffect(() => {
    let disposed = false;
    runtimeInfo ??= api<{ backend: string; runtime: string }>("languages");
    runtimeInfo
      .then(async (info) => {
        if (disposed) return;
        setInfo(info);
        void loadHistory();
        try {
          const id = localStorage.getItem("codeviz-last-run");
          if (id && (await openRun(id, true))) return;
        } catch {}
        if (!disposed) void analyze(EXAMPLE_SOURCE);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      navigationRevision.current++;
      historyRevision.current++;
    };
  }, [analyze, loadHistory]);
  useEffect(() => {
    if (!run?.id) return;
    let disposed = false,
      inflight = false;
    const id = run.id;
    const sync = async () => {
      if (inflight || disposed) return;
      inflight = true;
      try {
        const status = await api<Run>(`runs/${id}`);
        let batch: TraceEvent[] = [];
        for (let page = 0; page < 12; page++) {
          const trace = await api<{ events: TraceEvent[] }>(
            `runs/${id}/trace?afterSeq=${nextSeq.current}&limit=1000`,
          );
          if (disposed) return;
          if (!trace.events.length) break;
          batch.push(...trace.events);
          nextSeq.current = trace.events.at(-1)!.seq;
          if (trace.events.length < 1000) break;
        }
        if (disposed) return;
        if (batch.length)
          setEvents((current) => {
            const known = new Set(current.map((e) => e.seq));
            return [...current, ...batch.filter((e) => !known.has(e.seq))];
          });
        setRun(status);
        if (terminal(status.status)) {
          stream.close();
          clearInterval(timer);
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      } finally {
        inflight = false;
      }
    };
    const stream = new EventSource(`/api/runs/${id}/events`);
    stream.addEventListener("progress", () => void sync());
    stream.onerror = () => void sync();
    const timer = setInterval(() => void sync(), 700);
    void sync();
    return () => {
      disposed = true;
      stream.close();
      clearInterval(timer);
    };
  }, [run?.id]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setCursor((c) => {
          if (c >= observations.length - 1) {
            setPlaying(false);
            return c;
          }
          return c + 1;
        }),
      speed,
    );
    return () => clearInterval(timer);
  }, [playing, speed, observations.length]);
  useEffect(() => {
    if (cursor >= observations.length)
      setCursor(Math.max(0, observations.length - 1));
  }, [observations.length, cursor]);
  useEffect(() => {
    // Hidden mobile panels and rapid seeks need their layout committed before scrolling.
    pendingReveal.current = true;
    let reveal = 0;
    const pending = requestAnimationFrame(() => {
      virtualizer.measure();
      virtualizer.scrollToIndex(cursor, { align: "auto" });
      reveal = requestAnimationFrame(() => {
        const row = tableRef.current?.querySelector(`[data-index="${cursor}"]`);
        if (row && tableRef.current?.clientHeight) {
          row.scrollIntoView({ block: "nearest", inline: "nearest" });
          pendingReveal.current = false;
        }
      });
    });
    return () => {
      cancelAnimationFrame(pending);
      cancelAnimationFrame(reveal);
    };
  }, [cursor, tab, frame, changesOnly, virtualizer]);
  useEffect(() => {
    if (!pendingReveal.current || !tableRef.current?.clientHeight) return;
    const row = tableRef.current.querySelector(`[data-index="${cursor}"]`);
    if (!row) return;
    const reveal = requestAnimationFrame(() => {
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
      pendingReveal.current = false;
    });
    return () => cancelAnimationFrame(reveal);
  }, [renderedRange, cursor, tab]);
  function edit(value: string) {
    navigationRevision.current++;
    setOpeningRun(undefined);
    setSource(value);
    latestSource.current = value;
    revision.current++;
    setAnalyzing(false);
    setSavedSource(false);
  }
  async function start() {
    if (!analysis || !entry) return;
    setError("");
    try {
      const args = entry.parameters.map((p) => {
        if (nulls[p.id]) return validateInput(null, p.type);
        const text = inputs[p.id] ?? "";
        return validateInput(
          p.type.kind === "array"
            ? JSON.parse(text)
            : p.type.kind === "boolean"
              ? text === "true"
              : text,
          p.type,
        );
      });
      const next = await api<Run>("runs", {
        analysisId: analysis.id,
        sourceHash: analysis.sourceHash,
        entryPointId: entry.id,
        args,
        stdin,
        idempotencyKey: crypto.randomUUID(),
      });
      nextSeq.current = 0;
      setEvents([]);
      setRun(next);
      setCursor(0);
      setPlaying(false);
      setFrame("all");
      setSavedSource(true);
      setConsoleTab("result");
      localStorage.setItem("codeviz-last-run", next.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function openRun(id: string, quiet = false): Promise<boolean> {
    if (running) return false;
    const token = ++navigationRevision.current;
    setOpeningRun(id);
    try {
      const r = await api<Run>(`runs/${id}`);
      const original = await api<Analysis>(`analyses/${r.analysisId}`).catch(
        () => null,
      );
      if (token !== navigationRevision.current) return false;
      revision.current++;
      setAnalyzing(false);
      setSource(r.source);
      latestSource.current = r.source;
      setAnalysis(original);
      configureEntry(
        { source: r.source, entryPoints: [r.entry] },
        r.entry.id,
        r.args,
      );
      setStdin(r.stdin || "");
      nextSeq.current = 0;
      setEvents([]);
      setRun(r);
      setCursor(0);
      setPlaying(false);
      setFrame("all");
      setChangesOnly(false);
      setShowSetup(false);
      setInspected(null);
      setConsoleTab("result");
      setError("");
      setSavedSource(true);
      localStorage.setItem("codeviz-last-run", id);
      return true;
    } catch (e) {
      if (token === navigationRevision.current && !quiet)
        setError((e as Error).message);
      return false;
    } finally {
      if (token === navigationRevision.current) setOpeningRun(undefined);
    }
  }
  function newExecution() {
    navigationRevision.current++;
    setOpeningRun(undefined);
    setRun(null);
    setEvents([]);
    nextSeq.current = 0;
    setSavedSource(false);
    setPlaying(false);
    setCursor(0);
    setFrame("all");
    setChangesOnly(false);
    setShowSetup(false);
    setInspected(null);
    setError("");
    setTab("code");
    setConsoleTab("result");
    localStorage.removeItem("codeviz-last-run");
    if (!analysis || analysis.source !== source) void analyze(source);
  }
  async function cancel() {
    if (run)
      try {
        await api(`runs/${run.id}/cancel`, {});
      } catch (e) {
        setError((e as Error).message);
      }
  }
  const selectedVariables =
    selected?.variables?.filter((v) => v.name !== "this") || [];
  const returned = events.find((e) => e.kind === "frame-return" && e.root);
  const displaySource = savedSource && run ? run.source : source;
  const lines = displaySource.split("\n");
  const statusText = running
    ? run.status === "running"
      ? "Recording execution…"
      : `${run.status[0].toUpperCase()}${run.status.slice(1)}…`
    : run?.status === "completed"
      ? "Execution complete"
      : run
        ? run.status.replaceAll("_", " ")
        : analyzing
          ? "Detecting inputs…"
          : "Ready to explore";

  return (
    <div className="app-shell">
      <ExecutionNavigation
        executions={history}
        selectedId={run?.id}
        openingId={openingRun}
        loading={historyLoading}
        error={historyError}
        hasMore={!!historyCursor}
        busy={running}
        onSelect={openRun}
        onNew={newExecution}
        onMore={() => void loadHistory(historyCursor)}
        onRefresh={() => void loadHistory()}
      />
      <main className="workspace">
        {/* {info?.backend === "local" && (
          <div className="local-notice">
            <AlertTriangle size={15} />
            <span>
              Local development mode. Java runs on this computer; use code you
              trust.
            </span>
            <span className="notice-end">localhost only</span>
          </div>
        )} */}
        <div className="workspace-toolbar">
          <div className="workspace-title">
            <h1>{entry?.className || "your program"}</h1>
            {/* <span className="workspace-title-text">
              Java <span className="muted">/</span>{" "}
              {entry?.className || "your program"}
            </span> */}
          </div>
          <div className="toolbar-actions">
            <button
              className="button subtle"
              onClick={() => {
                edit(EXAMPLE_SOURCE);
                void analyze(EXAMPLE_SOURCE);
              }}
              disabled={running}
            >
              <RotateCcw size={14} />
              Load example
            </button>
            <button
              className="button secondary"
              onClick={() => void analyze(source)}
              disabled={analyzing || running || !source.trim()}
            >
              {analyzing ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <ScanLine size={15} />
              )}
              Detect inputs
            </button>
            <button
              className="button primary"
              onClick={() => void start()}
              disabled={!available}
              title={
                dirty
                  ? "Detect inputs after changing the source"
                  : !entry
                    ? "Detect a supported method first"
                    : undefined
              }
            >
              <Play size={14} fill="currentColor" />
              Run & visualize
            </button>
            {running && (
              <button className="button danger" onClick={() => void cancel()}>
                <Square size={13} />
                Stop run
              </button>
            )}
          </div>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            <AlertTriangle size={17} />
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <nav className="mobile-tabs" aria-label="Workspace panels">
          {[
            ["code", "Code", Code2],
            ["inputs", "Inputs", SlidersHorizontal],
            ["trace", "Trace", Table2],
            ["output", "Output", Terminal],
          ].map(([id, label, Icon]) => (
            <button
              key={id as string}
              onClick={() => setTab(id as string)}
              className={tab === id ? "active" : ""}
            >
              {typeof Icon !== "string" && <Icon size={15} />} {label as string}
            </button>
          ))}
        </nav>
        <div className="upper-grid">
          <section
            className={`panel source-panel ${tab === "code" ? "mobile-visible" : ""}`}
            aria-label="Java source editor"
          >
            <div className="panel-heading">
              <div className="panel-title">
                <FileCode2 size={16} />
                <span>{analysis?.fileName || "Solution.java"}</span>
                {dirty && <span className="small-tag">edited</span>}
              </div>
              <div className="panel-meta">
                {savedSource && run && run.source !== source ? (
                  <button
                    className="text-button"
                    onClick={() => setSavedSource(false)}
                  >
                    Back to editor
                  </button>
                ) : (
                  <span>{lines.length} lines</span>
                )}
                <span className="language-dot" />
                Java
              </div>
            </div>
            <div className="editor-container">
              <CodeEditor
                value={displaySource}
                onChange={edit}
                line={savedSource ? selected?.line : undefined}
                conditions={markers}
                readOnly={savedSource && !!run && run.source !== source}
              />
            </div>
            <div className="editor-footer">
              <span>
                {savedSource && run
                  ? "Viewing the source recorded for this run"
                  : dirty
                    ? "Source changed · detect inputs to update the form"
                    : "Your source runs as written"}
              </span>
              <span>UTF-8</span>
            </div>
            {analysis?.diagnostics.some((d) => d.severity === "error") && (
              <div className="diagnostics" role="alert">
                {analysis.diagnostics.map((d, i) => (
                  <div key={i}>
                    <strong>Line {d.line}</strong> {d.message}
                  </div>
                ))}
              </div>
            )}
          </section>
          <section
            className={`panel input-panel ${tab === "inputs" ? "mobile-visible" : ""}`}
            aria-label="Detected inputs"
          >
            <div className="panel-heading">
              <div className="panel-title">
                <SlidersHorizontal size={16} />
                <h2>Program inputs</h2>
              </div>
              {analysis?.status === "ready" && !dirty && (
                <span className="detected">
                  <Check size={12} />
                  Auto-detected
                </span>
              )}
            </div>
            <div className="input-content">
              <label className="field-label" htmlFor="entry">
                Entry point
              </label>
              <select
                id="entry"
                value={entryId}
                onChange={(e) =>
                  analysis && configureEntry(analysis, e.target.value)
                }
                disabled={!analysis || dirty || running}
              >
                <option value="">
                  {analyzing ? "Finding callable methods…" : "Select a method"}
                </option>
                {analysis?.entryPoints.map((e) => (
                  <option key={e.id} value={e.id} disabled={!e.supported}>
                    {e.displayName}
                    {e.supported ? "" : ` — ${e.reason}`}
                  </option>
                ))}
              </select>
              <div className="signature-note">
                {entry ? (
                  <>
                    <GitBranch size={13} />
                    {entry.mode === "program"
                      ? "Program mode · arguments and standard input"
                      : `${entry.isStatic ? "Static" : "Instance"} method`}
                    <ArrowRight size={12} />
                    <code>{entry.returnType}</code>
                  </>
                ) : (
                  <span>
                    Detect inputs to build your form from the method signature.
                  </span>
                )}
              </div>
              <div className="parameter-list">
                {entry?.parameters.map((p) => (
                  <div className="parameter" key={p.id}>
                    <div className="parameter-label">
                      <label htmlFor={`input-${p.id}`}>{p.name}</label>
                      <code>
                        {p.type.languageType.replace("java.lang.", "")}
                      </code>
                      {p.type.nullable && (
                        <label className="null-toggle">
                          <input
                            type="checkbox"
                            checked={!!nulls[p.id]}
                            disabled={running || dirty}
                            onChange={(e) =>
                              setNulls({ ...nulls, [p.id]: e.target.checked })
                            }
                          />
                          null
                        </label>
                      )}
                    </div>
                    {p.type.kind === "boolean" ? (
                      <select
                        id={`input-${p.id}`}
                        value={inputs[p.id]}
                        disabled={running || dirty}
                        onChange={(e) =>
                          setInputs({ ...inputs, [p.id]: e.target.value })
                        }
                      >
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                    ) : (
                      <textarea
                        id={`input-${p.id}`}
                        aria-label={p.name}
                        rows={p.type.kind === "array" ? 3 : 1}
                        value={inputs[p.id] || ""}
                        disabled={!!nulls[p.id] || running || dirty}
                        onChange={(e) =>
                          setInputs({ ...inputs, [p.id]: e.target.value })
                        }
                        spellCheck={false}
                        placeholder={p.type.kind === "array" ? "[1, 2, 3]" : ""}
                      />
                    )}
                    <span className="input-hint">
                      {p.type.kind === "array"
                        ? "JSON array · quote large integers to keep precision"
                        : p.type.kind === "string"
                          ? "Text is passed exactly as entered. Empty strings are allowed."
                          : p.type.kind === "integer"
                            ? `${p.type.min} to ${p.type.max}`
                            : p.type.kind === "character"
                              ? "One UTF-16 code unit"
                              : ""}
                    </span>
                  </div>
                ))}
              </div>
              {entry?.parameters.length === 0 && (
                <div className="zero-args">
                  <Check size={16} />
                  This method takes no arguments.
                </div>
              )}
              <details className="stdin" open={entry?.mode === "program"}>
                <summary>
                  Standard input{" "}
                  <span>
                    {entry?.mode === "program" ? "Program mode" : "Optional"}
                  </span>
                </summary>
                <textarea
                  aria-label="Standard input"
                  rows={3}
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                  placeholder="Input read from System.in"
                />
                <p>The full buffer is sent once, followed by EOF.</p>
              </details>
              {/* <div className="input-bottom">
              <span>
                <span className="status-dot" />
                {entry
                  ? `${entry.parameters.length} parameter${entry.parameters.length === 1 ? "" : "s"} detected`
                  : "Waiting for analysis"}
              </span>
              <span>No main method needed</span>
            </div> */}
            </div>
          </section>
        </div>
        <section
          className={`panel trace-panel ${tab === "trace" ? "mobile-visible" : ""}`}
          aria-label="Variable history"
        >
          <div className="trace-heading">
            <div>
              <div className="panel-title">
                <Table2 size={17} />
                <h2>Variable history</h2>
                {observations.length > 0 && (
                  <span className="count-badge">{observations.length}</span>
                )}
              </div>
              <p>Follow variable values and recorded condition results.</p>
            </div>
            <div className="trace-actions">
              <label className="check-control">
                <input
                  type="checkbox"
                  checked={changesOnly}
                  onChange={(e) => {
                    setChangesOnly(e.target.checked);
                    setCursor(0);
                  }}
                />
                Changes only
              </label>
              <label className="check-control">
                <input
                  type="checkbox"
                  checked={showSetup}
                  onChange={(e) => {
                    setShowSetup(e.target.checked);
                    setCursor(0);
                  }}
                />
                Setup calls
              </label>
              <select
                aria-label="Invocation frame"
                value={frame}
                onChange={(e) => {
                  setFrame(e.target.value);
                  setCursor(0);
                }}
              >
                <option value="all">All invocations</option>
                {frames.map((e) => (
                  <option key={e.frameId} value={e.frameId}>
                    {e.method} · {e.frameId}
                  </option>
                ))}
              </select>
              <button
                className="button subtle compact"
                disabled={!run || running}
                onClick={() =>
                  run && window.open(`/api/runs/${run.id}/export`, "_blank")
                }
              >
                <Download size={14} />
                Export
              </button>
            </div>
          </div>
          {observations.length === 0 ? (
            <div className="trace-empty">
              <span className="empty-symbol">
                <Table2 size={26} />
              </span>
              <h3>
                {running
                  ? "Recording your program…"
                  : "Your execution, one observation at a time"}
              </h3>
              <p>
                {running
                  ? "Real JVM states will appear here as they are recorded."
                  : "Enter your inputs and run the program. Variable changes and source locations will appear here."}
              </p>
              <div className="empty-flow">
                <span>Source</span>
                <ArrowRight size={15} />
                <span>Inputs</span>
                <ArrowRight size={15} />
                <span>Variable changes</span>
                <ArrowRight size={15} />
                <span>Result</span>
              </div>
            </div>
          ) : (
            <>
              {conditionAtCursor && (
                <ConditionDetails
                  marker={conditionAtCursor.marker}
                  current={conditionAtCursor.current}
                />
              )}
              <div className="playback-bar">
                <div className="playback-buttons">
                  <button
                    className="icon-button"
                    aria-label="First observation"
                    onClick={() => {
                      setPlaying(false);
                      setCursor(0);
                      virtualizer.scrollToIndex(0);
                    }}
                  >
                    <SkipBack size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Previous observation"
                    onClick={() => {
                      setPlaying(false);
                      setCursor(Math.max(0, cursor - 1));
                      virtualizer.scrollToIndex(Math.max(0, cursor - 1));
                    }}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <button
                    className="icon-button playback-play"
                    aria-label={playing ? "Pause playback" : "Play recording"}
                    onClick={() => {
                      if (cursor >= observations.length - 1) setCursor(0);
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next observation"
                    onClick={() => {
                      setPlaying(false);
                      setCursor(Math.min(observations.length - 1, cursor + 1));
                      virtualizer.scrollToIndex(
                        Math.min(observations.length - 1, cursor + 1),
                      );
                    }}
                  >
                    <ChevronRight size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Last observation"
                    onClick={() => {
                      setPlaying(false);
                      setCursor(observations.length - 1);
                      virtualizer.scrollToIndex(observations.length - 1);
                    }}
                  >
                    <SkipForward size={15} />
                  </button>
                </div>
                <span className="step-label">
                  {cursor + 1} <span>/ {observations.length}</span>
                </span>
                <input
                  aria-label="Seek recording"
                  className="seek"
                  type="range"
                  min={0}
                  max={observations.length - 1}
                  value={cursor}
                  onChange={(e) => {
                    const c = +e.target.value;
                    setCursor(c);
                    setPlaying(false);
                    virtualizer.scrollToIndex(c);
                  }}
                />
                <select
                  aria-label="Playback speed"
                  value={speed}
                  onChange={(e) => setSpeed(+e.target.value)}
                >
                  <option value={1000}>0.5×</option>
                  <option value={500}>1×</option>
                  <option value={200}>2.5×</option>
                </select>
              </div>
              <div
                className="table-scroll"
                ref={tableRef}
                role="region"
                aria-label="Execution trace table"
                tabIndex={0}
              >
                <table className="trace-table">
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">Line</th>
                      <th scope="col">Source</th>
                      {columns.map((c) => (
                        <th
                          scope="col"
                          aria-label={c.name}
                          key={c.key}
                          title={c.type}
                        >
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {virtualizer.getVirtualItems().length > 0 && (
                      <tr aria-hidden="true">
                        <td
                          colSpan={columns.length + 3}
                          style={{
                            height: Math.max(
                              0,
                              virtualizer.getVirtualItems()[0].start - 36,
                            ),
                            padding: 0,
                            border: 0,
                          }}
                        />
                      </tr>
                    )}
                    {virtualizer.getVirtualItems().map((v) => {
                      const event = observations[v.index];
                      const definition = run?.conditions?.find(
                        (item) => item.id === event.condition?.id,
                      );
                      const evaluated =
                        definition && event.condition
                          ? conditionExplanation({
                              ...definition,
                              value: event.condition.value,
                              capturedOperands: event.condition.operands,
                            })
                          : undefined;
                      return (
                        <tr
                          key={event.seq}
                          data-index={v.index}
                          className={v.index === cursor ? "selected-row" : ""}
                          onClick={() => {
                            setCursor(v.index);
                            setSavedSource(true);
                            setPlaying(false);
                          }}
                        >
                          <td>
                            <button
                              className="row-select"
                              aria-label={`Observation ${v.index + 1}, line ${event.line}`}
                              onClick={() => {
                                setCursor(v.index);
                                setSavedSource(true);
                              }}
                            >
                              {v.index === cursor ? (
                                <ArrowRight size={13} />
                              ) : null}
                              {v.index + 1}
                            </button>
                          </td>
                          <td className="line-cell">{event.line}</td>
                          <td
                            className="source-cell"
                            title={
                              run?.source.split("\n")[(event.line || 1) - 1]
                            }
                          >
                            <div className="source-content">
                              <code>
                                {run?.source
                                  .split("\n")
                                  [(event.line || 1) - 1]?.trim() ||
                                  event.method}
                              </code>
                              {event.condition && (
                                <span
                                  className={`condition-pill ${event.condition.value ? "condition-true" : "condition-false"}`}
                                  data-testid="condition-result"
                                  aria-label={`Condition evaluated ${event.condition.value}`}
                                  title={
                                    evaluated?.available
                                      ? `${evaluated.substituted} → ${event.condition.value}. Recorded once, after evaluation.`
                                      : "Recorded result. This row shows values after the condition was evaluated once."
                                  }
                                >
                                  {String(event.condition.value)}
                                </span>
                              )}
                              {event.phase === "return" && (
                                <span className="return-tag">return</span>
                              )}
                            </div>
                            {evaluated?.available && (
                              <div
                                className="condition-row-values"
                                title={evaluated.substituted}
                              >
                                {evaluated.substituted}
                              </div>
                            )}
                          </td>
                          {columns.map((c) => {
                            const binding = event.variables?.find(
                              (b) =>
                                (frame === "all"
                                  ? `${event.method}:${b.name}:${b.id.split(":").slice(1).join(":")}`
                                  : b.id) === c.key,
                            );
                            const changed =
                              !!binding && event.changed?.includes(binding.id);
                            return (
                              <td
                                key={c.key}
                                className={changed ? "changed-cell" : ""}
                              >
                                {binding ? (
                                  <button
                                    className="value-button"
                                    title={JSON.stringify(binding.value)}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setInspected(binding);
                                    }}
                                  >
                                    {changed && <span className="change-dot" />}
                                    {formatValue(binding.value)}
                                  </button>
                                ) : (
                                  <span className="unavailable-cell">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {virtualizer.getVirtualItems().length > 0 && (
                      <tr aria-hidden="true">
                        <td
                          colSpan={columns.length + 3}
                          style={{
                            height:
                              virtualizer.getTotalSize() -
                              (virtualizer.getVirtualItems().at(-1)?.end || 0),
                            padding: 0,
                            border: 0,
                          }}
                        />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* <div className="trace-footer">
              <span>
                <span className="change-dot" />
                Changed since the previous observation in this invocation
              </span>
              <span>
                Line-level observations ·{" "}
                {run?.traceCompleteness === "partial"
                  ? "partial recording"
                  : "real JVM execution"}
              </span>
            </div> */}
            </>
          )}
          {!!analysis?.warnings.length && (
            <details className="trace-warnings">
              <summary>
                <AlertTriangle size={13} />
                {analysis.warnings.length} source layout notice
                {analysis.warnings.length === 1 ? "" : "s"}
              </summary>
              {analysis.warnings.map((w, i) => (
                <p key={i}>
                  Line {w.line}: {w.message}
                </p>
              ))}
            </details>
          )}
        </section>
        <section
          className={`panel output-panel ${tab === "output" ? "mobile-visible" : ""}`}
          aria-label="Run output"
        >
          <div className="output-heading">
            <div className="output-tabs">
              {[
                ["result", "Result"],
                ["stdout", "stdout"],
                ["stderr", "stderr"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={consoleTab === id ? "active" : ""}
                  onClick={() => setConsoleTab(id)}
                >
                  {id === "result" ? (
                    <ArrowRight size={14} />
                  ) : (
                    <Terminal size={14} />
                  )}{" "}
                  {label}
                  {id !== "result" && run?.[id as "stdout" | "stderr"] && (
                    <span className="status-dot" />
                  )}
                </button>
              ))}
            </div>
            <span
              className={`run-status ${run?.status === "completed" ? "complete" : ""}`}
              role="status"
            >
              {running || analyzing ? (
                <LoaderCircle size={13} className="spin" />
              ) : run?.status === "completed" ? (
                <Check size={14} />
              ) : null}
              {statusText}
            </span>
          </div>
          <div className="output-content">
            {consoleTab === "result" ? (
              run?.error ? (
                <div className="exception-result">
                  <AlertTriangle size={19} />
                  <div>
                    <strong>{run.error.type}</strong>
                    <pre>{run.error.message}</pre>
                    {run.traceCompleteness === "partial" && (
                      <p>
                        The recording is partial. Values captured before the
                        failure are still available.
                      </p>
                    )}
                  </div>
                </div>
              ) : run?.status === "completed" ? (
                <div className="result-body">
                  <div>
                    <span className="result-label">Return value</span>
                    <strong className="result-value" data-testid="return-value">
                      {formatValue(run.result)}
                    </strong>
                  </div>
                  <div className="result-explanation">
                    <Check size={17} />
                    <p>
                      <code>{run.entry.methodName}</code> returned{" "}
                      <code>{formatValue(run.result)}</code>
                      {returned?.line ? (
                        <>
                          {" "}
                          at line{" "}
                          <button
                            className="text-button"
                            onClick={() => {
                              const i = observations.findLastIndex(
                                (e) => e.line === returned.line,
                              );
                              if (i >= 0) {
                                setCursor(i);
                                setSavedSource(true);
                                setTab("trace");
                                virtualizer.scrollToIndex(i);
                              }
                            }}
                          >
                            {returned.line}
                          </button>
                        </>
                      ) : (
                        ""
                      )}
                      . Select an observation to inspect the values that led
                      here.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="output-placeholder">
                  {running
                    ? "The result will appear when the invocation finishes."
                    : "The return value and console output will appear here after a run."}
                </p>
              )
            ) : (
              <pre className="console-text">
                {run?.[consoleTab as "stdout" | "stderr"] ||
                  `No ${consoleTab} output${run ? " for this run" : ""}.`}
              </pre>
            )}
          </div>
        </section>
        {selectedVariables.length > 0 && (
          <div
            className="current-values"
            aria-label="Selected observation values"
          >
            <span>At line {selected?.line}</span>
            {selectedVariables.slice(0, 7).map((v) => (
              <button key={v.id} onClick={() => setInspected(v)}>
                <span>{v.name}</span>
                <code>{formatValue(v.value)}</code>
              </button>
            ))}
          </div>
        )}
        {inspected && (
          <aside className="value-inspector" aria-label="Variable inspector">
            <div className="panel-heading">
              <div>
                <strong>{inspected.name}</strong>
                <code>{inspected.type}</code>
              </div>
              <button
                className="icon-button"
                aria-label="Close value inspector"
                onClick={() => setInspected(null)}
              >
                <X size={17} />
              </button>
            </div>
            <pre>{JSON.stringify(inspected.value, null, 2)}</pre>
          </aside>
        )}
      </main>
    </div>
  );
}
