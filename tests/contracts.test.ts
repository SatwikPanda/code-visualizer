import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateInput,
  formatValue,
  type TraceEvent,
} from "../packages/contracts/src/index";
import {
  applyEvent,
  changes,
  conditionMarkers,
  conditionExplanation,
} from "../packages/trace-model/src/index";
test("integer inputs remain exact, including long arrays", () => {
  const long = {
    kind: "integer" as const,
    languageType: "long",
    min: "-9223372036854775808",
    max: "9223372036854775807",
  };
  assert.equal(
    validateInput("9223372036854775807", long),
    "9223372036854775807",
  );
  assert.throws(() => validateInput("9223372036854775808", long));
  assert.deepEqual(
    validateInput(["9223372036854775807"], {
      kind: "array",
      languageType: "long[]",
      element: long,
    }),
    ["9223372036854775807"],
  );
  assert.throws(() =>
    validateInput([9223372036854775807], {
      kind: "array",
      languageType: "long[]",
      element: long,
    }),
  );
});
test("null, characters, booleans and whitespace preserve Java meanings", () => {
  assert.equal(
    validateInput("", {
      kind: "string",
      languageType: "String",
      nullable: true,
    }),
    "",
  );
  assert.equal(
    validateInput(null, {
      kind: "string",
      languageType: "String",
      nullable: true,
    }),
    null,
  );
  assert.throws(() =>
    validateInput("😀", { kind: "character", languageType: "char" }),
  );
  assert.throws(() =>
    validateInput("false", { kind: "boolean", languageType: "boolean" }),
  );
  assert.equal(
    formatValue({ kind: "integer", text: "9223372036854775807" }),
    "9223372036854775807",
  );
});
test("replay checkpoints equal sequential state and heap changes are visible", () => {
  const one = {
    id: "f1:v1",
    name: "a",
    type: "int[]",
    value: {
      kind: "array" as const,
      items: [{ kind: "integer" as const, text: "1" }],
    },
  };
  const two = structuredClone(one);
  two.value.items[0].text = "7";
  assert.deepEqual(changes([one], [two]).changed, ["f1:v1"]);
  const e = {
    kind: "observation",
    frameId: "f1",
    variables: [one],
  } as TraceEvent;
  const next = { ...e, variables: [two] };
  const sequential = applyEvent(applyEvent({}, e), next);
  const checkpoint = {
    kind: "checkpoint",
    state: applyEvent({}, e),
  } as TraceEvent;
  assert.deepEqual(applyEvent(applyEvent({}, checkpoint), next), sequential);
  assert.equal(one.value.items[0].text, "1");
});
test("condition badges follow the replay cursor and invocation, with pending values before reevaluation", () => {
  const definition = {
    id: "c1",
    kind: "if" as const,
    expression: "(x > 0)",
    line: 3,
    column: 8,
    endLine: 3,
    endColumn: 15,
    recordable: true,
  };
  const events = [
    {
      seq: 2,
      kind: "observation",
      frameId: "f1",
      phase: "condition",
      line: 3,
      condition: { id: "c1", value: false },
    },
    {
      seq: 3,
      kind: "observation",
      frameId: "f1",
      phase: "before-instruction",
      line: 3,
    },
    {
      seq: 4,
      kind: "observation",
      frameId: "f1",
      phase: "condition",
      line: 3,
      condition: { id: "c1", value: true },
    },
    {
      seq: 5,
      kind: "observation",
      frameId: "f2",
      phase: "condition",
      line: 3,
      condition: { id: "c1", value: false },
    },
  ] as TraceEvent[];
  assert.equal(
    conditionMarkers([definition], events, 1, "f1")[0].value,
    undefined,
  );
  assert.equal(conditionMarkers([definition], events, 2, "f1")[0].value, false);
  assert.equal(
    conditionMarkers([definition], events, 3, "f1")[0].value,
    undefined,
  );
  assert.equal(conditionMarkers([definition], events, 4, "f1")[0].value, true);
  assert.equal(conditionMarkers([definition], events, 5, "f1")[0].value, true);
  assert.equal(conditionMarkers([definition], events, 5, "f2")[0].value, false);
});
test("condition explanations use each captured occurrence and identify skipped operands", () => {
  const expression = "(i++ == 0 && i++ == 1)";
  const marker = {
    id: "c1",
    kind: "if" as const,
    expression,
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 23,
    recordable: true,
    value: true,
    operands: [
      {
        id: "o1",
        expression: "i++",
        start: expression.indexOf("i++"),
        end: expression.indexOf("i++") + 3,
      },
      {
        id: "o2",
        expression: "i++",
        start: expression.lastIndexOf("i++"),
        end: expression.lastIndexOf("i++") + 3,
      },
    ],
    capturedOperands: [
      { id: "o1", value: { kind: "integer" as const, text: "0" } },
      { id: "o2", value: { kind: "integer" as const, text: "1" } },
    ],
  };
  assert.equal(conditionExplanation(marker).substituted, "(0 == 0 && 1 == 1)");
  const skipped = conditionExplanation({
    ...marker,
    capturedOperands: marker.capturedOperands.slice(0, 1),
  });
  assert.equal(skipped.substituted, "(0 == 0 && [skipped] == 1)");
  assert.equal(skipped.operands[1].skipped, true);
  const events = [
    {
      seq: 2,
      frameId: "f1",
      kind: "observation",
      condition: {
        id: marker.id,
        value: true,
        operands: marker.capturedOperands,
      },
    },
  ] as TraceEvent[];
  assert.deepEqual(
    conditionMarkers([marker], events, 2, "f1")[0].capturedOperands,
    marker.capturedOperands,
  );
  assert.equal(
    conditionMarkers([marker], events, 1, "f1")[0].capturedOperands,
    undefined,
  );
});
