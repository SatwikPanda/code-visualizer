import type { ConditionMarker } from "../../../../packages/contracts/src/index";
import { conditionExplanation } from "../../../../packages/trace-model/src/index";

export default function ConditionDetails({
  marker,
  current,
  operandSupport = true,
}: {
  marker: ConditionMarker;
  current: boolean;
  operandSupport?: boolean;
}) {
  const known = marker.value !== undefined;
  const explanation = conditionExplanation(marker);
  return (
    <section className="condition-detail" aria-label="Condition values">
      <div className="condition-detail-heading">
        <span>
          {current ? "Condition at this step" : "Last evaluated condition"}
        </span>
        <span className="condition-location">
          {marker.kind} · line {marker.line}
        </span>
        <span
          className={`condition-pill ${known ? (marker.value ? "condition-true" : "condition-false") : "condition-pending"}`}
        >
          {known
            ? String(marker.value).toUpperCase()
            : marker.recordable
              ? "PENDING"
              : "N/A"}
        </span>
      </div>
      <code className="condition-expression">{marker.expression}</code>
      {known && explanation.available ? (
        <>
          <div className="condition-equation" data-testid="condition-equation">
            <code>{explanation.substituted}</code>
            <span aria-hidden="true">→</span>
            <strong
              className={
                marker.value
                  ? "condition-outcome-true"
                  : "condition-outcome-false"
              }
            >
              {String(marker.value)}
            </strong>
          </div>
          {explanation.operands.length > 0 && (
            <div
              className="condition-operands"
              aria-label="Recorded operand values"
            >
              {explanation.operands.map((operand) => (
                <span
                  key={operand.id}
                  className={operand.skipped ? "operand-skipped" : ""}
                >
                  <code>{operand.expression}</code>
                  <span>=</span>
                  <code>{operand.text}</code>
                </span>
              ))}
            </div>
          )}
          {explanation.operands.some((operand) => operand.skipped) && (
            <p>Skipped operands were not evaluated on this path.</p>
          )}
        </>
      ) : (
        <p>
          {!marker.recordable
            ? marker.reason
            : known
              ? operandSupport
                ? "Operand values are missing from this older recording. Run the program again to capture them."
                : "This is the recorded C++ condition result. Individual operand previews are not captured."
              : operandSupport
                ? "Step forward to see the values used when this condition is evaluated."
                : "Step forward to see the recorded condition result."}
        </p>
      )}
    </section>
  );
}
