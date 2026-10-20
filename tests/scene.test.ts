import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScene,
  previousObservation,
} from "../packages/trace-model/src/scene";
import {
  analysisRequest,
  type TraceEvent,
  type TraceValue,
  type Binding,
} from "../packages/contracts/src/index";
function event(seq: number, variables: Binding[], frameId = "f"): TraceEvent {
  return {
    schemaVersion: 1,
    runId: "r",
    attemptId: "a",
    seq,
    kind: "observation",
    frameId,
    variables,
    line: 1,
    phase: "after-instruction",
  };
}
const array = (items: string[]): TraceValue => ({
  kind: "array",
  refId: "v",
  container: "vector",
  length: items.length,
  capacity: 6,
  items: items.map((text) => ({ kind: "integer", text })),
});
const variable = (name: string, value: TraceValue): Binding => ({
  id: name,
  name,
  type: "auto",
  value,
});
test("C++ is accepted by the API while unknown languages are rejected", () => {
  assert.equal(
    analysisRequest.parse({ source: "int main(){}", languageId: "cpp" })
      .languageId,
    "cpp",
  );
  assert.throws(() =>
    analysisRequest.parse({ source: "x", languageId: "python" }),
  );
});
test("canvas retains value identity through swaps and links real iterators to cells", () => {
  const before = event(1, [variable("values", array(["1", "2", "3"]))]);
  const selected = event(2, [
    variable("values", array(["3", "2", "1"])),
    variable("it", { kind: "iterator", pointsTo: { refId: "v", index: 2 } }),
  ]);
  const old = buildScene([before], before, ""),
    now = buildScene([before, selected], selected, "");
  const token = old.nodes.find((n) => n.role === "value" && n.text === "1")!;
  assert.equal(now.nodes.find((n) => n.key === token.key)?.x, token.x + 136);
  assert.ok(
    now.nodes.some((n) => n.role === "pointer" && n.text === "it → [2]"),
  );
  assert.ok(now.edges.some((e) => e.key === "it:arrow"));
});
test("frames stay independent, removed variables disappear, and truncated/empty containers remain legible", () => {
  const first = event(1, [
    variable("values", array(["1"])),
    variable("gone", { kind: "integer", text: "8" }),
  ]);
  const other = event(2, [], "recursive");
  const current = event(3, [
    variable("values", { ...array([]), length: 120, truncated: true }),
  ]);
  assert.equal(previousObservation([first, other, current], current), first);
  const scene = buildScene([first, other, current], current, "");
  assert.ok(!scene.nodes.some((n) => n.binding.name === "gone"));
  assert.ok(scene.nodes.some((n) => n.text.includes("Empty container")));
  assert.ok(scene.nodes.some((n) => n.text.includes("preview is truncated")));
});
test("index arrows require a source relationship and scalar transfers use a real subscript", () => {
  const current = event(1, [
    variable("values", array(["1", "2"])),
    variable("i", { kind: "integer", text: "1" }),
    variable("total", { kind: "integer", text: "2" }),
  ]);
  assert.ok(
    !buildScene([current], current, "total += 2;").nodes.some(
      (n) => n.role === "pointer",
    ),
  );
  const scene = buildScene([current], current, "total += values[i];");
  assert.ok(
    scene.nodes.some((n) => n.role === "pointer" && n.text === "i → [1]"),
  );
  assert.ok(scene.edges.some((e) => e.transfer && e.label === "read → total"));
});
test("narrow canvases keep full-size labels and put scalars below containers", () => {
  const current = event(1, [
    variable("values", array(["1", "2", "3", "4"])),
    variable("total", { kind: "integer", text: "10" }),
  ]);
  const scene = buildScene([current], current, "", 360);
  assert.equal(scene.width, 360);
  assert.ok(scene.nodes.every((n) => n.role === "label" || n.x + n.w <= 360));
  assert.ok(
    scene.nodes.find((n) => n.role === "scalar")!.y >
      scene.nodes.find((n) => n.role === "cell")!.y,
  );
});
test("coincident pointers retain distinct labels and leaders above their target", () => {
  const selected = event(1, [
    variable("values", array(["4", "2", "6"])),
    variable("left", { kind: "iterator", pointsTo: { refId: "v", index: 0 } }),
    variable("right", { kind: "iterator", pointsTo: { refId: "v", index: 0 } }),
  ]);
  const scene = buildScene([selected], selected, "");
  const pointers = scene.nodes.filter((n) => n.role === "pointer");
  assert.equal(pointers.length, 2);
  assert.ok(Math.abs(pointers[0].y - pointers[1].y) >= 22);
  assert.equal(scene.edges[0].to.x, scene.edges[1].to.x);
  assert.equal(scene.edges[0].to.y, scene.edges[1].to.y);
  assert.notEqual(scene.edges[0].from.y, scene.edges[1].from.y);
});
