import type {
  Binding,
  TraceEvent,
  ConditionDefinition,
  ConditionMarker,
  ConditionResult,
} from "../../contracts/src/index";
import { formatValue } from "../../contracts/src/index";
export type ReplayState = Record<string, Binding[]>;
export function conditionMarkers(
  definitions: ConditionDefinition[],
  events: TraceEvent[],
  throughSeq: number,
  frameId?: string,
): ConditionMarker[] {
  const results = new Map<string, ConditionResult>();
  for (const event of events) {
    if (event.seq <= throughSeq && event.frameId === frameId && event.condition)
      results.set(event.condition.id, event.condition);
  }
  const current = events.find((event) => event.seq === throughSeq);
  return definitions.map((definition) => {
    const awaitingEvaluation =
      current?.frameId === frameId &&
      current?.phase === "before-instruction" &&
      current.line !== undefined &&
      current.line >= definition.line &&
      current.line <= definition.endLine;
    const result = awaitingEvaluation ? undefined : results.get(definition.id);
    return {
      ...definition,
      value: result?.value,
      capturedOperands: result?.operands,
    };
  });
}
/** Substitute only captured values. Missing operands are short-circuited, never guessed from later locals. */
export function conditionExplanation(marker: ConditionMarker) {
  const values = new Map(
    marker.capturedOperands?.map((operand) => [operand.id, operand.value]),
  );
  const operands = (marker.operands || []).map((operand) => ({
    ...operand,
    text: values.has(operand.id)
      ? formatValue(values.get(operand.id))
      : "not evaluated",
    skipped: !values.has(operand.id),
  }));
  let substituted = marker.expression;
  for (const operand of [...operands].sort((a, b) => b.start - a.start)) {
    const text = operand.skipped
      ? "[skipped]"
      : /^-/.test(operand.text)
        ? `(${operand.text})`
        : operand.text;
    substituted =
      substituted.slice(0, operand.start) +
      text +
      substituted.slice(operand.end);
  }
  return {
    substituted,
    operands,
    available: marker.capturedOperands !== undefined,
  };
}
export function applyEvent(state: ReplayState, event: TraceEvent): ReplayState {
  if (event.kind === "checkpoint" && event.state)
    return structuredClone(event.state);
  if (event.kind === "observation" && event.frameId && event.variables)
    return { ...state, [event.frameId]: event.variables };
  if (event.kind === "frame-unwind" && event.frameId) {
    const next = { ...state };
    delete next[event.frameId];
    return next;
  }
  return state;
}
export function changes(previous: Binding[], current: Binding[]) {
  const before = new Map(previous.map((v) => [v.id, JSON.stringify(v.value)]));
  const now = new Set(current.map((v) => v.id));
  return {
    changed: current
      .filter((v) => before.get(v.id) !== JSON.stringify(v.value))
      .map((v) => v.id),
    removed: previous.filter((v) => !now.has(v.id)).map((v) => v.id),
  };
}
