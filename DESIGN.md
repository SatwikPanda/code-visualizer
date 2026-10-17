---
name: Code Visualizer
description: A neutral charcoal workspace for following real Java execution and recorded condition values.
colors:
  bg: "#181818"
  panel: "#202020"
  raised: "#2c2c2c"
  line: "#343434"
  text: "#ececec"
  secondary: "#a7a7a7"
  accent: "#e5e5e5"
  success: "#8ed6ac"
  amber: "#e5bd82"
  error: "#e6a09b"
  rail: "#1d1d1d"
  history: "#1b1b1b"
  navigation-line: "#303030"
typography:
  headline:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "19px"
    fontWeight: 560
    letterSpacing: "-0.025em"
  body:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    lineHeight: 1.5
  label:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 550
  rail-label:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "9px"
  history-heading:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 600
  code:
    fontFamily: 'Consolas, "Cascadia Code", monospace'
    fontSize: "13px"
    lineHeight: "22px"
  value:
    fontFamily: 'Consolas, "Cascadia Code", monospace'
    fontSize: "11px"
  field:
    fontFamily: 'Consolas, "Cascadia Code", monospace'
    fontSize: "12px"
    lineHeight: "20px"
  condition-inline:
    fontFamily: 'Consolas, "Cascadia Code", monospace'
    fontSize: "10px"
    fontWeight: 600
  condition-pill:
    fontFamily: 'Consolas, "Cascadia Code", monospace'
    fontSize: "10px"
    lineHeight: "18px"
  condition-equation:
    fontFamily: 'Consolas, "Cascadia Code", monospace'
    fontSize: "13px"
  condition-operand:
    fontFamily: 'Consolas, "Cascadia Code", monospace'
    fontSize: "10px"
  result:
    fontFamily: 'Consolas, "Cascadia Code", monospace'
    fontSize: "29px"
    fontWeight: 400
rounded:
  condition: "3px"
  tag: "4px"
  icon: "5px"
  field: "6px"
  button: "7px"
  alert: "8px"
  language-choice: "9px"
  panel: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  panel-gap: "18px"
  section-gap: "20px"
  xl: "24px"
  desktop-edge: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#202020"
    rounded: "{rounded.button}"
    padding: "0 13px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "#ffffff"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.button}"
    padding: "0 13px"
    typography: "{typography.label}"
  button-secondary-hover:
    backgroundColor: "#363636"
  button-subtle:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    rounded: "{rounded.button}"
    padding: "0 13px"
  button-danger:
    backgroundColor: "#372422"
    textColor: "{colors.error}"
    rounded: "{rounded.button}"
    padding: "0 13px"
  field:
    backgroundColor: "#1b1b1b"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "9px 10px"
    typography: "{typography.field}"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
  tag:
    backgroundColor: "#303030"
    textColor: "{colors.secondary}"
    rounded: "{rounded.tag}"
    padding: "1px 6px"
  navigation-active:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
  trace-observation:
    backgroundColor: "#343434"
    textColor: "{colors.text}"
    typography: "{typography.value}"
  condition-true:
    backgroundColor: "#28362e"
    textColor: "{colors.success}"
    typography: "{typography.condition-inline}"
    rounded: "{rounded.condition}"
    padding: "1px 3px"
  condition-false:
    backgroundColor: "#3a2b2b"
    textColor: "{colors.error}"
    typography: "{typography.condition-inline}"
    rounded: "{rounded.condition}"
    padding: "1px 3px"
  condition-pending:
    backgroundColor: "#303030"
    textColor: "{colors.secondary}"
    typography: "{typography.condition-inline}"
    rounded: "{rounded.condition}"
    padding: "1px 3px"
  condition-detail:
    backgroundColor: "#242424"
    padding: "14px 18px 16px"
  condition-pill:
    typography: "{typography.condition-pill}"
    rounded: "{rounded.condition}"
    padding: "0 5px"
  language-rail:
    backgroundColor: "{colors.rail}"
    width: "56px"
    padding: "18px 6px"
  language-choice:
    backgroundColor: "{colors.navigation-line}"
    textColor: "{colors.text}"
    width: "42px"
    rounded: "{rounded.language-choice}"
    typography: "{typography.rail-label}"
  history-sidebar:
    backgroundColor: "{colors.history}"
    width: "248px"
    padding: "0 8px"
  history-item:
    backgroundColor: "transparent"
    textColor: "#d5d5d5"
    rounded: "{rounded.button}"
    padding: "10px"
  history-item-active:
    backgroundColor: "{colors.navigation-line}"
    textColor: "{colors.text}"
  new-execution:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "0 11px"
---

# Design System: Code Visualizer

## Overview

**Creative North Star: "The Execution Workspace"**

A neutral charcoal workspace supports sustained code reading. Off-white identifies the primary action, selection, and focus; warm amber identifies changed values. Green and coral distinguish recorded true and false condition outcomes. The interface begins with the work itself, without a separate brand header.

Controls remain compact and familiar. System UI type carries the interface while monospace carries source, signatures, measured values, and results. This document records the implemented visual system in `apps/web/src/app/globals.css`, `Workspace.tsx`, `CodeEditor.tsx`, `ConditionDetails.tsx`, and `ExecutionNavigation.tsx`.

**Key Characteristics:**
- Neutral charcoal surfaces with restrained tonal layering.
- Off-white control and selection cues, with semantic color for condition outcomes and changes.
- Compact controls around a wide, readable observation table.
- Source and values connected through one replay position.

## Colors

The palette uses neutral charcoal surfaces with off-white controls and restrained semantic colors. The frontmatter preserves the root CSS custom-property names and their normative values, together with the extracted navigation surfaces.

### Primary
- **Control Chalk** (`accent`): primary run action, focus outlines, current source gutter, selected observation marker, active navigation, completion status, and returned values.

### Secondary
- **Condition Green** (`success`): recorded true condition badges and true outcomes in the condition explanation.
- **Change Amber** (`amber`): changed values and their dots, edited-source tags, and the Java language marker.
- **Error Coral** (`error`): diagnostics, exception content, stop-run control, error banners, and false condition results.

### Neutral
- **Charcoal Ground** (`bg`): application background.
- **Charcoal Panel** (`panel`): source, inputs, trace, and output surfaces.
- **Raised Charcoal** (`raised`): secondary controls and the floating value inspector.
- **Structural Grey** (`line`): dividers and panel borders.
- **Reading Chalk** (`text`): main interface text and values.
- **Secondary Grey** (`secondary`): labels, metadata, hints, and inactive navigation.
- **Language Rail Charcoal** (`rail`): the slim language selector surface.
- **History Charcoal** (`history`): the adjacent execution-history surface.
- **Navigation Grey** (`navigation-line`): sidebar dividers and the selected language/history entry backgrounds.

**The Change Cue Rule.** Changed values carry both amber text and a dot. Preserve that second cue when adding trace states.

## Typography

The interface uses the body stack from the frontmatter; Inter is optional and falls back to the operating system. Source and measured values use the mono stack. Avoid introducing a display font into the workspace.

- **Headline:** the workspace title uses the 19px headline role at every breakpoint.
- **Body:** the base role supports compact tool content. Explanatory copy commonly reduces to 11px.
- **Label:** buttons and panel labels use the label role. Metadata and field hints use 9–11px.
- **Code:** Monaco uses the code role with four-space tabs, no minimap, no word wrapping, and no smooth scrolling.
- **Value:** table values, parameter values, and type information use monospace. The table uses tabular numerals.
- **Result:** the return value uses the larger result role with the off-white accent.

## Layout

The app shell uses three desktop columns: `56px 248px minmax(0, 1fr)` for the language rail, execution history, and workspace. Both navigation surfaces are sticky at the top and occupy 100dvh; the execution list scrolls independently between its controls and retention note. The workspace is centered within its remaining column with a maximum width of 1760px. Desktop horizontal padding uses `desktop-edge` and vertical padding is 24px. The local-mode notice, when applicable, precedes the workspace toolbar; there is no separate Code Visualizer brand header. Source and inputs share an upper grid with `minmax(0, 1.58fr) minmax(320px, 1fr)` and the `panel-gap` spacing. Trace and output span the available width beneath it. Panel headings are 49px tall.

At widths up to 1180px, persistent execution history becomes a drawer, leaving `56px minmax(0, 1fr)` for the rail and workspace. The drawer starts 56px from the left edge and is 270px wide. At widths up to 900px, the language rail becomes a horizontal 56px-high bar with Java and Executions controls; the drawer starts at the left viewport edge and uses `min(300px, calc(100vw - 40px))` width.

At widths up to 1100px, workspace padding becomes 20px on all sides, the upper grid becomes `minmax(0, 1.25fr) minmax(300px, 1fr)`, and its gap becomes 14px. At widths up to 900px, workspace padding becomes 16px at the top, 14px horizontally, and 20px at the bottom and a four-item Code / Inputs / Trace / Output navigation shows one panel at a time. Toolbar controls remain visible above the panel navigation. The selected-values strip is hidden on this layout.

The editor is 439px tall by default, 470px from 1500px upward, and 410px in the mobile layout. The trace scroll region is capped at 352px by default, 420px on large screens, and 390px in the mobile layout. Keep horizontal scrolling inside the trace table; its header and first two columns (Step and Line) stay pinned. Table rows are 39px tall and headers are 36px tall.

## Elevation & Depth

Panels are flat: a single border and darker inset source, table, and field surfaces provide depth. The floating inspector is the only substantial raised layer, with `0 12px 35px #0008` shadow and a stronger border. It sits 24px from the lower-right corner, uses a 390px preferred width, is constrained to `calc(100vw - 40px)`, and scrolls within 70vh.

The compact execution drawer uses a dim backdrop (`#0007`) and a border rather than a shadow. Its layer sits above the workspace; the persistent history surface remains flat.

**The Flat Panel Rule.** Use tonal separation and borders for persistent workspace panels. Reserve the existing shadow treatment for the floating inspector.

## Shapes

Panels use the panel radius. Fields, badges, buttons, and small tags use their smaller named radius roles. Borders are consistently thin (1px); selected navigation adds a bottom stroke. Status and change markers are small circles. Avoid applying panel-sized rounding to compact metadata or table cells.

## Components

### Buttons

Primary, secondary, subtle, and danger buttons share a 36px minimum height, label typography, an 8px icon gap, and the button radius. Primary is off-white with dark ink. Secondary is raised charcoal with a stronger border. Subtle is transparent with secondary text. Danger is coral on a muted red field and appears while a run can be stopped. Compact controls reduce to a 30px minimum height and 11px type.

Background hover transitions last 150ms. Disabled buttons use 40% opacity and a blocked cursor. Focus-visible outlines use the off-white accent (2px) with a 4px offset. Icon playback controls are 28px square, reducing to 24px wide in the mobile layout.

### Panels and fields

Panel headers separate file, method-input, trace, and output content using a border. Inputs have a dark inset background, 1px stroke, field radius, and mono values. Textareas allow vertical resizing and use an off-white caret. Parameter types appear as small tags; a separate checkbox supplies explicit null values. Disabled parameter fields reduce their text contrast and opacity. Compile diagnostics appear below source, and operational failures appear in a dismissible alert.

### Navigation

Mobile panel navigation uses four equal-width buttons with icons, secondary text at rest, and off-white text plus a 2px lower border when selected. Result / stdout / stderr tabs remain within the output panel and use a thinner selected underline. Preserve the active panel and replay position across navigation.

### Language rail and execution history

Java is selected by default in the slim rail. Its cup icon is inline SVG with a small amber steam detail; the selected control is 42px wide with a 62px minimum height, a 9px radius, and a 9px label. In the horizontal mobile rail it becomes a compact row with an 11px label. The adjacent history surface has an Executions heading, refresh icon, New execution action, date groups (Today, Yesterday, Earlier), and a fixed retention note. The close control is visible only in the drawer layout.

History entries use two compact lines: a 12px method/input title, then a status icon, outcome, and time. Titles and outcomes truncate within the sidebar; hover text exposes the stored method/input preview, timestamp, and outcome. The argument preview is bounded at 180 characters; reopening the execution restores its full inputs. The active entry uses the selected navigation background and `aria-current`; failed outcomes use coral. Entries use 10px padding, a 7px radius, and a subtle hover surface. Loading, empty, retry, and Load earlier executions states remain within the history surface.

Opening an entry restores its recorded source, parameter values including nulls, standard input, trace, and result. New execution clears the selected run and playback state while preserving current source and inputs. Execution switching and New execution are disabled while execution is active. History summaries come from the server in pages of 30 and are retained for 24 hours; the sidebar replaces the former footer run dropdown.

The compact drawer closes through its close button, backdrop, Escape, a successful entry selection, or New execution. It traps keyboard focus while open, prevents background scrolling, and restores focus to the opening control on close. Keep the off-white focus-visible treatment on all sidebar actions.

### Execution trace and playback

A selected row has a lighter charcoal background and an off-white arrow beside its step number. Changed cells use the Change Cue Rule. Hover adds a quiet tonal shift. Missing values use an em dash. Long values truncate in the table; selecting a value opens the inspector with its full JSON representation.

First, previous, play/pause, next, last, seek, and speed controls navigate the recorded observations. Row selection and the return-line link show the saved run source and synchronize its highlighted line. Returning from Output to the return line selects Trace in the mobile layout. Edited source remains available through Back to editor. Changes-only, setup-call, and invocation filters reset the replay cursor.

### Condition markers

Inline source markers append the recorded operand substitution followed by an arrow and uppercase TRUE or FALSE after each condition expression. The compact substitution preview is limited to 72 characters; hover content exposes the individual captured operands. They show the latest recorded result for the selected invocation at the replay cursor. Before that condition is evaluated again, the marker returns to the neutral pending em dash (—); conditions with no recorded result also remain pending. N/A uses the same neutral treatment and a hover explanation for unsupported Java flow-sensitive conditions.

The condition variants in the frontmatter define the green, coral, and neutral text/background pairs. Inline markers use 10px semibold monospace, the condition radius, `1px 3px` padding, and a 6px left margin. Trace-table condition pills use lowercase `true` / `false`, 10px monospace, 18px line height, `0 5px` padding, and the same radius and color pairs. A second line in each condition source cell displays the recorded substituted expression in secondary 9px monospace with 14px line height. Hover text includes that substitution and explains that values were captured once, after evaluation.

The table's third header is **Source**. Condition observations represent the **after-expression** phase; ordinary line observations represent the **before-instruction** phase. Keep these timings explicit when explaining or extending the trace.

### Recorded condition values

A flat charcoal detail strip sits above playback. It identifies the condition at the selected step, or the latest evaluated condition in the selected invocation when the cursor is elsewhere. The strip shows the original expression, its captured-value substitution, the boolean outcome, and individual operand/value pairs. Its heading and location use system UI type; expressions, substitutions, and operands use monospace. The equation uses 13px type and the operand list uses 10px type, wrapping within the available width.

Only values captured during that evaluation are substituted. Short-circuited operands display **not evaluated** in the operand list and **[skipped]** in the substituted expression. Pending conditions explain that the user can step forward; unsupported conditions show their N/A reason. Older recordings that lack captured operands explain that a new run is required. Preserve those states instead of filling gaps from later local-variable values.

### Result and status

The return value is visually prominent beside a short method/result explanation. The linked source line returns to the corresponding observation. Result, stdout, and stderr remain distinct views. Partial recordings retain their captured values alongside the exception message. Loading uses the existing one-second linear spinner; reduced-motion preferences suppress transitions and reduce animation duration.

## Do's and Don'ts

### Do:
- **Do** use off-white for controls, selection, focus, and completion; use semantic green for recorded true condition outcomes.
- **Do** pair changed-value color with its dot.
- **Do** keep source, table cursor, and selected values synchronized.
- **Do** preserve pinned table headers and Step / Line columns within the scroll region.
- **Do** retain the compact system UI and monospace role separation.
- **Do** provide the existing visible off-white focus outline for interactive controls.
- **Do** keep condition labels and their recorded evaluation timing explicit.
- **Do** show original expressions beside captured operand substitutions and label skipped operands as not evaluated.
- **Do** keep history independently scrollable and preserve the drawer's keyboard focus and dismissal behavior.

### Don't:
- **Don't** add marketing sections or decorative imagery to the operating workspace.
- **Don't** add persistent panel shadows that compete with the inspector layer.
- **Don't** use playback controls to imply a new execution.
- **Don't** replace actual submitted source, diagnostics, or returned values with explanatory substitutes.
