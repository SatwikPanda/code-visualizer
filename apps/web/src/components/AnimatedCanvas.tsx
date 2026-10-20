"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Maximize2, RotateCcw, MoveUpRight } from "lucide-react";
import type {
  Binding,
  TraceEvent,
} from "../../../../packages/contracts/src/index";
import {
  buildScene,
  type Scene,
  type SceneNode,
} from "../../../../packages/trace-model/src/scene";

const colors = {
  surface: "#1b1b1b",
  box: "#252525",
  line: "#555555",
  text: "#ececec",
  muted: "#a7a7a7",
  amber: "#e5bd82",
  green: "#8ed6ac",
};
function draw(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  previous: Scene | undefined,
  progress: number,
) {
  ctx.clearRect(0, 0, scene.width, scene.height);
  const old = new Map(previous?.nodes.map((n) => [n.key, n]));
  const oldEdges = new Map(previous?.edges.map((edge) => [edge.key, edge]));
  const ease = 1 - Math.pow(1 - progress, 4);
  const current = new Set(scene.nodes.map((n) => n.key));
  function node(n: SceneNode, opacity = 1) {
    ctx.globalAlpha = opacity;
    const p = old.get(n.key),
      ease = 1 - Math.pow(1 - progress, 4);
    const x = p ? p.x + (n.x - p.x) * ease : n.x,
      y = p ? p.y + (n.y - p.y) * ease : n.y;
    ctx.font = '12px Consolas, "Cascadia Code", monospace';
    ctx.textBaseline = "middle";
    if (n.role === "cell" || n.role === "scalar") {
      ctx.fillStyle = colors.box;
      ctx.strokeStyle = n.changed ? colors.amber : colors.line;
      ctx.lineWidth = n.changed ? 1.5 : 1;
      ctx.setLineDash(n.label === "spare" ? [3, 4] : []);
      ctx.beginPath();
      ctx.roundRect(x, y, n.w, n.h, 5);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      if (n.role === "cell" && n.label) {
        ctx.fillStyle = colors.muted;
        ctx.textAlign = "center";
        ctx.font = "10px Consolas, monospace";
        ctx.fillText(n.label, x + n.w / 2, y + n.h + 16);
      }
      if (n.role === "scalar") {
        ctx.textAlign = "left";
        ctx.fillStyle = colors.muted;
        ctx.font = "11px Segoe UI, sans-serif";
        ctx.fillText(n.label || "", x + 14, y + 20);
        ctx.fillStyle = n.changed ? colors.amber : colors.text;
        ctx.font = "15px Consolas, monospace";
        ctx.fillText(n.text, x + 14, y + 49);
        if (n.changed) {
          ctx.beginPath();
          ctx.arc(x + n.w - 13, y + 18, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (n.role === "label") {
      ctx.textAlign = "left";
      ctx.fillStyle = colors.text;
      ctx.font = "13px Consolas, monospace";
      ctx.fillText(n.text, x, y + 12);
      if (n.label) {
        ctx.font = "11px Segoe UI, sans-serif";
        ctx.fillStyle = colors.muted;
        ctx.fillText(n.label, x, y + 32);
      }
    } else if (n.role === "pointer") {
      ctx.fillStyle = colors.amber;
      ctx.textAlign = "left";
      ctx.font = "11px Consolas, monospace";
      ctx.fillText(n.text, x, y + 12);
    } else {
      ctx.textAlign = "center";
      ctx.fillStyle = n.changed ? colors.amber : colors.text;
      ctx.font = "15px Consolas, monospace";
      ctx.fillText(n.text, x + n.w / 2, y + n.h / 2);
    }
  }
  if (previous)
    for (const n of previous.nodes)
      if (!current.has(n.key) && progress < 1) node(n, 1 - progress);
  // Boxes precede their moving value tokens, so crossing tokens stay legible.
  for (const n of [
    ...scene.nodes.filter((n) => n.role !== "value"),
    ...scene.nodes.filter((n) => n.role === "value"),
  ])
    node(n, old.has(n.key) || !previous ? 1 : Math.min(1, progress * 3));
  ctx.globalAlpha = 1;
  for (const edge of scene.edges) {
    const prior = oldEdges.get(edge.key);
    const x = prior ? prior.to.x + (edge.to.x - prior.to.x) * ease : edge.to.x,
      y = prior ? prior.to.y + (edge.to.y - prior.to.y) * ease : edge.to.y,
      from = prior
        ? {
            x: prior.from.x + (edge.from.x - prior.from.x) * ease,
            y: prior.from.y + (edge.from.y - prior.from.y) * ease,
          }
        : edge.from;
    ctx.strokeStyle = colors.amber;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    if (edge.transfer) ctx.bezierCurveTo(from.x, from.y - 50, x - 75, y, x, y);
    else ctx.lineTo(x, y);
    ctx.stroke();
    const angle = Math.atan2(
      y - (edge.transfer ? y : from.y),
      x - (edge.transfer ? x - 75 : from.x),
    );
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 7 * Math.cos(angle - 0.45), y - 7 * Math.sin(angle - 0.45));
    ctx.moveTo(x, y);
    ctx.lineTo(x - 7 * Math.cos(angle + 0.45), y - 7 * Math.sin(angle + 0.45));
    ctx.stroke();
    if (edge.transfer) {
      ctx.fillStyle = colors.amber;
      ctx.font = "10px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        edge.label || "",
        (from.x + x) / 2,
        Math.min(from.y, y) - 22,
      );
      if (progress < 1) {
        const t = progress,
          u = 1 - t;
        const px =
          u * u * u * from.x +
          3 * u * u * t * from.x +
          3 * u * t * t * (x - 75) +
          t * t * t * x;
        const py =
          u * u * u * from.y +
          3 * u * u * t * (from.y - 50) +
          3 * u * t * t * y +
          t * t * t * y;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
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
    [replay, setReplay] = useState(0);
  const scene = useMemo(
    () => buildScene(events, selected, source, width < 720 ? width : 1040),
    [events, selected, source, width],
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
      last.current?.frameId === scene.frameId ? last.current : undefined;
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
      draw(ctx, scene, previous, p);
      if (p < 1) request = requestAnimationFrame(render);
    };
    request = requestAnimationFrame(render);
    return () => cancelAnimationFrame(request);
  }, [scene, scale, duration, replay]);
  function inspect(x: number, y: number) {
    const hit = [...scene.nodes]
      .reverse()
      .find((n) => x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h);
    if (hit) onInspect(hit.binding);
  }
  const line = source.split("\n")[(selected?.line || 1) - 1]?.trim();
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
              last.current = buildScene(events, prev, source, scene.width);
              setReplay((r) => r + 1);
            }}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
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
      <div className="canvas-explanation" aria-live="polite" aria-atomic="true">
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
        <span>Amber marks a change · click a value to inspect</span>
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
