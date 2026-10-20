import type {
  Scene,
  SceneNode,
} from "../../../../packages/trace-model/src/scene";

const ink = {
  bg: "#1b1b1b",
  box: "#252525",
  line: "#505050",
  text: "#ececec",
  muted: "#a7a7a7",
  amber: "#e5bd82",
  green: "#8ed6ac",
  red: "#e6a09b",
};
const mono = 'Consolas, "Cascadia Code", monospace';
function fitted(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(value + "…").width > max)
    value = value.slice(0, -1);
  return value + "…";
}
function arrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 6 * Math.cos(a - 0.45), y2 - 6 * Math.sin(a - 0.45));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 6 * Math.cos(a + 0.45), y2 - 6 * Math.sin(a + 0.45));
  ctx.stroke();
}
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  previous: Scene | undefined,
  progress: number,
) {
  ctx.clearRect(0, 0, scene.width, scene.height);
  const ease = 1 - Math.pow(1 - progress, 4),
    old = new Map(previous?.nodes.map((n) => [n.key, n])),
    current = new Set(scene.nodes.map((n) => n.key));
  const oldEdges = new Map(previous?.edges.map((e) => [e.key, e]));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Container geometry gives the individual cells a recognizable structure.
  for (const r of scene.regions) {
    ctx.strokeStyle = ink.line;
    ctx.fillStyle = ink.muted;
    ctx.lineWidth = 1;
    ctx.font = `10px ${mono}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (r.kind === "stack") {
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x, r.y + r.h);
      ctx.lineTo(r.x + r.w, r.y + r.h);
      ctx.lineTo(r.x + r.w, r.y);
      ctx.stroke();
      ctx.fillText("LIFO · last in, first out", r.x + r.w + 18, r.y - 18);
    } else if (r.kind === "queue") {
      arrow(ctx, r.x, r.y + r.h + 30, r.x + r.w, r.y + r.h + 30);
      ctx.fillText("FIFO · first in, first out", r.x, r.y + r.h + 46);
    } else if (r.size > 0 && r.kind !== "map") {
      ctx.beginPath();
      const y = r.y + r.h + 24;
      ctx.moveTo(r.x, y - 5);
      ctx.lineTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
      ctx.lineTo(r.x + r.w, y - 5);
      ctx.stroke();
    }
  }
  function node(n: SceneNode, opacity = 1, exiting = false) {
    const p = old.get(n.key),
      moving = !!p && (p.x !== n.x || p.y !== n.y);
    let x = p ? p.x + (n.x - p.x) * ease : n.x,
      y = p ? p.y + (n.y - p.y) * ease : n.y;
    if (n.role === "value" && moving)
      y -=
        Math.sin(Math.PI * ease) *
        Math.min(38, Math.abs(n.x - p!.x) * 0.2 + 10) *
        (n.x >= p!.x ? 1 : -1);
    if (!p && previous && n.role === "value" && !exiting) {
      y -= 26 * (1 - ease);
      opacity *= ease;
    }
    if (exiting) {
      y -= 24 * ease;
      opacity *= 1 - progress;
    }
    ctx.globalAlpha = opacity;
    ctx.textBaseline = "middle";
    ctx.font = `13px ${mono}`;
    const color = exiting
      ? ink.red
      : n.added && n.changed
        ? ink.green
        : n.focus === "write"
          ? ink.green
          : n.focus || n.changed
            ? ink.amber
            : ink.text;
    if (n.role === "cell" || n.role === "scalar") {
      ctx.fillStyle =
        n.focus === "write" || (n.added && n.changed)
          ? "#24322b"
          : n.focus
            ? "#342e24"
            : ink.box;
      ctx.strokeStyle =
        n.added && n.changed
          ? ink.green
          : n.focus || n.changed
            ? ink.amber
            : ink.line;
      ctx.lineWidth = n.focus ? 2 : 1;
      ctx.setLineDash(n.label === "spare" ? [3, 4] : []);
      ctx.beginPath();
      ctx.roundRect(x, y, n.w, n.h, 5);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      if (n.numeric) {
        const ratio =
          (p?.numeric?.ratio ?? n.numeric.ratio) +
          (n.numeric.ratio - (p?.numeric?.ratio ?? n.numeric.ratio)) * ease;
        const baseline = n.numeric.signed ? y + 43 : y + n.h - 32,
          barHeight = Math.max(1, ratio * (n.numeric.signed ? 27 : 56));
        ctx.fillStyle =
          n.added && n.changed
            ? "#57946d"
            : n.focus || n.changed
              ? "#a1814f"
              : "#666a71";
        ctx.fillRect(
          x + 12,
          n.numeric.negative ? baseline : baseline - barHeight,
          n.w - 24,
          barHeight,
        );
        ctx.strokeStyle = ink.muted;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x + 7, baseline);
        ctx.lineTo(x + n.w - 7, baseline);
        ctx.stroke();
      }
      if (n.role === "cell") {
        if (n.label) {
          ctx.fillStyle = n.focus ? ink.amber : ink.muted;
          ctx.font = `11px ${mono}`;
          ctx.textAlign = n.sideLabel ? "left" : "center";
          ctx.fillText(
            n.label,
            n.sideLabel ? x + n.w + 12 : x + n.w / 2,
            n.sideLabel ? y + n.h / 2 : y + n.h + 17,
          );
        }
        if (n.changed) {
          ctx.fillStyle = n.added ? ink.green : ink.amber;
          ctx.beginPath();
          ctx.arc(x + n.w - 7, y + 7, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.textAlign = "left";
        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.fillStyle = ink.muted;
        ctx.fillText(
          fitted(ctx, n.label || "", n.delta ? 115 : 180),
          x + 14,
          y + 19,
        );
        if (n.delta) {
          ctx.font = `10px ${mono}`;
          ctx.fillStyle = ink.amber;
          ctx.textAlign = "right";
          ctx.fillText(fitted(ctx, n.delta, 66), x + n.w - 12, y + 19);
        }
        ctx.textAlign = "left";
        ctx.font = `18px ${mono}`;
        ctx.fillStyle = color;
        if (n.oldText && previous && progress < 1) {
          ctx.globalAlpha = opacity * (1 - ease);
          ctx.fillText(
            fitted(ctx, n.oldText, n.w - 28),
            x + 14,
            y + 47 - 12 * ease,
          );
          ctx.globalAlpha = opacity * ease;
        }
        ctx.fillText(
          fitted(ctx, n.text, n.w - 28),
          x + 14,
          y + 47 + (n.oldText && previous ? 12 * (1 - ease) : 0),
        );
        ctx.globalAlpha = opacity;
        if (n.oldText) {
          ctx.font = `10px ${mono}`;
          ctx.fillStyle = ink.muted;
          ctx.fillText(
            fitted(ctx, `was ${n.oldText}`, n.w - 28),
            x + 14,
            y + 72,
          );
        }
        if (n.changed && !n.delta) {
          ctx.fillStyle = ink.amber;
          ctx.beginPath();
          ctx.arc(x + n.w - 13, y + 18, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (n.role === "label") {
      ctx.textAlign = "left";
      ctx.fillStyle = ink.text;
      ctx.font = `15px ${mono}`;
      ctx.fillText(fitted(ctx, n.text, scene.width - x - 20), x, y + 12);
      if (n.label) {
        ctx.font = '11px "Segoe UI", sans-serif';
        ctx.fillStyle = ink.muted;
        ctx.fillText(fitted(ctx, n.label, scene.width - x - 20), x, y + 32);
      }
    } else if (n.role === "pointer") {
      ctx.textAlign = "left";
      ctx.font = `11px ${mono}`;
      const w = Math.min(n.w, ctx.measureText(n.text).width + 12);
      ctx.fillStyle = "#342e24";
      ctx.beginPath();
      ctx.roundRect(x - 5, y - 1, w, 25, 4);
      ctx.fill();
      ctx.fillStyle = ink.amber;
      ctx.fillText(fitted(ctx, n.text, n.w - 10), x, y + 12);
    } else {
      ctx.textAlign = "center";
      ctx.fillStyle = color;
      if (n.mapKey !== undefined) {
        ctx.font = `12px ${mono}`;
        ctx.fillStyle = ink.muted;
        ctx.fillText(fitted(ctx, n.mapKey, n.w - 20), x + n.w / 2, y + 19);
        ctx.fillStyle = color;
        ctx.font = `16px ${mono}`;
        ctx.fillText(
          fitted(ctx, n.mapValue || "", n.w - 20),
          x + n.w / 2,
          y + 47,
        );
        ctx.strokeStyle = ink.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 12, y + 32);
        ctx.lineTo(x + n.w - 12, y + 32);
        ctx.stroke();
      } else {
        ctx.font = `${n.numeric ? 14 : 17}px ${mono}`;
        ctx.fillText(
          fitted(ctx, n.text, n.w - 10),
          x + n.w / 2,
          y + (n.numeric ? n.h - 15 : n.h / 2),
        );
      }
    }
  }
  for (const n of scene.nodes.filter((n) => n.role !== "value"))
    node(n, old.has(n.key) || !previous ? 1 : Math.min(1, progress * 3));
  // Removed tokens remain above the empty slots while they leave the recording.
  if (previous && progress < 1)
    for (const n of previous.nodes)
      if (n.role === "value" && !current.has(n.key)) node(n, 1, true);
  for (const n of scene.nodes.filter((n) => n.role === "value")) node(n);
  ctx.globalAlpha = 1;
  for (const edge of scene.edges) {
    const prior = oldEdges.get(edge.key),
      from = prior
        ? {
            x: prior.from.x + (edge.from.x - prior.from.x) * ease,
            y: prior.from.y + (edge.from.y - prior.from.y) * ease,
          }
        : edge.from;
    const to = prior
      ? {
          x: prior.to.x + (edge.to.x - prior.to.x) * ease,
          y: prior.to.y + (edge.to.y - prior.to.y) * ease,
        }
      : edge.to;
    ctx.strokeStyle = edge.direction === "write" ? ink.green : ink.amber;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = edge.transfer ? 1.7 : 1.3;
    if (!edge.transfer) {
      arrow(ctx, from.x, from.y, to.x, to.y);
      continue;
    }
    const c1 = { x: from.x, y: Math.min(from.y, to.y) - 48 },
      c2 = { x: to.x - 75, y: to.y };
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -progress * 20;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    arrow(ctx, to.x - 8, to.y, to.x, to.y);
    ctx.font = `13px ${mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = fitted(
        ctx,
        edge.value || "value",
        Math.min(180, scene.width - 40),
      ),
      w = Math.max(34, ctx.measureText(label).width + 20);
    const pointAt = (t: number) => {
      const u = 1 - t;
      return {
        x:
          u ** 3 * from.x +
          3 * u * u * t * c1.x +
          3 * u * t * t * c2.x +
          t ** 3 * to.x,
        y:
          u ** 3 * from.y +
          3 * u * u * t * c1.y +
          3 * u * t * t * c2.y +
          t ** 3 * to.y,
      };
    };
    let badge = pointAt(progress < 1 ? progress : 0.5);
    if (progress === 1) {
      // Rest in a clear part of the route; the midpoint can sit on an index row
      // when the destination moves below its source on compact canvases.
      const candidates = [0.5, 0.6, 0.4, 0.7, 0.3, 0.8, 0.2].map(pointAt);
      const clear = (p: { x: number; y: number }) =>
        p.x - w / 2 >= 8 &&
        p.x + w / 2 <= scene.width - 8 &&
        p.y >= 18 &&
        p.y <= scene.height - 18 &&
        !scene.nodes.some((n) => {
          const bottom =
            n.y +
            n.h +
            (n.role === "cell" && n.label && !n.sideLabel
              ? 25
              : n.role === "label"
                ? 14
                : 0);
          return (
            p.x + w / 2 + 4 > n.x &&
            p.x - w / 2 - 4 < n.x + n.w &&
            p.y + 19 > n.y &&
            p.y - 19 < bottom
          );
        });
      const onRoute = candidates.find(clear);
      const resting =
        onRoute ||
        candidates
          .flatMap((p) =>
            [80, -80, 160, -160].map((offset) => ({ x: p.x + offset, y: p.y })),
          )
          .find(clear);
      if (resting) {
        if (!onRoute) {
          const anchor = candidates.find((p) => p.y === resting.y)!;
          ctx.beginPath();
          ctx.moveTo(anchor.x, anchor.y);
          ctx.lineTo(resting.x, resting.y);
          ctx.stroke();
        }
        badge = resting;
      }
    }
    const { x: px, y: py } = badge;
    ctx.fillStyle = ink.bg;
    ctx.beginPath();
    ctx.roundRect(px - w / 2, py - 15, w, 30, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = edge.direction === "write" ? ink.green : ink.amber;
    ctx.fillText(label, px, py);
  }
  ctx.globalAlpha = 1;
}
