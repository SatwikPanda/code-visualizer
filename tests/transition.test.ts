import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changePreview,
  describeTransition,
  numericDelta,
} from "../packages/trace-model/src/transition";
import { buildScene } from "../packages/trace-model/src/scene";
import type {
  Binding,
  TraceEvent,
  TraceValue,
} from "../packages/contracts/src/index";
const integer = (text: string): TraceValue => ({ kind: "integer", text });
const array = (
  items: string[],
  container: TraceValue["container"] = "vector",
): TraceValue => ({
  kind: "array",
  container,
  refId: container,
  length: items.length,
  items: items.map(integer),
});
const bind = (name: string, value: TraceValue): Binding => ({
  id: name,
  name,
  type: "auto",
  value,
});
function event(
  seq: number,
  variables: Binding[],
  line = 1,
  phase = "after-instruction",
): TraceEvent {
  return {
    schemaVersion: 1,
    runId: "r",
    attemptId: "a",
    seq,
    kind: "observation",
    frameId: "f",
    line,
    phase,
    variables,
  };
}
test("Java before-line snapshots attribute effects to the prior line and use captured read values", () => {
  const previous = event(
    1,
    [
      bind("a", array(["4", "8"])),
      bind("i", integer("0")),
      bind("total", integer("0")),
    ],
    1,
    "before-instruction",
  );
  const current = event(
    2,
    [
      bind("a", array(["4", "8"])),
      bind("i", integer("0")),
      bind("total", integer("4")),
    ],
    2,
    "before-instruction",
  );
  const operation = describeTransition(
    previous,
    current,
    "total += a[i];\ni++;",
  );
  assert.equal(operation.line, 1);
  assert.equal(operation.kind, "read");
  assert.deepEqual(
    operation.accesses.map((a) => [
      a.owner,
      a.index,
      a.value.text,
      a.destination,
    ]),
    [["a", 0, "4", "total"]],
  );
  assert.equal(operation.changes.find((c) => c.name === "total")?.delta, "+4");
});
test("writes and scalar append operations connect the variable to the changed cell", () => {
  const previous = event(1, [
    bind("a", array(["2", "3"])),
    bind("i", integer("1")),
    bind("temp", integer("9")),
  ]);
  const current = event(2, [
    bind("a", array(["2", "9"])),
    bind("i", integer("1")),
    bind("temp", integer("9")),
  ]);
  const operation = describeTransition(previous, current, "a[i] = temp;");
  assert.equal(operation.kind, "write");
  assert.equal(operation.accesses[0].direction, "write");
  assert.equal(operation.accesses[0].value.text, "9");
  const appended = event(3, [
    bind("a", array(["2", "3", "9"])),
    bind("temp", integer("9")),
  ]);
  const append = describeTransition(previous, appended, "a.push_back(temp);");
  assert.equal(append.kind, "insert");
  assert.equal(append.accesses[0].index, 2);
});
test("stack to queue transfer follows the recorded top and inserted destination", () => {
  const previous = event(1, [
    bind("pending", array(["7", "3"], "stack")),
    bind("ready", array([], "queue")),
  ]);
  const current = event(2, [
    bind("pending", array(["7", "3"], "stack")),
    bind("ready", array(["7"], "queue")),
  ]);
  const operation = describeTransition(
    previous,
    current,
    "ready.push(pending.top());",
  );
  assert.equal(operation.title, "Enqueue at the back");
  assert.equal(operation.accesses[0].destinationIndex, 0);
  const scene = buildScene(
    [previous, current],
    current,
    "ready.push(pending.top());",
  );
  assert.ok(scene.edges.some((e) => e.transfer && e.value === "7"));
  assert.ok(scene.regions.some((r) => r.kind === "stack"));
});
test("swaps, reorders and removals describe differences without guessing truncated contents", () => {
  const previous = event(1, [bind("a", array(["1", "2", "3"]))]);
  assert.equal(
    describeTransition(
      previous,
      event(2, [bind("a", array(["3", "2", "1"]))]),
      "swap(a[0],a[2]);",
    ).kind,
    "swap",
  );
  assert.equal(
    describeTransition(
      previous,
      event(2, [bind("a", array(["3", "1", "2"]))]),
      "sort(a.begin(),a.end());",
    ).kind,
    "reorder",
  );
  assert.equal(
    describeTransition(
      previous,
      event(2, [bind("a", array(["1", "2"]))]),
      "a.pop_back();",
    ).kind,
    "remove",
  );
  assert.notEqual(
    describeTransition(
      previous,
      event(2, [bind("a", { ...array(["3", "2", "1"]), truncated: true })]),
      "sort(a.begin(),a.end());",
    ).kind,
    "swap",
  );
});
test("side-effecting and invalid iterator reads do not invent a transfer", () => {
  const values = [
    bind("a", array(["4", "8"])),
    bind("i", integer("1")),
    bind("total", integer("0")),
    bind("it", {
      kind: "iterator",
      pointsTo: { refId: "vector", invalidated: true },
    }),
  ];
  const previous = event(1, values),
    current = event(
      2,
      values.map((v) => (v.name === "total" ? bind("total", integer("4")) : v)),
    );
  assert.equal(
    describeTransition(previous, current, "total += a[i++];").accesses.length,
    0,
  );
  assert.equal(
    describeTransition(previous, current, "total += *it;").accesses.length,
    0,
  );
});
test("exact integer deltas and numeric bar geometry preserve labels and support negatives", () => {
  assert.equal(
    numericDelta(
      integer("9223372036854775805"),
      integer("9223372036854775807"),
    ),
    "+2",
  );
  const current = event(1, [bind("a", array(["-4", "2", "8"]))]);
  const scene = buildScene([current], current, "", 360, { bars: true });
  const values = scene.nodes.filter((n) => n.role === "value");
  assert.equal(values[0].numeric?.negative, true);
  assert.equal(values[2].numeric?.ratio, 1);
  assert.deepEqual(
    values.map((n) => n.text),
    ["-4", "2", "8"],
  );
  assert.ok(
    buildScene([current], current, "", 360, { bars: false }).nodes.every(
      (n) => !n.numeric,
    ),
  );
});
test("inserted values are marked separately from existing shifted elements", () => {
  const previous = event(1, [bind("a", array(["2", "3"]))]),
    current = event(2, [bind("a", array(["9", "2", "3"]))]);
  const scene = buildScene(
    [previous, current],
    current,
    "a.insert(a.begin(),9);",
  );
  assert.deepEqual(
    scene.nodes.filter((n) => n.role === "value" && n.added).map((n) => n.text),
    ["9"],
  );
});
test("map change summaries expose the changed key instead of truncating unchanged entries", () => {
  const pair = (key: string, text: string): TraceValue => ({
    kind: "object",
    fields: { key: { kind: "string", value: key }, value: integer(text) },
  });
  const previous = event(1, [
    bind("counts", {
      kind: "array",
      container: "map",
      items: [pair("blue", "1"), pair("red", "2")],
      length: 2,
    }),
  ]);
  const current = event(2, [
    bind("counts", {
      kind: "array",
      container: "map",
      items: [pair("blue", "1"), pair("red", "5")],
      length: 2,
    }),
  ]);
  const op = describeTransition(previous, current, 'counts["red"] += 3;');
  assert.equal(op.kind, "write");
  assert.deepEqual(changePreview(op.changes[0]), {
    label: 'counts["red"]',
    before: "2",
    after: "5",
  });
});
