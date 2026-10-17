"use client";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import { useRef, useEffect } from "react";
import type { editor } from "monaco-editor";
import type { ConditionMarker } from "../../../../packages/contracts/src/index";
import { conditionExplanation } from "../../../../packages/trace-model/src/index";
loader.config({ paths: { vs: "/monaco/vs" } });
export default function CodeEditor({
  value,
  onChange,
  line,
  conditions = [],
  readOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  line?: number;
  conditions?: ConditionMarker[];
  readOnly?: boolean;
}) {
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<editor.IEditorDecorationsCollection | null>(null);
  const paint = () => {
    const markers: editor.IModelDeltaDecoration[] = line
      ? [
          {
            range: {
              startLineNumber: line,
              startColumn: 1,
              endLineNumber: line,
              endColumn: 1,
            },
            options: {
              isWholeLine: true,
              className: "current-source-line",
              linesDecorationsClassName: "current-source-gutter",
            },
          },
        ]
      : [];
    for (const condition of conditions) {
      const known = condition.value !== undefined;
      const label = known
        ? String(condition.value).toUpperCase()
        : condition.recordable
          ? "—"
          : "N/A";
      const explanation = known
        ? `Last evaluated **${condition.value}** in the selected invocation at this point in the recording.`
        : condition.recordable
          ? "No result has been recorded for this condition in the selected invocation at this step."
          : condition.reason || "A result is unavailable for this condition.";
      const values = conditionExplanation(condition);
      const compact = values.substituted.replace(/\s+/g, " ");
      const preview =
        compact.length > 72 ? compact.slice(0, 69) + "…" : compact;
      const recorded = known && values.available;
      markers.push({
        range: {
          startLineNumber: condition.endLine,
          startColumn: condition.endColumn,
          endLineNumber: condition.endLine,
          endColumn: condition.endColumn,
        },
        options: {
          after: {
            content: `  ${recorded ? `${preview} → ` : ""}${label} `,
            inlineClassName: `condition-inline ${known ? (condition.value ? "condition-true" : "condition-false") : "condition-pending"}`,
            cursorStops: 3,
          },
          hoverMessage: {
            value: `**${condition.kind} condition**\n\n${explanation}${recorded ? `\n\n${values.operands.map((operand) => `\`${operand.expression.replaceAll("`", "")}\` = ${operand.text}`).join("  \n")}` : ""}`,
          },
          showIfCollapsed: true,
        },
      });
    }
    decorations.current?.set(markers);
    if (line) instance.current?.revealLineInCenterIfOutsideViewport(line);
  };
  useEffect(paint, [line, value, conditions]);
  const mounted: OnMount = (ed, monaco) => {
    instance.current = ed;
    monaco.editor.defineTheme("codeviz", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "858585" },
        { token: "keyword", foreground: "c6b5e5" },
        { token: "string", foreground: "c3d3b0" },
        { token: "number", foreground: "dfc399" },
      ],
      colors: {
        "editor.background": "#1b1b1b",
        "editor.foreground": "#e5e5e5",
        "editorLineNumber.foreground": "#777777",
        "editorLineNumber.activeForeground": "#dddddd",
        "editor.selectionBackground": "#3b3b3b",
        "editorCursor.foreground": "#ededed",
        "editor.lineHighlightBackground": "#242424",
        "editorStickyScroll.background": "#1b1b1b",
        "editorWidget.background": "#252525",
        "editorHoverWidget.background": "#252525",
        "editorHoverWidget.border": "#3a3a3a",
      },
    });
    monaco.editor.setTheme("codeviz");
    decorations.current = ed.createDecorationsCollection();
    paint();
  };
  return (
    <Editor
      height="100%"
      language="java"
      value={value}
      onChange={(v) => onChange(v || "")}
      onMount={mounted}
      loading={<div className="editor-loading">Loading code editor…</div>}
      options={{
        readOnly,
        fontSize: 13,
        lineHeight: 22,
        fontFamily: 'Consolas, "Cascadia Code", monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 18, bottom: 16 },
        automaticLayout: true,
        tabSize: 4,
        renderLineHighlight: "gutter",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        wordWrap: "off",
        smoothScrolling: false,
        accessibilitySupport: "on",
      }}
    />
  );
}
