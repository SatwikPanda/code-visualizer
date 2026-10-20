import {
  formatValue,
  type Binding,
  type TraceEvent,
  type TraceValue,
} from "../../contracts/src/index";

export interface SceneNode {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  label?: string;
  role: "cell" | "value" | "scalar" | "label" | "pointer";
  changed?: boolean;
  binding: Binding;
  detail?: string;
}
export interface SceneEdge {
  key: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  label?: string;
  transfer?: boolean;
}
export interface Scene {
  frameId?: string;
  nodes: SceneNode[];
  edges: SceneEdge[];
  width: number;
  height: number;
  explanation: string[];
  frames: string[];
}
const same = (a?: TraceValue, b?: TraceValue) =>
  JSON.stringify(a) === JSON.stringify(b);
const short = (s: string, n = 16) =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function previousObservation(
  events: TraceEvent[],
  selected?: TraceEvent,
) {
  if (selected)
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (
        e.seq < selected.seq &&
        e.kind === "observation" &&
        e.frameId === selected.frameId
      )
        return e;
    }
  return undefined;
}
export function buildScene(
  events: TraceEvent[],
  selected: TraceEvent | undefined,
  source: string,
  viewportWidth = 1040,
): Scene {
  const width = Math.max(340, Math.min(1040, Math.round(viewportWidth))),
    compact = width < 720;
  const nodes: SceneNode[] = [],
    edges: SceneEdge[] = [],
    explanation: string[] = [];
  const vars = (selected?.variables || []).filter((v) => v.name !== "this");
  const previous = previousObservation(events, selected);
  const before = new Map(previous?.variables?.map((v) => [v.id, v.value]));
  const targets = new Map<
    string,
    {
      x: number;
      y: number;
      cells: { x: number; y: number }[];
      end: { x: number; y: number };
      binding: Binding;
    }
  >();
  const scalarPositions = new Map<string, { x: number; y: number }>();
  let y = 65;
  const sequences = vars.filter(
    (v) => v.value.kind === "array" || v.value.kind === "string",
  );
  const usesIndex = (name: string, variable: string) =>
    new RegExp(
      `\\b${escape(name)}\\s*(?:\\[\\s*${escape(variable)}\\s*\\]|\\.(?:get|charAt)\\(\\s*${escape(variable)}\\s*\\))`,
    ).test(source);
  const scalars = vars.filter(
    (v) => !sequences.includes(v) && v.value.kind !== "iterator",
  );
  function sequence(
    binding: Binding,
    value: TraceValue,
    name: string,
    rootKey: string,
    old = before.get(binding.id),
  ) {
    const items =
      value.kind === "string"
        ? Array.from(String(value.value ?? "")).map(
            (c) => ({ kind: "char", value: c }) as TraceValue,
          )
        : value.items || [];
    const changed = !same(old, value);
    if (items.some((v) => v.kind === "array")) {
      nodes.push({
        key: rootKey + ":label",
        x: 42,
        y,
        w: 660,
        h: 24,
        text: name,
        label: binding.type,
        role: "label",
        binding,
      });
      y += 40;
      items.forEach((row, i) =>
        sequence(
          binding,
          row,
          `${name}[${i}]`,
          rootKey + ":row" + i,
          old?.items?.[i],
        ),
      );
      if (value.truncated) {
        nodes.push({
          key: rootKey + ":truncated",
          x: 60,
          y,
          w: 620,
          h: 22,
          text: `Showing ${items.length} of ${value.length} recorded rows`,
          role: "label",
          binding,
        });
        y += 34;
      }
      return;
    }
    const isStack = value.container === "stack",
      isMap = value.container === "map",
      linked = value.container === "list";
    const length = value.length ?? items.length,
      cellW = isMap ? 136 : 60,
      gap = linked ? 22 : 8,
      columns = isStack
        ? 1
        : Math.max(1, Math.floor((compact ? width - 80 : 690) / (cellW + gap)));
    const shown = items.slice(0, 64),
      rowHeight = 86;
    const pointerCounts = new Map<string, number>();
    for (const v of vars) {
      const p = v.value.pointsTo;
      const index =
        p && p.refId === value.refId && !p.invalidated && !p.unavailable
          ? p.end
            ? "end"
            : String(p.index)
          : v.value.kind === "integer" && usesIndex(name, v.name)
            ? v.value.text
            : undefined;
      if (index !== undefined)
        pointerCounts.set(index, (pointerCounts.get(index) || 0) + 1);
    }
    const pointerLanes = Math.max(1, ...pointerCounts.values());
    const startY = y + 86 + (pointerLanes - 1) * 22,
      cells: { x: number; y: number }[] = [];
    const capacity =
      value.capacity !== undefined ? ` · capacity ${value.capacity}` : "";
    const kind =
      value.kind === "string" ? "string" : value.container || "array";
    nodes.push({
      key: rootKey + ":label",
      x: 42,
      y,
      w: 690,
      h: 30,
      text: name,
      label: `${kind} · size ${length}${capacity}`,
      role: "label",
      binding,
      changed,
    });
    const seen = new Map<string, number>();
    shown.forEach((item, i) => {
      const x = 50 + (i % columns) * (cellW + gap),
        cy = startY + Math.floor(i / columns) * (isStack ? 67 : rowHeight);
      cells.push({ x: x + cellW / 2, y: cy + 24 });
      const v =
        isMap && item.fields
          ? `${formatValue(item.fields.key)} → ${formatValue(item.fields.value)}`
          : formatValue(item);
      const hash = JSON.stringify(item),
        occurrence = seen.get(hash) || 0;
      seen.set(hash, occurrence + 1);
      const itemChanged =
        old?.kind === "array"
          ? !same(old.items?.[i], item)
          : old?.kind === "string"
            ? Array.from(String(old.value))[i] !== item.value
            : changed;
      nodes.push({
        key: rootKey + ":box:" + i,
        x,
        y: cy,
        w: cellW,
        h: 48,
        text: "",
        label: isStack
          ? i === 0
            ? "top"
            : String(i)
          : value.container === "queue"
            ? i === 0
              ? "front"
              : i === shown.length - 1
                ? "back"
                : String(i)
            : value.container === "set"
              ? undefined
              : String(i),
        role: "cell",
        binding,
        changed: itemChanged,
      });
      nodes.push({
        key: rootKey + ":token:" + hash + ":" + occurrence,
        x,
        y: cy,
        w: cellW,
        h: 48,
        text: short(v, isMap ? 20 : 7),
        detail: `${name}[${i}] = ${v}`,
        role: "value",
        binding,
        changed: itemChanged,
      });
      if (linked && i > 0 && i % columns !== 0)
        edges.push({
          key: rootKey + ":link" + i,
          from: { x: x - gap, y: cy + 24 },
          to: { x: x - 3, y: cy + 24 },
        });
    });
    const slots = Math.min(
      Math.max(0, (value.capacity ?? length) - length),
      Math.max(0, columns - shown.length),
    );
    for (let i = 0; i < slots; i++)
      nodes.push({
        key: rootKey + ":reserved" + i,
        x: 50 + (shown.length + i) * (cellW + gap),
        y: startY,
        w: cellW,
        h: 48,
        text: "",
        label: "spare",
        role: "cell",
        binding,
        detail: "Reserved capacity; no element is constructed here",
      });
    const end = {
      x: 50 + (shown.length % columns) * (cellW + gap) + cellW / 2,
      y:
        startY +
        Math.floor(shown.length / columns) * (isStack ? 67 : rowHeight) +
        24,
    };
    targets.set(value.refId || binding.id, {
      x: 50,
      y: startY,
      cells,
      end,
      binding,
    });
    targets.set(name, { x: 50, y: startY, cells, end, binding });
    const rows = Math.max(1, Math.ceil(Math.max(1, shown.length) / columns));
    y = startY + rows * (isStack ? 67 : rowHeight) + 24;
    if (!shown.length) {
      nodes.push({
        key: rootKey + ":empty",
        x: 50,
        y: startY,
        w: 600,
        h: 38,
        text: "Empty container",
        role: "label",
        binding,
      });
    }
    if (value.truncated || items.length > 64) {
      nodes.push({
        key: rootKey + ":truncated",
        x: 50,
        y: y - 10,
        w: 650,
        h: 25,
        text: `Showing ${shown.length} of ${length} elements · preview is truncated`,
        role: "label",
        binding,
      });
      y += 28;
    }
  }
  for (const v of sequences) sequence(v, v.value, v.name, v.id);
  const scalarBase = compact && sequences.length ? y + 12 : 65;
  let scalarY = scalarBase;
  scalars.forEach((v, i) => {
    const scalarCols = compact
      ? Math.max(1, Math.floor((width - 80) / 230))
      : 4;
    const x = sequences.length && !compact ? 790 : 50 + (i % scalarCols) * 230,
      sy =
        sequences.length && !compact
          ? scalarY
          : scalarBase + Math.floor(i / scalarCols) * 110;
    const old = before.get(v.id),
      changed = !same(old, v.value);
    let display = formatValue(v.value);
    if (v.value.fields)
      display = Object.entries(v.value.fields)
        .map(([k, val]) => `${k}: ${formatValue(val)}`)
        .join(", ");
    nodes.push({
      key: v.id + ":scalar",
      x,
      y: sy,
      w: 210,
      h: 78,
      text: short(display, 25),
      label: v.name,
      role: "scalar",
      binding: v,
      changed,
      detail: `${v.name}: ${display}${v.value.reason ? " · " + v.value.reason : ""}`,
    });
    scalarPositions.set(v.name, { x: x + 105, y: sy + 45 });
    if (changed)
      explanation.push(
        old
          ? `${v.name}: ${formatValue(old)} → ${formatValue(v.value)}`
          : `${v.name} is created with ${formatValue(v.value)}`,
      );
    scalarY = Math.max(scalarY, sy + 105);
  });
  let pointerRow = 0;
  const usedPointerLanes = new Map<string, number>();
  const pointer = (
    binding: Binding,
    target: ReturnType<typeof targets.get>,
    index: number | undefined,
    end = false,
    invalid = false,
    unavailable = false,
  ) => {
    const label = unavailable
      ? `${binding.name} · unavailable`
      : invalid
        ? `${binding.name} · invalidated`
        : end
          ? `${binding.name} · end()`
          : `${binding.name} → [${index ?? "?"}]`;
    const pos =
      !invalid && !unavailable && target
        ? end
          ? target.end
          : target.cells[index ?? -1]
        : undefined;
    const laneKey = pos ? `${pos.x}:${pos.y}` : "unavailable";
    const lane = usedPointerLanes.get(laneKey) || 0;
    if (pos) usedPointerLanes.set(laneKey, lane + 1);
    const px = pos
        ? Math.min(width - 140, Math.max(48, pos.x - 28))
        : compact
          ? 50
          : 790,
      py = pos
        ? pos.y - 65 - lane * 22
        : Math.max(scalarY, 65) + pointerRow++ * 50;
    nodes.push({
      key: binding.id + ":pointer",
      x: px,
      y: py,
      w: 130,
      h: 24,
      text: label,
      role: "pointer",
      binding,
      changed: !same(before.get(binding.id), binding.value),
    });
    if (pos)
      edges.push({
        key: binding.id + ":arrow",
        from: {
          x: lane ? Math.min(width - 24, px + 125 + lane * 6) : pos.x,
          y: py + 25,
        },
        to: { x: pos.x, y: pos.y - 27 },
      });
  };
  for (const v of vars) {
    if (v.value.kind === "iterator" && v.value.pointsTo) {
      const p = v.value.pointsTo;
      pointer(
        v,
        targets.get(p.refId),
        p.index,
        p.end,
        p.invalidated,
        p.unavailable,
      );
      if (!same(before.get(v.id), v.value))
        explanation.push(
          `${v.name} ${p.unavailable ? "position is unavailable after a container change" : p.invalidated ? "is invalidated" : p.end ? "reaches end()" : `points to element ${p.index}`}`,
        );
    } else if (v.value.kind === "integer") {
      // Index arrows are grounded in a source subscript, rather than guessing
      // that every small integer is an iterator.
      for (const s of sequences)
        if (usesIndex(s.name, v.name)) {
          const target = targets.get(s.name),
            index = Number(v.value.text);
          if (target && Number.isSafeInteger(index))
            pointer(v, target, index, index === target.cells.length);
        }
    }
  }
  for (const s of sequences) {
    const old = before.get(s.id);
    if (same(old, s.value)) continue;
    const oldLength =
        old?.length ??
        old?.items?.length ??
        (old?.kind === "string" ? String(old.value).length : 0),
      newLength =
        s.value.length ??
        s.value.items?.length ??
        String(s.value.value ?? "").length;
    if (!old)
      explanation.unshift(
        `${s.name} is created with ${newLength} element${newLength === 1 ? "" : "s"}`,
      );
    else if (newLength !== oldLength)
      explanation.unshift(
        `${s.name} ${newLength > oldLength ? "grows" : "shrinks"} from ${oldLength} to ${newLength} elements`,
      );
    else
      explanation.unshift(
        `${s.name} values change · highlighted cells show the update`,
      );
  }
  const sourceLine = source.split("\n")[(selected?.line || 1) - 1] || "";
  const destination = sourceLine.match(
    /\b([A-Za-z_]\w*)\s*(?:\+=|-=|=(?!=))/,
  )?.[1];
  if (
    destination &&
    scalarPositions.has(destination) &&
    selected?.phase !== "before-instruction"
  ) {
    for (const v of vars.filter((x) => x.value.kind === "iterator")) {
      const p = v.value.pointsTo,
        target = p && targets.get(p.refId);
      if (
        p &&
        target &&
        !p.end &&
        !p.invalidated &&
        !p.unavailable &&
        new RegExp(`\\*\\s*${escape(v.name)}\\b`).test(sourceLine)
      ) {
        const from = target.cells[p.index ?? -1];
        if (from)
          edges.push({
            key: "transfer:" + v.id,
            from,
            to: scalarPositions.get(destination)!,
            label: `read → ${destination}`,
            transfer: true,
          });
      }
    }
    for (const s of sequences) {
      const access = sourceLine.match(
        new RegExp(`\\b${escape(s.name)}\\s*\\[\\s*(\\w+)\\s*\\]`),
      );
      if (access) {
        const index = /^\d+$/.test(access[1])
          ? Number(access[1])
          : Number(vars.find((v) => v.name === access[1])?.value.text);
        const from = targets.get(s.name)?.cells[index];
        if (from)
          edges.push({
            key: "transfer:" + s.id,
            from,
            to: scalarPositions.get(destination)!,
            label: `read → ${destination}`,
            transfer: true,
          });
      }
    }
  }
  const active = new Map<string, string>();
  for (const e of events) {
    if (!selected || e.seq > selected.seq) break;
    if (e.kind === "frame-enter" && e.frameId)
      active.set(e.frameId, e.method || "function");
    if ((e.kind === "frame-return" || e.kind === "frame-unwind") && e.frameId)
      active.delete(e.frameId);
  }
  const frames = [...active.values()];
  return {
    frameId: selected?.frameId,
    nodes,
    edges,
    width,
    height: Math.max(280, y, scalarY + pointerRow * 50),
    explanation: explanation.length
      ? explanation
      : [
          selected?.condition
            ? `Condition evaluates to ${selected.condition.value}`
            : selected?.phase === "return"
              ? `${selected.method} returns`
              : "Values are unchanged at this observation",
        ],
    frames,
  };
}
