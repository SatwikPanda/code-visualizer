"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Minus,
  Plus,
  Maximize2,
  RotateCcw,
  MoveUpRight,
  ArrowRight,
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  GitBranch,
  MousePointer2,
  RefreshCw,
  BarChart3,
  CircleDot,
  CornerDownLeft,
} from "lucide-react";
import { drawScene } from "./canvas-renderer";
import { changePreview } from "../../../../packages/trace-model/src/transition";
import {
  formatValue,
  type Binding,
  type TraceEvent,
} from "../../../../packages/contracts/src/index";
import {
  buildScene,
  previousObservation,
  type Scene,
} from "../../../../packages/trace-model/src/scene";

export default function AnimatedCanvas({
  events,
  selected,
  source,
  duration,
  onInspect,
}: {
  events: TraceEvent[];
  selected?: TraceEvent;
  source: string;
  duration: number;
  onInspect: (v: Binding) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null),
    last = useRef<Scene | undefined>(undefined);
  const [width, setWidth] = useState(1000),
    [zoom, setZoom] = useState<number | null>(null),
    [replay, setReplay] = useState(0),
    [bars, setBars] = useState(true);
  const scene = useMemo(
    () => buildScene(events, selected, source, width, { bars }),
    [events, selected, source, width, bars],
  );
  const scale = zoom ?? Math.min(1, width / scene.width);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = scene.width * scale * ratio;
    el.height = scene.height * scale * ratio;
    ctx.scale(scale * ratio, scale * ratio);
    const previous =
      last.current?.frameId === scene.frameId &&
      last.current?.seq === previousObservation(events, selected)?.seq
        ? last.current
        : undefined;
    last.current = scene;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let request = 0,
      start = performance.now();
    const render = (now: number) => {
      const p =
        reduced || !previous
          ? 1
          : Math.min(1, (now - start) / Math.min(700, duration * 0.85));
      drawScene(ctx, scene, previous, p);
      el.dataset.animationState = p < 1 ? "running" : "settled";
      if (p < 1) request = requestAnimationFrame(render);
    };
    render(performance.now());
    return () => cancelAnimationFrame(request);
  }, [scene, scale, duration, replay]);
  function inspect(x: number, y: number) {
    const hit = [...scene.nodes]
      .reverse()
      .find((n) => x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h);
    if (hit) onInspect(hit.binding);
  }
  const line = source.split("\n")[(selected?.line || 1) - 1]?.trim();
  const operation = scene.operation;
  const OperationIcon =
    operation.kind === "read"
      ? ArrowDownToLine
      : operation.kind === "write"
        ? ArrowUpFromLine
        : operation.kind === "swap" || operation.kind === "reorder"
          ? ArrowLeftRight
          : operation.kind === "insert"
            ? Plus
            : operation.kind === "remove"
              ? Minus
              : operation.kind === "condition"
                ? GitBranch
                : operation.kind === "iterate"
                  ? MousePointer2
                  : operation.kind === "return"
                    ? CornerDownLeft
                    : operation.kind === "update"
                      ? RefreshCw
                      : CircleDot;
  const hasNumeric = selected?.variables?.some(
    (v) =>
      v.value.kind === "array" &&
      !["stack", "queue", "map"].includes(v.value.container || "") &&
      v.value.items?.some((item) =>
        ["integer", "float", "array"].includes(item.kind),
      ),
  );
  return (
    <div className="animation-view">
      <div className="canvas-toolbar">
        <div className="canvas-call-stack" aria-label="Active function calls">
          <MoveUpRight size={13} />
          {scene.frames.map((name, i) => (
            <span key={i}>
              {i > 0 && <span className="muted"> / </span>}
              <code>{name}</code>
            </span>
          ))}
          {!scene.frames.length && <span>Current invocation</span>}
        </div>
        <div className="canvas-tools">
          {hasNumeric && (
            <button
              className="canvas-bars-toggle"
              aria-label="Show numeric values as bars"
              aria-pressed={bars}
              onClick={() => setBars((v) => !v)}
            >
              <BarChart3 size={14} />
              <span>Value bars</span>
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Zoom out"
            disabled={scale <= 0.5}
            onClick={() => setZoom(Math.max(0.5, scale - 0.15))}
          >
            <Minus size={14} />
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            className="icon-button"
            aria-label="Zoom in"
            disabled={scale >= 1.6}
            onClick={() => setZoom(Math.min(1.6, scale + 0.15))}
          >
            <Plus size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Fit canvas"
            onClick={() => setZoom(null)}
          >
            <Maximize2 size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Replay step animation"
            onClick={() => {
              const prev = events.findLast(
                (e) =>
                  e.kind === "observation" &&
                  e.frameId === selected?.frameId &&
                  e.seq < (selected?.seq || 0),
              );
              last.current = buildScene(events, prev, source, scene.width, {
                bars,
              });
              setReplay((r) => r + 1);
            }}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
      <section
        className={`canvas-operation operation-${operation.kind}`}
        aria-label="Step explanation"
        aria-live="polite"
        aria-atomic="true"
      >
        <OperationIcon size={22} className="canvas-operation-icon" />
        <div className="canvas-operation-copy">
          <h3>{operation.title}</h3>
          <p>{operation.description}</p>
        </div>
        {operation.condition !== undefined && (
          <svg
            className="canvas-branch"
            viewBox="0 0 166 62"
            role="img"
            aria-label={`Recorded ${operation.condition ? "true" : "false"} branch`}
          >
            <path
              d="M10 31 27 14 44 31 27 48Z"
              fill="none"
              stroke="currentColor"
            />
            <path
              d="M44 31H64V12H112m-5-4 5 4-5 4"
              fill="none"
              stroke={operation.condition ? "var(--success)" : "var(--line)"}
              strokeWidth="2"
            />
            <path
              d="M64 31V50H112m-5-4 5 4-5 4"
              fill="none"
              stroke={!operation.condition ? "var(--error)" : "var(--line)"}
              strokeWidth="2"
            />
            <text
              x="120"
              y="16"
              fill={operation.condition ? "var(--success)" : "var(--secondary)"}
            >
              true
            </text>
            <text
              x="120"
              y="54"
              fill={!operation.condition ? "var(--error)" : "var(--secondary)"}
            >
              false
            </text>
          </svg>
        )}
      </section>
      {!!operation.changes.length && (
        <div
          className="canvas-change-strip"
          aria-label="Before and after values"
        >
          {operation.changes.slice(0, 4).map((change) => {
            const preview = changePreview(change);
            return (
              <button
                key={change.id}
                title={`${change.name}: ${change.before ? formatValue(change.before) : "created"} → ${formatValue(change.after)}`}
                onClick={() => {
                  const binding = selected?.variables?.find(
                    (v) => v.id === change.id,
                  );
                  if (binding) onInspect(binding);
                }}
              >
                <span>{preview.label}</span>
                <code className="canvas-before">{preview.before}</code>
                <ArrowRight size={12} />
                <code>{preview.after}</code>
                {change.delta && <small>{change.delta}</small>}
              </button>
            );
          })}
          {operation.changes.length > 4 && (
            <span className="canvas-more-changes">
              +{operation.changes.length - 4} more
            </span>
          )}
        </div>
      )}
      <div
        className="canvas-scroll"
        ref={container}
        tabIndex={0}
        role="region"
        aria-label="Animated data canvas. Scroll to explore; use the variable list to inspect values."
      >
        <canvas
          ref={canvas}
          style={{ width: scene.width * scale, height: scene.height * scale }}
          role="img"
          aria-label={`Line ${selected?.line}. ${scene.explanation.join(". ")}. ${scene.nodes
            .filter(
              (n) =>
                n.role === "label" ||
                n.role === "scalar" ||
                n.role === "pointer",
            )
            .map((n) => `${n.label || n.text}: ${n.text}`)
            .join(". ")}. ${scene.edges
            .filter((edge) => edge.transfer)
            .map((edge) => `${edge.label}: ${edge.value}`)
            .join(". ")}`}
          onClick={(e) => {
            const bounds = e.currentTarget.getBoundingClientRect();
            inspect(
              (e.clientX - bounds.left) / scale,
              (e.clientY - bounds.top) / scale,
            );
          }}
        />
      </div>
      <div className="canvas-explanation">
        <div>
          <span className="change-dot" />
          <span>{scene.explanation.slice(0, 3).join(" · ")}</span>
        </div>
        <code title={line}>
          L{selected?.line} <span>{line}</span>
        </code>
      </div>
      <div className="canvas-footer">
        <span>
          Recorded states · motion illustrates changes between snapshots
        </span>
        <span>Click a value to inspect its recorded contents</span>
      </div>
      <div className="canvas-legend" aria-label="Canvas color key">
        <span>
          <i className="legend-read" />
          Read / pointer
        </span>
        <span>
          <i className="legend-write" />
          New / write
        </span>
        <span>
          <i className="legend-remove" />
          Removed
        </span>
        {hasNumeric && bars && (
          <span className="canvas-bars-note">
            Bar height compares magnitudes; labels keep exact values.
          </span>
        )}
      </div>
      <details className="canvas-accessible-values">
        <summary>
          Inspect variables ({selected?.variables?.length || 0})
        </summary>
        <div>
          {selected?.variables
            ?.filter((v) => v.name !== "this")
            .map((v) => (
              <button
                className="text-button"
                key={v.id}
                onClick={() => onInspect(v)}
              >
                {v.name} <span className="muted">{v.type}</span>
              </button>
            ))}
        </div>
      </details>
    </div>
  );
}
