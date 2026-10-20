import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CPP_EXAMPLES } from "../../packages/contracts/src/cpp-example";
import type { Analysis, TraceEvent } from "../../packages/contracts/src/index";
process.env.CODEVIZ_BACKEND = "local";
const { cppAdapter } = await import("../../packages/language-cpp/src/adapter");
async function execute(source: string, args: unknown[] = [], method?: string) {
  const job = path.resolve(".data", `cpp-test-${randomUUID()}`),
    signal = new AbortController().signal;
  const analysis = (await cppAdapter.analyze(job, source, signal)) as Analysis;
  assert.equal(analysis.valid, true, JSON.stringify(analysis.diagnostics));
  const entry = method
    ? analysis.entryPoints.find((e) => e.methodName === method)!
    : analysis.entryPoints.find((e) => e.supported)!;
  const events: TraceEvent[] = [];
  await cppAdapter.execute(job, analysis, entry, args, "", signal, (s) =>
    events.push(JSON.parse(s)),
  );
  return {
    analysis,
    events,
    result: events.find((e) => e.kind === "result"),
    observations: events.filter((e) => e.kind === "observation"),
  };
}
test("C++20 vector snapshots include growth, capacity, iterator positions, swap, removal and exact result", async () => {
  const { analysis, events, result, observations } = await execute(
    CPP_EXAMPLES.vector.source,
    CPP_EXAMPLES.vector.args,
  );
  assert.equal(analysis.entryPoints[0].parameters[0].type.kind, "array");
  assert.equal(result?.value?.text, "20");
  const vectors = observations.flatMap((e) =>
    (e.variables || []).filter((v) => v.name === "values").map((v) => v.value),
  );
  assert.ok(vectors.some((v) => v.length === 4 && (v.capacity || 0) >= 4));
  assert.ok(
    vectors.some((v) => v.items?.map((x) => x.text).join(",") === "6,2,4,8"),
  );
  assert.equal(vectors.at(-1)?.length, 3);
  const iterators = observations.flatMap((e) =>
    (e.variables || []).filter((v) => v.name === "it").map((v) => v.value),
  );
  assert.deepEqual(
    [
      ...new Set(
        iterators.map((v) => v.pointsTo?.index).filter((v) => v !== undefined),
      ),
    ],
    [0, 1, 2, 3],
  );
  assert.ok(iterators.some((v) => v.pointsTo?.end));
  assert.ok(events.some((e) => e.kind === "frame-return" && e.root));
});
test("stack/queue and map/range-loop examples run as real native programs", async () => {
  for (const [name, expected] of [
    ["stack", "7"],
    ["map", "6"],
  ] as const) {
    const { result, observations } = await execute(CPP_EXAMPLES[name].source);
    assert.equal(result?.value?.text, expected);
    assert.ok(
      observations.some((e) =>
        e.variables?.some(
          (v) => v.value.container === (name === "stack" ? "stack" : "map"),
        ),
      ),
    );
  }
});
test("single-statement branches, nested scopes, loop controls, side effects and recursion preserve results", async () => {
  const source = `int factorial(int n) { if(n<=1) return 1; return n*factorial(n-1); }
int main() { int total=0; for(int i=0;i<6;++i) { if(i==1) continue; if(i==4) break; total+=i; } int j=0; while(j++<2) total+=j; do { --j; } while(j>0); return total+factorial(4); }`;
  const { result, observations, events } = await execute(source, [], "main");
  assert.equal(result?.value?.text, "32");
  assert.ok(events.filter((e) => e.kind === "frame-enter").length >= 5);
  assert.ok(observations.some((e) => e.condition?.value === false));
});
test("nested vectors, standard algorithms, strings, optional, smart pointers and UTF-8 snapshots", async () => {
  const { result, observations } = await execute(`#include <vector>
#include <algorithm>
#include <string>
#include <optional>
#include <memory>
using namespace std;
int main() { vector<vector<int>> grid={{3,1},{2,4}}; sort(grid[0].begin(),grid[0].end()); string title="café"; optional<int> found=7; auto owned=make_unique<int>(9); return grid[0][0]+*found+*owned; }`);
  assert.equal(result?.value?.text, "17");
  assert.ok(
    observations.some((e) =>
      e.variables?.some((v) => v.name === "title" && v.value.value === "café"),
    ),
  );
  assert.ok(
    observations.some((e) =>
      e.variables?.some(
        (v) => v.name === "grid" && v.value.items?.[0].items?.[0].text === "1",
      ),
    ),
  );
});
test("implicit main return, stdout, exceptions and invalid code have truthful outcomes", async () => {
  const normal = await execute(
    '#include <iostream>\nint main() { std::cout << "hello"; }',
  );
  assert.equal(normal.result?.value?.text, "0");
  assert.ok(
    normal.events.some((e) => e.kind === "output" && e.text === "hello"),
  );
  const failed = await execute(
    '#include <stdexcept>\nint main() { throw std::runtime_error("bad input"); }',
  );
  assert.equal(failed.result?.outcome, "threw");
  assert.equal(failed.result?.error?.message, "bad input");
  const invalid = await cppAdapter.analyze(
    path.resolve(".data", `cpp-invalid-${randomUUID()}`),
    "int main() { broken code; }",
    new AbortController().signal,
  );
  assert.equal(invalid.valid, false);
  assert.ok(invalid.diagnostics?.some((d) => d.severity === "error"));
});
test("structured bindings, fixed arrays, list/deque/set/tuple and boolean vectors have safe previews", async () => {
  const { result, observations } = await execute(`#include <array>
#include <vector>
#include <list>
#include <deque>
#include <set>
#include <map>
#include <tuple>
using namespace std;
int main() { array<int,3> a={1,2,3}; vector<bool> flags={true,false}; list<int> chain={5,6}; deque<int> q={2,4}; set<int> unique={3,3,1}; tuple<int,bool> pair={7,true}; map<int,int> counts={{2,4},{3,5}}; int total=0; for(const auto& [key,val]:counts) total+=key+val; return total+a[0]; }`);
  assert.equal(result?.value?.text, "15");
  assert.ok(
    observations.some((e) => e.variables?.some((v) => v.name === "key")),
  );
  assert.ok(
    observations.some((e) =>
      e.variables?.some(
        (v) => v.name === "flags" && v.value.items?.[0].value === true,
      ),
    ),
  );
});

test("reassigned vector iterators recover after reallocation and map find has an owner", async () => {
  const { result, observations } = await execute(`#include <vector>
#include <map>
int main() { std::vector<int> v={1,2}; auto it=v.begin(); v.reserve(32); it=v.begin(); int first=*it; std::map<int,int> m={{2,3}}; auto found=m.find(2); return first+found->second; }`);
  assert.equal(result?.value?.text, "4");
  const iterators = observations.flatMap((e) =>
    (e.variables || []).filter((v) => v.name === "it").map((v) => v.value),
  );
  assert.ok(iterators.some((v) => v.pointsTo?.invalidated));
  assert.equal(iterators.at(-1)?.pointsTo?.index, 0);
  assert.ok(
    observations.some((e) =>
      e.variables?.some(
        (v) => v.name === "found" && v.value.pointsTo?.index === 0,
      ),
    ),
  );
});
