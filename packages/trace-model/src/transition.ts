import {
  formatValue,
  type Binding,
  type TraceEvent,
  type TraceValue,
} from "../../contracts/src/index";

export type OperationKind =
  | "create"
  | "read"
  | "write"
  | "swap"
  | "reorder"
  | "insert"
  | "remove"
  | "reserve"
  | "iterate"
  | "update"
  | "condition"
  | "return"
  | "observe";
export interface ValueChange {
  id: string;
  name: string;
  before?: TraceValue;
  after: TraceValue;
  indices: number[];
  delta?: string;
}
export interface DataAccess {
  owner: string;
  index: number;
  value: TraceValue;
  destination: string;
  direction: "read" | "write";
  destinationIndex?: number;
}
export interface CanvasOperation {
  kind: OperationKind;
  title: string;
  description: string;
  line?: number;
  changes: ValueChange[];
  accesses: DataAccess[];
  condition?: boolean;
}
export function changePreview(change: ValueChange) {
  const base = {
    label: change.name,
    before: change.before ? formatValue(change.before) : "new",
    after: formatValue(change.after),
  };
  if (change.before?.kind !== "array" || change.after.kind !== "array")
    return base;
  const before = sequenceItems(change.before),
    after = sequenceItems(change.after),
    oldSize = change.before.length ?? before.length,
    newSize = change.after.length ?? after.length;
  if (oldSize !== newSize)
    return { ...base, before: `size ${oldSize}`, after: `size ${newSize}` };
  if (change.after.container === "map" && change.indices.length === 1) {
    const item = after[change.indices[0]],
      key = item?.fields?.key,
      old = before.find(
        (v) => JSON.stringify(v.fields?.key) === JSON.stringify(key),
      );
    return {
      label: `${change.name}[${formatValue(key)}]`,
      before: formatValue(old?.fields?.value),
      after: formatValue(item?.fields?.value),
    };
  }
  if (
    !change.indices.length &&
    change.before.capacity !== change.after.capacity
  )
    return {
      ...base,
      label: `${change.name}.capacity`,
      before: String(change.before.capacity ?? "?"),
      after: String(change.after.capacity ?? "?"),
    };
  if (change.indices.length && change.indices.length <= 2)
    return {
      ...base,
      before: change.indices
        .map((i) => `[${i}] ${formatValue(before[i])}`)
        .join(", "),
      after: change.indices
        .map((i) => `[${i}] ${formatValue(after[i])}`)
        .join(", "),
    };
  return base;
}
const same = (a?: TraceValue, b?: TraceValue) =>
  JSON.stringify(a) === JSON.stringify(b);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function numericDelta(
  before?: TraceValue,
  after?: TraceValue,
): string | undefined {
  if (
    !before ||
    !after ||
    !["integer", "float"].includes(before.kind) ||
    !["integer", "float"].includes(after.kind)
  )
    return;
  if (
    before.kind === "integer" &&
    after.kind === "integer" &&
    /^-?\d+$/.test(before.text || "") &&
    /^-?\d+$/.test(after.text || "")
  ) {
    const delta = BigInt(after.text!) - BigInt(before.text!);
    return delta === 0n ? undefined : `${delta > 0n ? "+" : ""}${delta}`;
  }
  const delta = Number(after.text) - Number(before.text);
  return Number.isFinite(delta) && delta !== 0
    ? `${delta > 0 ? "+" : ""}${Number(delta.toPrecision(6))}`
    : undefined;
}
export function sequenceItems(value?: TraceValue): TraceValue[] {
  return value?.kind === "string"
    ? Array.from(String(value.value ?? "")).map((value) => ({
        kind: "char",
        value,
      }))
    : value?.items || [];
}
/** Explains recorded differences. Source is used only for simple, unambiguous
 * access relationships; expressions are never evaluated or run again. */
export function describeTransition(
  previous: TraceEvent | undefined,
  selected: TraceEvent | undefined,
  source: string,
): CanvasOperation {
  const vars = (selected?.variables || []).filter((v) => v.name !== "this");
  const before = new Map(previous?.variables?.map((v) => [v.id, v.value]));
  const changes = vars
    .filter((v) => !same(before.get(v.id), v.value))
    .map((v) => {
      const old = before.get(v.id),
        now = sequenceItems(v.value),
        was = sequenceItems(old);
      return {
        id: v.id,
        name: v.name,
        before: old,
        after: v.value,
        indices: now.flatMap((item, i) => (same(item, was[i]) ? [] : [i])),
        delta: numericDelta(old, v.value),
      };
    });
  // Java's ordinary observations precede the next line. Its newly observed
  // changes belong to the previous location, unlike C++ after-statement rows.
  const effectLine =
    selected?.phase === "before-instruction" && previous && changes.length
      ? previous.line
      : selected?.line;
  const line = source.split("\n")[(effectLine || 1) - 1] || "";
  const accesses: DataAccess[] = [];
  const arrays = vars.filter((v) => ["array", "string"].includes(v.value.kind));
  const indexOf = (text: string) =>
    /^\d+$/.test(text)
      ? Number(text)
      : Number(vars.find((v) => v.name === text)?.value.text);
  function access(
    owner: Binding,
    index: number,
    destination: string,
    direction: DataAccess["direction"],
  ) {
    if (!Number.isSafeInteger(index) || index < 0) return;
    const value = sequenceItems(
      direction === "read" ? before.get(owner.id) || owner.value : owner.value,
    )[index];
    if (
      value &&
      !accesses.some(
        (a) =>
          a.owner === owner.name &&
          a.index === index &&
          a.destination === destination &&
          a.direction === direction,
      )
    )
      accesses.push({
        owner: owner.name,
        index,
        value,
        destination,
        direction,
      });
  }
  for (const change of changes.filter(
    (c) => !["array", "string", "iterator"].includes(c.after.kind),
  )) {
    const assignment = new RegExp(
      `\\b${escape(change.name)}\\s*(?:[+*/%-]=|=(?!=))`,
    ).exec(line);
    if (!assignment) continue;
    const rhs = line
      .slice(assignment.index + assignment[0].length)
      .split(";")[0];
    for (const array of arrays) {
      const match = rhs.match(
        new RegExp(
          `\\b${escape(array.name)}\\s*(?:\\[\\s*(\\w+)\\s*\\]|\\.(?:get|charAt|at)\\(\\s*(\\w+)\\s*\\))`,
        ),
      );
      if (match)
        access(array, indexOf(match[1] || match[2]), change.name, "read");
      if (
        new RegExp(`\\b${escape(array.name)}\\.(?:front|top)\\(\\)`).test(rhs)
      )
        access(array, 0, change.name, "read");
      if (new RegExp(`\\b${escape(array.name)}\\.back\\(\\)`).test(rhs))
        access(
          array,
          sequenceItems(array.value).length - 1,
          change.name,
          "read",
        );
    }
    for (const v of vars.filter((v) => v.value.kind === "iterator")) {
      const p = v.value.pointsTo;
      if (
        p &&
        !p.end &&
        !p.invalidated &&
        !p.unavailable &&
        new RegExp(`\\*\\s*${escape(v.name)}\\b(?!\\s*(?:\\+\\+|--))`).test(rhs)
      ) {
        const owner = arrays.find((a) => a.value.refId === p.refId);
        if (owner) access(owner, p.index ?? -1, change.name, "read");
      }
    }
  }
  for (const array of arrays) {
    const change = changes.find((c) => c.id === array.id && c.before);
    const match = line.match(
      new RegExp(
        `\\b${escape(array.name)}\\s*\\[\\s*(\\w+)\\s*\\]\\s*=(?!=)\\s*(\\w+)\\s*;`,
      ),
    );
    if (
      change &&
      match &&
      vars.some(
        (v) =>
          v.name === match[2] && !["array", "iterator"].includes(v.value.kind),
      )
    )
      access(array, indexOf(match[1]), match[2], "write");
    if (
      change &&
      (array.value.length ?? sequenceItems(array.value).length) >
        (change.before?.length ?? sequenceItems(change.before).length)
    ) {
      const insertedIndex =
        array.value.container === "stack"
          ? 0
          : sequenceItems(array.value).length - 1;
      const call = line.match(
        new RegExp(
          `\\b${escape(array.name)}\\.push(?:_back)?\\(\\s*(\\w+)\\s*\\)`,
        ),
      );
      if (
        call &&
        vars.some(
          (v) =>
            v.name === call[1] &&
            same(v.value, sequenceItems(array.value)[insertedIndex]),
        )
      )
        access(array, insertedIndex, call[1], "write");
      for (const origin of arrays) {
        const read = line.match(
          new RegExp(
            `\\b${escape(array.name)}\\.push(?:_back)?\\(\\s*${escape(origin.name)}\\.(top|front|back)\\(\\)\\s*\\)`,
          ),
        );
        if (!read) continue;
        const original = sequenceItems(before.get(origin.id) || origin.value),
          index = read[1] === "back" ? original.length - 1 : 0;
        if (
          original[index] &&
          same(original[index], sequenceItems(array.value)[insertedIndex])
        )
          accesses.push({
            owner: origin.name,
            index,
            value: original[index],
            destination: array.name,
            destinationIndex: insertedIndex,
            direction: "read",
          });
      }
    }
  }
  const base = { line: effectLine, changes, accesses };
  if (selected?.condition)
    return {
      ...base,
      kind: "condition",
      title: `Condition is ${selected.condition.value}`,
      description: `The recorded result follows the ${selected.condition.value ? "true" : "false"} path.`,
      condition: selected.condition.value,
    };
  if (!previous)
    return {
      ...base,
      kind: "create",
      title: "Starting state",
      description: "The values available when this invocation begins.",
    };
  if (selected?.phase === "return")
    return {
      ...base,
      kind: "return",
      title: "Return from function",
      description: "These are the values captured at the return step.",
    };
  for (const c of changes.filter(
    (c) => c.after.kind === "array" && c.before?.kind === "array",
  )) {
    const now = sequenceItems(c.after),
      old = sequenceItems(c.before),
      size = c.after.length ?? now.length,
      oldSize = c.before?.length ?? old.length;
    const kind = c.after.container;
    if (size !== oldSize)
      return {
        ...base,
        kind: size > oldSize ? "insert" : "remove",
        title:
          size > oldSize
            ? kind === "stack"
              ? "Push onto stack"
              : kind === "queue"
                ? "Enqueue at the back"
                : kind === "map"
                  ? "Add a map entry"
                  : "Insert an element"
            : kind === "stack"
              ? "Pop from stack"
              : kind === "queue"
                ? "Dequeue from the front"
                : kind === "map"
                  ? "Remove a map entry"
                  : "Remove an element",
        description: `${c.name}: size ${oldSize} → ${size}. ${size > oldSize ? "New values enter in green." : "Removed values leave in coral."}`,
      };
    if (
      c.before?.capacity !== c.after.capacity &&
      same({ kind: "array", items: old }, { kind: "array", items: now })
    )
      return {
        ...base,
        kind: "reserve",
        title: "Container storage changes",
        description: `${c.name}: capacity ${c.before?.capacity ?? "?"} → ${c.after.capacity ?? "?"}. Size stays ${size}.`,
      };
    if (kind === "map" && c.indices.length) {
      const item = now[c.indices[0]],
        key = item?.fields?.key,
        oldItem = old.find((item) => same(item.fields?.key, key));
      return {
        ...base,
        kind: "write",
        title: "Update a map entry",
        description: `${c.name}: ${key ? formatValue(key) : "key"} maps from ${formatValue(oldItem?.fields?.value)} → ${formatValue(item?.fields?.value)}.`,
      };
    }
    if (
      !c.after.truncated &&
      !c.before?.truncated &&
      c.indices.length >= 2 &&
      old.map(formatValue).sort().join("\0") ===
        now.map(formatValue).sort().join("\0")
    ) {
      const swap = c.indices.length === 2 && !/\bsort\s*\(/.test(line);
      return {
        ...base,
        kind: swap ? "swap" : "reorder",
        title: swap ? "Two values exchange places" : "Values are reordered",
        description: `${c.name}: ${swap ? `positions ${c.indices.join(" and ")}` : `${c.indices.length} positions`} change between snapshots.`,
      };
    }
  }
  if (accesses.length)
    return {
      ...base,
      kind: accesses[0].direction,
      title:
        accesses[0].direction === "read"
          ? "Read a value into a variable"
          : "Write a value into a container",
      description: accesses
        .map((a) =>
          a.direction === "read"
            ? `${a.owner}[${a.index}] = ${formatValue(a.value)} → ${a.destination}`
            : `${a.destination} → ${a.owner}[${a.index}] = ${formatValue(a.value)}`,
        )
        .join(" · "),
    };
  const iterator = changes.find((c) => c.after.kind === "iterator");
  if (iterator) {
    const p = iterator.after.pointsTo;
    return {
      ...base,
      kind: "iterate",
      title: p?.end ? "Iterator reaches the end" : "Iterator position changes",
      description: p?.invalidated
        ? `${iterator.name} is invalidated.`
        : p?.unavailable
          ? `${iterator.name}'s position is unavailable.`
          : p?.end
            ? `${iterator.name} is one past the last element; do not dereference it.`
            : `${iterator.name} points to index ${p?.index ?? "?"}.`,
    };
  }
  if (changes.length)
    return {
      ...base,
      kind: "update",
      title: changes.every((c) => !c.before)
        ? "New values are created"
        : "Values are updated",
      description: changes
        .slice(0, 3)
        .map(
          (c) =>
            `${c.name}: ${c.before ? formatValue(c.before) + " → " : ""}${formatValue(c.after)}`,
        )
        .join(" · "),
    };
  return {
    ...base,
    kind: "observe",
    title:
      selected?.phase === "before-instruction"
        ? "Ready for the next instruction"
        : "State is unchanged",
    description:
      "Follow the pointers and highlighted cells, then step forward to see what changes.",
  };
}
