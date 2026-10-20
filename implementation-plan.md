# Code Visualizer — Implementation Plan

Date: 17 October 2026  
Status: Java-first application implemented; local Java execution and the Next.js browser flow are verified. A Tauri 2 Windows x64 desktop shell now packages the production Next.js server, execution service, Node.js, and Java runtime; see `DESKTOP.md` for the desktop architecture and release process. Docker execution is implemented but awaits infrastructure verification on a machine with Docker. See `README.md` for setup, current limits, and explicit deviations from this original roadmap.

## 1. Intended result

Build a Next.js application in which a user can paste a Java program, discover its callable entry points, supply inputs through generated controls, execute the submitted code, and inspect a table showing how its variables change during execution. Selecting a row highlights the corresponding source location. Playback controls move through the recorded execution, and a result panel distinguishes the method's return value from console output and exceptions.

The first example the application must support is:

```java
class Solution {
    public int strStr(String haystack, String needle) {
        // The complete method supplied in the project brief.
    }
}
```

For this signature, the application must automatically identify:

| Property | Detected value |
| --- | --- |
| Language | Java, selected explicitly in the language control |
| Class | `Solution` |
| Method | `strStr` |
| Invocation | Instance method; construct a new `Solution` for each run |
| Input 1 | `haystack`, Java `String` |
| Input 2 | `needle`, Java `String` |
| Return type | Java `int` |

The user should not have to write a `main` method, add print statements, modify the algorithm, or manually declare which local variables to trace.

Future languages must plug into the execution system without requiring a new trace table, a different playback engine, or language-specific branches throughout the Next.js application.

### 1.1 What this document delivers

This is the requested first deliverable: a concrete implementation plan, including the architecture, contracts, execution process, limitations, milestones, and acceptance criteria. It does not claim that an application, container sandbox, or tracing engine already exists.

The workspace was empty when inspected. No existing source code, package configuration, Git repository, `AGENTS.md`, `PRODUCT.md`, or `DESIGN.md` was found in the project. Available commands included Node.js `22.20.0` and Java/Javac `17.0.17`. Docker was not found on the current command path. The proposed runtime is a pinned Java 21 container image; host Java 17 will not be the application runtime.

### 1.2 Working assumptions

- The primary user is a learner or developer investigating small algorithmic programs.
- The first delivery runs locally on this Windows machine, with Linux execution containers through Docker Desktop/WSL2.
- Next.js is a firm framework requirement.
- Initial usage is single-user/local; the design includes a separate production deployment gate for public execution of untrusted submissions.
- The first release accepts one Java source file, including helper classes in that file.
- Standard-library use is supported; downloading arbitrary dependencies is outside the first release.
- The source is executed as submitted. Incorrect algorithms remain incorrect and become inspectable.
- Execution recording happens on the server. Browser playback is a view of the recording.

## 2. Product behavior and scope

### 2.1 Two execution modes

The phrase “CLI inputs” covers two different mechanisms. They require separate handling.

**Method mode — the primary workflow**

The submitted example is a method, not a CLI program. Its required inputs are its declared parameters. A compiler-backed analyzer can reliably discover their names, types, order, and source locations, then generate a form.

**Program mode — `main`, arguments, and standard input**

A Java program containing `public static void main(String[] args)` receives:

1. A list of command-line argument strings.
2. An optional multiline standard-input buffer for `Scanner`, `BufferedReader`, or other reads from `System.in`.

The application detects `main` automatically. It cannot generally determine every future stdin read or its meaning from arbitrary code: reads can be conditional, repeated in loops, delegated to helper methods, or determined by earlier input. Program mode therefore always offers raw stdin. The complete buffer is provided before execution, and stdin is then closed so programs receive EOF rather than waiting indefinitely for interactive input.

Simple scanner-read hints can be added after the core workflow works. They are suggestions with explicit confidence and source locations, not an assertion that all input requirements have been discovered. A future interactive input mode will need a different execution protocol; it will not be simulated by guessing values.

### 2.2 First-release feature matrix

| Feature | First release | Behavior |
| --- | --- | --- |
| Full Java class pasted into editor | Yes | Preserve the submitted program |
| Detect method parameter names/types | Yes | Use compiler AST and resolved symbols |
| Multiple methods and overloads | Yes | Signature-based selector; no name-only dispatch |
| Static methods | Yes | Invoke without constructing an instance |
| Public instance methods | Yes | Require a usable no-argument constructor |
| Package-private top-level `Solution` class | Yes | Essential for the supplied example |
| Java package declaration | Yes | Derive a controlled source path from parsed package/class names |
| Primitive/String arguments | Yes | Typed controls and explicit null support for reference types |
| Primitive/String arrays | Yes | One- and two-dimensional arrays; bounded JSON editors |
| `main`, `args`, and raw stdin | Yes | Separate Program mode |
| Local variables, parameters, loops, helper calls | Yes | Debugger observations mapped to user source |
| Recursion and early returns | Yes | Distinct frame/invocation identities |
| Exceptions and console output | Yes | Separate event/result categories |
| Arrays and user-object field previews | Yes | Bounded snapshots; no user method evaluation |
| Playback, back, forward, seek | Yes | Replay recorded state without executing again |
| JSON trace export | Yes | Versioned, bounded export including source and limits |
| Arbitrary `ListNode`, `TreeNode`, or custom object inputs | Later | Require an explicit input codec/schema |
| Maven/Gradle project imports or external jars | Later | Separate dependency and project model |
| Multiple uploaded source files | Later | Source schema allows it; initial API enforces one file |
| User-created threads, parallel streams, virtual threads | Unsupported fidelity in v1 | Detect supported signals and stop with a clear reason where possible |
| Exact recording of every expression or assignment | Later | First release records source-line debugger observations |
| Arbitrary interactive stdin prompts | Later | Requires pausable input protocol |
| AI-generated explanations | Optional later | Never the source of execution facts |

Unsupported entry points appear with a reason. The analyzer must not invent values, silently omit required parameters, or run a different overload to make the form work.

## 3. Architecture decisions

### 3.1 Chosen baseline

| Concern | Decision | Reason |
| --- | --- | --- |
| Web framework | Next.js App Router with TypeScript | Requested stack; clean server/client boundary |
| Editor | Monaco, loaded only on the client | Java highlighting, diagnostics, source decorations |
| Form/contracts | Shared Zod schemas plus explicit type descriptors | Validate data at every boundary |
| UI state | Local React state for editor/form; a small run/replay store | Keep rapidly changing traces outside broad page rerenders |
| Trace table | Virtualized rows, with pinned metadata columns | Avoid rendering thousands of rows at once |
| API role | Next.js as browser-facing API/proxy | Authentication, validation, quotas, and delivery |
| Execution orchestration | Separate persistent TypeScript runner service | Java work outlives a web request |
| Java analysis | Java Compiler API and `JavacTask` | Parse real Java and resolve signatures |
| Java trace capture | JDI debugger with line-location breakpoints and narrow AST boolean probes | Observe JVM state and actual condition values while retaining original editor source and line numbers |
| Runtime | Pinned, patched JDK 21 image | Reproducible compiler/debugger behavior |
| Initial database | SQLite in WAL mode, owned by the runner | Durable single-host jobs without an extra queue service |
| Initial trace storage | Immutable compressed chunks on local disk | Bounded writes and efficient trace retrieval |
| Live progress | SSE notifications plus trace pagination | Replayable delivery and straightforward recovery |
| Process isolation | Disposable compile container, target container, tracer sidecar | Separate submitted code from the web server and collector filesystem |
| Tests | Vitest, Java JUnit tests, real-container integration, Playwright | Verify contracts, execution, and browser workflow |

Resolve exact current package versions when scaffolding, pin them in a lockfile, and record runtime image digests. Do not install a floating `latest` JDK image during a run. Java 21 is an intentional compatibility target, not a claim that it is the newest Java release.

The runner uses a normal HTTP server such as Fastify and a repository layer over a maintained SQLite binding. Java tools use a Maven wrapper and pinned dependencies. Next.js does not import the Docker client, Java compiler, or SQLite connection used by the runner.

### 3.2 Component diagram

```text
Browser
  Next.js client UI
    Editor -> detected entry point -> input form -> Run
    Trace table <-> source highlight <-> recorded-state playback
                         |
                    HTTPS / SSE
                         |
Next.js Node server
  Session ownership, request validation, public API, stream proxy
                         |
              Private authenticated runner API
                         |
Persistent runner service
  Job leasing | language registry | watchdog | artifact validation
       |                 |                         |
  SQLite metadata   Trace chunk files       Container runtime API
                                                  |
                                 Disposable per-job environments
                                  1. Java analysis/compile sandbox
                                  2. Target JVM sandbox
                                  3. JDI tracer sidecar
```

The browser never connects to a JVM, a debugger port, a container daemon, or the internal runner API directly.

Next.js Route Handlers support Web `Request`/`Response` APIs and streamed responses. The API routes will explicitly use the Node runtime. Self-hosting also requires streaming to remain unbuffered through the reverse proxy. See [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route) and [self-hosting guidance](https://nextjs.org/docs/app/guides/self-hosting).

### 3.3 Why execution is a separate service

Compilation and tracing require processes, filesystem isolation, time budgets, and cleanup even when the browser disconnects. They must not run within a Next.js request handler or depend on an in-memory promise that disappears during a deploy.

Keeping execution separate also permits a later Python worker, a different Java runtime, or remote runner hosts without changing the web application. If the UI later moves to managed hosting, the runner remains a long-lived service with an explicit private API.

### 3.4 Why the initial stack does not require Redis

One runner service can own a durable job table and claim jobs transactionally. This is sufficient for the bounded local release. SQLite WAL is a single-host design with one writer at a time; the database must remain on local storage, not a network filesystem. Transactions remain short, with a busy timeout and bounded retries. See [SQLite WAL](https://www.sqlite.org/wal.html) and [transactions](https://www.sqlite.org/lang_transaction.html).

The `JobRepository`, `MetadataRepository`, and `TraceStore` interfaces form explicit replacement boundaries. Moving to PostgreSQL, a dedicated queue, and object storage is a scale milestone, not a prerequisite for the first working algorithm trace.

## 4. Repository structure

```text
code-visualizer/
  implementation-plan.md
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  .env.example
  .gitignore
  apps/
    web/
      src/app/
        page.tsx
        layout.tsx
        api/languages/route.ts
        api/analyses/route.ts
        api/analyses/[analysisId]/route.ts
        api/runs/route.ts
        api/runs/[runId]/route.ts
        api/runs/[runId]/events/route.ts
        api/runs/[runId]/trace/route.ts
        api/runs/[runId]/trace/checkpoint/route.ts
        api/runs/[runId]/cancel/route.ts
        api/runs/[runId]/export/route.ts
      src/features/
        editor/
        inputs/
        execution/
        trace-table/
        playback/
        output/
      src/lib/runner-client.ts
    runner/
      src/http/
      src/jobs/
      src/sandbox/
      src/adapters/
      src/storage/
      src/limits/
      src/observability/
  packages/
    contracts/
      src/analysis.ts
      src/invocation.ts
      src/trace.ts
      src/values.ts
      src/languages.ts
      src/errors.ts
    trace-model/
      src/reducer.ts
      src/checkpoints.ts
      src/diff.ts
      src/selectors.ts
    language-java/
      src/adapter.ts
      src/input-codecs.ts
      src/manifest.ts
  java/
    pom.xml
    analyzer/
    harness/
    tracer/
    contract-fixtures/
  infra/
    compose.yaml
    images/java-toolchain.Dockerfile
    images/java-tracer.Dockerfile
    sandbox-profiles/
  fixtures/
    java/signatures/
    java/algorithms/
    java/errors/
    java/limits/
    traces/
  tests/
    integration/
    e2e/
  scripts/
    doctor.mjs
    dev.mjs
  .data/                       # Ignored; metadata and retained artifacts
```

This is a proposed layout, not a set of files already created. Use one workspace package manager and one Java build. A separate microservice for every language operation is unnecessary; adapters share the runner infrastructure.

## 5. Language-neutral contracts

### 5.1 Language adapter

The adapter is trusted backend code. It describes how to analyze, validate, prepare, and execute a language using the sandbox manager. It never accepts executable command templates from the browser.

```ts
type InvocationMode = "method" | "program";

interface LanguageManifest {
  id: string;
  displayName: string;
  adapterVersion: string;
  runtimeVersion: string;
  invocationModes: InvocationMode[];
  inputKinds: string[];
  trace: {
    granularity: "line" | "statement" | "instruction";
    parameters: boolean;
    locals: boolean;
    returns: boolean;
    exceptions: boolean;
    heapPreview: boolean;
    exactBranchOutcomes: boolean;
  };
}

interface LanguageAdapter {
  manifest: LanguageManifest;
  analyze(source: SourceSnapshot, ctx: AnalysisContext): Promise<Analysis>;
  validateInvocation(analysis: Analysis, raw: unknown): Invocation;
  prepare(analysis: Analysis, input: Invocation): PreparedExecution;
  execute(
    prepared: PreparedExecution,
    context: ExecutionContext,
    emit: (event: AdapterEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<AdapterResult>;
}
```

`analyze` and `execute` are called by job workers. Language-native utilities run inside sandbox environments. `PreparedExecution` references an allowlisted image, fixed process arguments, controlled files, and server-selected limits. The sandbox manager owns actual container creation.

The runner adds trusted envelope fields such as `runId`, `attemptId`, and sequence numbers after validating adapter output. A submitted program cannot select another run ID by printing JSON.

### 5.2 Input type descriptors

The UI consumes structured descriptors, not Java syntax strings that it must parse.

```ts
type InputType =
  | { kind: "boolean"; languageType: string }
  | { kind: "integer"; languageType: string; min: string; max: string }
  | { kind: "float"; languageType: string; bits: 32 | 64 }
  | { kind: "character"; languageType: string; unit: "utf16-code-unit" }
  | { kind: "string"; languageType: string; nullable: boolean }
  | { kind: "array"; languageType: string; element: InputType; nullable: boolean }
  | { kind: "unsupported"; languageType: string; reason: string };
```

Reference nullability is represented explicitly; absence of an input field does not mean Java `null`. Boxed primitives and custom object codecs are extensions to this union, not implicit coercions in the first release.

Every parameter carries a stable ID, declared name, ordinal, descriptor, and source span. The source hash and entry-point ID bind the form to a particular analysis.

### 5.3 Analysis example

```json
{
  "schemaVersion": 1,
  "languageId": "java",
  "sourceHash": "sha256:...",
  "entryPoints": [
    {
      "id": "Solution#strStr(Ljava/lang/String;Ljava/lang/String;)I",
      "mode": "method",
      "displayName": "Solution.strStr(String haystack, String needle)",
      "isStatic": false,
      "constructible": true,
      "parameters": [
        {
          "id": "p0",
          "name": "haystack",
          "type": { "kind": "string", "languageType": "java.lang.String", "nullable": true }
        },
        {
          "id": "p1",
          "name": "needle",
          "type": { "kind": "string", "languageType": "java.lang.String", "nullable": true }
        }
      ],
      "returnType": "int",
      "supported": true
    }
  ],
  "diagnostics": [],
  "warnings": [],
  "traceCapabilities": { "granularity": "line", "exactBranchOutcomes": false }
}
```

The JVM descriptor is backend identity data. The UI displays the readable signature and treats IDs as opaque.

## 6. Java analysis and automatic input detection

### 6.1 Exact analysis process

1. Receive language ID and source text; validate the source-size limit before persistence.
2. Normalize CRLF to LF once, retain the normalized immutable source, and compute its UTF-8 SHA-256 hash. Display the same source in the editor and every saved run.
3. Create an analysis record and durable analysis job in one database transaction.
4. Start a fresh bounded analysis container with the pinned JDK toolchain. No user classes are loaded or initialized during analysis.
5. Use `ToolProvider.getSystemJavaCompiler()`, a controlled file manager, and `JavacTask.parse()` to obtain the compilation-unit AST.
6. Inspect top-level declarations and the package AST to choose a legal source filename. Reopen the source under that controlled URI before semantic analysis when a public class requires a matching filename.
7. Run compiler analysis with annotation processing disabled and an explicit empty/user-independent classpath. Do not scan the machine's classpath or download dependencies.
8. Use `TreePathScanner`, compiler elements/types, and source positions to collect methods, parameters, declarations, scopes, and control-flow source spans.
9. Resolve parameter types to canonical Java names. Match a real `java.lang.String`, not merely a token spelling `String` that a user class could shadow.
10. Enumerate supported public methods, inherited-constructor constraints, `main` entry points, and unsupported candidates with reasons.
11. Return structured diagnostics with severity, message, source ID, line, and column. Return partial discovery only as non-runnable information when semantic errors remain.
12. Persist the analysis result. The browser applies it only if its source revision/hash still matches.

`JavacTask` exposes parsing and semantic analysis; it is the selected alternative to regex matching or maintaining a separate incomplete Java grammar. See the [JavacTask API](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.compiler/com/sun/source/util/JavacTask.html).

Compiler source offsets are UTF-16 offsets. Use the compilation unit's line map to find the line, then calculate the editor column as `offset - lineMap.getStartPosition(line) + 1`, or use the editor's equivalent offset-to-position conversion. `LineMap.getColumnNumber()` expands tabs, so it is not directly interchangeable with the editor's UTF-16 model column. Use absolute diagnostic positions when available and retain line-only locations when a reliable column cannot be recovered. Never compute columns from UTF-8 byte lengths. Include CRLF, tabs, and non-ASCII text in mapping tests. See [the Java LineMap API](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.compiler/com/sun/source/tree/LineMap.html).

### 6.2 Entry point rules

- Exactly one supported non-`main` public method: preselect it.
- Multiple supported methods: require a signature selection before Run.
- Both `main` and methods: show Method/Program mode; preserve the selected mode.
- Overloads: distinguish declaring class, method name, and erased parameter descriptor. Never select using the method name alone.
- Instance methods: require a concrete constructible class with an accessible or safely reflectively accessible no-argument constructor in the sandbox's unnamed module.
- Package-private top-level classes are allowed. The harness can use reflection accessibility for submitted classes; it must not require all classes to be declared public.
- Abstract classes, interfaces as construction targets, non-static inner-class construction, private entry methods, and generic entry signatures needing unresolved type arguments are initially unsupported.
- Helper methods may be private and still appear in the trace when called by a supported entry point.
- An implicit default constructor is valid. A parameterized-only constructor produces an actionable unsupported-entry diagnostic.
- Constructors and static initializers execute during preparation of the invocation and may fail. Their effects are not assumed harmless or skipped.

### 6.3 Form generation and validation

| Java input | Form | Validation/wire behavior |
| --- | --- | --- |
| `String` | Textarea or text field | Preserve whitespace and escapes as actual data; explicit null toggle |
| `boolean` | True/false control | No truthy-string coercion |
| `byte`, `short`, `int`, `long` | Decimal integer field | Validate exact range; transmit decimal strings |
| `float`, `double` | Numeric field | Preserve precision intent; explicit tokens for special values if enabled |
| `char` | Character field | Exactly one UTF-16 code unit; an emoji surrogate pair is not one Java `char` |
| `T[]` | JSON array editor | Validate each element, length, nulls, and total bytes |
| `T[][]` | Nested JSON editor | Validate depth and aggregate elements; allow jagged arrays |
| `String[] args` | Repeatable argument list | Preserve each argument literally; no shell splitting |
| stdin | Multiline buffer | Preserve newlines; send bytes using defined UTF-8 encoding |

For integer arrays, the editor must use lossless numeric parsing or require quoted decimal values outside JavaScript's exact range. A normal `JSON.parse` followed by conversion is insufficient for a large Java `long`. The canonical invocation payload stores all integers as decimal strings regardless of the form widget.

Java `String` may be empty or null; these are distinct valid inputs even when the submitted code then throws. Do not impose algorithm-specific constraints such as “needle must be nonempty” unless the user explicitly adds them.

Validate inputs in three places: browser for immediate feedback, runner against the stored signature, and harness decoder against the exact wire type. Only the runner's validation authorizes execution.

### 6.4 Optional stdin hints

After raw Program mode is complete, inspect simple AST patterns such as `int count = scanner.nextInt()` or `String line = reader.readLine()` and show source-linked hints. The receiver must resolve to the expected standard-library type. Repeated reads, branches, mixed `nextInt`/`nextLine` behavior, and unknown helper calls lower confidence or disable generated stdin forms.

A hint serializer must reproduce Java token/newline behavior. If it cannot, leave raw stdin as the authoritative input and explain the limitation. Do not run the program speculatively to discover inputs without the normal execution limits.

## 7. Java compilation and invocation

### 7.1 Compilation pipeline

For each accepted run:

1. Resolve its immutable analysis/source snapshot and revalidate the selected signature and arguments.
2. Create a new attempt ID and a fresh job sandbox; never reuse a JVM between user runs.
3. Write the source under a server-generated safe path. Package segments and filenames come from parsed identifiers, and resolved paths must remain inside the job directory.
4. Compile the original source with debug metadata enabled:

   ```text
   javac --release 21 -encoding UTF-8 -g:lines,vars,source -parameters -proc:none -d /job/classes /job/src/<derived-file>.java
   ```

5. Use equivalent controlled Compiler API options in the implementation, with structured diagnostics and fixed classpath/module settings. The command above documents behavior, not a client-supplied shell command.
6. Record the generated class manifest, including inner/helper classes, line metadata availability, compiler version, and source hash.
7. Stage only validated regular compiled files and the invocation payload into the execution sandbox. Reject symlinks, unexpected artifact names, oversized output, or traversal paths during transfer.
8. Start the fixed harness on a restricted classpath containing its dependencies and the compiled user classes.

Debug symbols are required for local names and line mapping. Annotation processing is explicitly disabled. The relevant flags are documented by [the Java 21 `javac` command](https://docs.oracle.com/en/java/javase/21/docs/specs/man/javac.html).

### 7.2 Invocation harness

The harness is compiled and shipped with the runtime image; it is not assembled from user input strings.

It reads a bounded invocation JSON file, resolves the exact analyzed method, decodes the arguments into real Java values, creates a receiver when necessary, and invokes that method. Reflection permits the supplied package-private `Solution` class while still selecting the exact public method.

The method is invoked exactly once per execution attempt. The harness must handle reflection varargs carefully: the invocation always receives a prepared `Object[]` argument vector, so a single array argument is not accidentally expanded.

For Program mode, the harness invokes the selected `main` with the actual `String[]` arguments. A separate container input stream carries stdin and is closed at EOF. Method mode also permits an advanced stdin buffer for a method that reads `System.in`; this does not alter its detected parameter form.

Input values stay in data files and streams. They are never interpolated into Java source, a shell command, or a JVM option. Reserved harness package names cannot be redeclared by user source, and the classloader configuration avoids user classes replacing harness libraries. These are integrity measures; the OS sandbox remains the security boundary.

The harness has JDI-observed invocation-start and completion hooks. It initializes the target class and constructs any receiver before reaching the invocation-start hook; that hook identifies the selected signature and execution thread. The tracer then arms the next exact matching method entry on that thread as the root invocation and retains its frame ID. Calls to the same method from a constructor or static initializer remain setup calls. For a static method, class initialization must also finish before the start hook. Recursive entries after the root starts are child frames.

The completion hook conveys setup failures and exception outcomes. The debugger reads hook arguments without evaluating application expressions. `InvocationTargetException` is unwrapped by the harness to identify the submitted method's original exception. A normal selected-method return is captured from the JVM's own method-exit event for the retained root frame, not merely the next exit with the same method name.

Console output is not a result protocol. Text that looks like a JSON trace event or a special “result marker” remains console text.

## 8. Trace capture and precise semantics

### 8.1 Selected approach: debugger observations

Use the Java Debug Interface, JDI, to pause the JVM at executable locations and inspect variables. Version 1 does not inject print statements, rewrite assignments, re-evaluate conditions, or use an LLM to simulate execution.

| Alternative | Assessment |
| --- | --- |
| Regex insertion of logging | Rejected: breaks Java syntax, scopes, comments, expressions, and control flow |
| Browser JavaScript interpretation of Java | Rejected: reproducing Java semantics is a separate compiler/runtime project |
| AST source instrumentation | Possible later; maintaining semantics and source maps is substantial work |
| JDI line observations | Selected: real JVM execution, original source, inspectable locals and returns |
| Instruction stepping or bytecode instrumentation | Future higher-detail mode after overhead and correctness tests |

**Implemented condition-marker extension (2026-10-17):** ordinary variables and returns still use the JDI observation engine. The compiler AST additionally identifies `if`, `while`, `do-while`, `for`, and ternary boolean expressions. A separate compilation wraps supported expressions with a boolean identity method, `codeviz.Probe.condition(siteId, codeviz.Probe.begin(siteId), expression)`. The debugger reads that method's already evaluated argument and records `phase: "condition"` with `{id, value, operands}` and the caller's state. Expressions execute once, including their original side effects and short-circuit behavior. Probe classes are excluded from user frames. The unchanged editor source supplies the original spans and line numbers; wrappers add no source lines. This is a narrow extension to the original no-instrumentation baseline above, not general expression tracing.

Pattern-variable expressions and literal constant loop tests are left untouched. Instrumented classes are compiled into a separate directory, and inserted probe calls must resolve to the trusted probe type. If Java's definite-assignment, constant reachability, or other flow-sensitive rules reject instrumentation, those classes are discarded and the original compiled program runs. Affected conditions carry `recordable: false` and a reason. The UI renders N/A rather than inferring a result.

Analysis and run metadata retain each condition's stable source-span ID, kind, expression, original line/column range, and recording capability. Trace events retain actual boolean outcomes and frame identity. Replay uses only outcomes at or before its cursor in the selected invocation; it clears the prior result to a neutral pending marker on a new before-instruction visit. The editor renders TRUE/FALSE after the condition without changing copied source, and each condition observation shows the result beside its trace source. This extension is covered by original-example, side-effect, short-circuit, flow-safety, recursion/replay, and browser acceptance checks.

**Implemented operand-value extension:** the AST gives each operand occurrence an ID and offsets relative to its condition expression. It captures variable and field reads, array reads, method results, assignments, and increment/decrement results through typed identity overloads. Assignment targets and incremented identifiers are never wrapped independently. Primitive overloads preserve their Java primitive types; a generic identity overload retains reference values. Probes do not call user display methods. Nested insertions are ordered by source span and wrapper role, and all generated hook calls must resolve to the trusted probe type.

The `begin` hook resets the collector's operand buffer before expression evaluation. Buffers are keyed by condition site and invocation frame, so recursion/helper conditions and short-circuit paths do not reuse stale values. Each operand hook freezes the value when read, and the final condition hook attaches the captured list to its observation. Up to 24 operand occurrences are captured per condition, using the existing bounded value representation. An operand's absence from a completed evaluation is an unevaluated path, never a guessed value from the after-expression locals. Uncaptured expressions beyond the limit remain as source.

The shared condition result schema is language-neutral and keeps operands optional for old recordings and future adapters. Replay retains each recorded occurrence's value. Rendering substitutes source spans as escaped text only, without evaluating Java in JavaScript. The editor shows a compact substituted preview, trace condition rows show their recorded expression values, and a detail strip shows the original condition, substituted expression, result, and individual operands. Pending evaluations, unavailable conditions, and recordings without operands have explicit messages. User-requested neutral charcoal styling replaces the earlier green-tinted system and removes the branding header.

### 8.2 What a row means

A trace row is **an observed JVM state at a source-mapped debugger pause**. Its active source line is normally the instruction about to execute. The change column means **“changed since the previous observation in this invocation”**.

For example, if the next pause is on `int j = 0;`, the initialization of `occurence` may already be visible. The UI must not claim `j` has already been assigned just because that line is highlighted.

Do not label rows “state after this line” unless a later tracing mode actually guarantees that contract. There can be several observations for one source line, and some source lines have no executable location.

The condition extension supplies one explicit exception: a `phase: "condition"` row is captured after the recorded boolean expression evaluates, before execution continues into its chosen branch. Its variable values can therefore include side effects from that expression. The table's source column is labeled **Source**, and the result pill identifies these rows.

The JDI stack-frame API identifies the current location and exposes visible variables and values. These reads must happen while the thread is suspended. See [StackFrame](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.jdi/com/sun/jdi/StackFrame.html).

### 8.3 Same-line operations and compact loops

Line metadata cannot reveal every intermediate assignment. For `i++; j++;` on one line, only a combined change may be observed. A compact one-line loop may have no line-table breakpoint on its back edge, so even repeated iterations are not guaranteed to appear individually.

This is a known boundary, not an implementation detail to hide:

- The analyzer flags multiple statements or compact loop bodies sharing a line.
- The trace panel displays its granularity and links the warning to source.
- Users can explicitly format/split statements and rerun to improve visibility; the application never silently reformats the executed source.
- Row counts are called observations or visits, not guaranteed loop iteration counts.
- Time limits still stop a loop even if it produces no further breakpoint events.
- Acceptance tests include a one-line loop and verify the warning and honest trace labeling.

A later `instruction` mode can use JDI minimum-size stepping with separate raw-instruction and emitted-event budgets, or bytecode probes with accurate source maps. That work requires a benchmark and semantic parity tests before being advertised. The supplied multiline algorithm is the first acceptance target for the line mode.

### 8.4 Debugger startup and event loop

1. Launch the target JVM suspended before application execution with a loopback-only JDWP listener. The port is accessible only inside the job network namespace.
2. Start the isolated tracer sidecar and attach its JDI socket connector. Apply an attach deadline.
3. Verify required capabilities, especially method return values and debug metadata. Failure is an engine error or explicit unsupported capability, not a successful empty trace.
4. Register class-prepare requests for compiled user classes from the manifest. Register method entry, method exit, exception, VM death, and disconnection handling before resuming.
5. On each relevant class preparation, obtain executable locations through `allLineLocations()`. Install a breakpoint for every distinct `(class identity, method name, method descriptor, codeIndex)` location, including classloader identity where relevant. Never deduplicate only by source line or descriptor; different methods can share both descriptors and offsets.
6. Restrict normal line/method capture to user classes; exclude JDK internals and harness plumbing from the main table.
7. Use a consistent suspension policy, initially suspend-all, so heap snapshots are coherent for supported single-threaded programs.
8. Drain the JDI event queue. For a suspended event set, copy required frames, locals, fields, and values into plain immutable DTOs before resuming exactly once.
9. Assign a capture-group ID when several event kinds occur at the same pause. Process entry/observation/exit facts in a defined order without fabricating separate source executions.
10. Emit bounded normalized events through the tracer's dedicated stdout pipe; its stderr is diagnostic logging. The target JVM has separate stdout/stderr streams.
11. Let the host watchdog enforce wall-clock/resource limits independently of JDI responsiveness.
12. On completion, flush validated events, finalize result metadata, detach/terminate as appropriate, and remove all job containers and temporary resources.

The fixed target launch template includes the following debugger option, passed as one argv element rather than through a shell:

```text
-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:5005,timeout=5000,quiet=y
```

The port can be constant because each target has its own network namespace. `quiet=y` suppresses debugger terminal messages so the listener banner does not contaminate user stdout; verify this behavior on the pinned image. The tracer attaches using `com.sun.jdi.SocketAttach`. See [JPDA connection options](https://docs.oracle.com/en/java/javase/21/docs/specs/jpda/conninv.html) and the [OpenJDK 21 JDWP option implementation](https://github.com/openjdk/jdk21u/blob/master/src/jdk.jdwp.agent/share/native/libjdwp/debugInit.c). The host watchdog remains authoritative if the transport does not honor its own timeout.

The executable-line API supplies compiler-mapped locations; it does not promise expression-level events. See [ReferenceType line locations](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.jdi/com/sun/jdi/ReferenceType.html).

Do not create both a global stepping request and line breakpoints by default. That duplicates observations and increases overhead without improving the stated line-level contract.

### 8.5 Parameters, local variables, and scope

Use JDI argument values at method entry and visible locals at later pauses. Read values in batches where possible. Parameters become available at entry; local declarations can remain unavailable until the compiler's local-variable visibility range begins.

Variable identity is not the name alone:

```text
variable instance = invocation frame ID + local symbol ID
local symbol ID   = declaring method + stable JDI local identity + source mapping
```

Map debugger locals to AST declarations using method, type, visibility, and source scope. If mapping is ambiguous, preserve a debugger-local ID and mark the source declaration unavailable. Do not guess that two `i` variables are the same variable.

Public JDI does not expose every raw local-slot/scope detail through a convenient universal field. The implementation must use the actual supported API and mapping evidence; it must not assume a nonexistent `LocalVariable.slot()` method.

Cells distinguish these states:

- A concrete value, including `0`, `false`, and an empty string.
- Java `null`.
- Not yet visible at this pause.
- Out of scope or frame exited.
- Unavailable because the debugger could not retrieve it.
- Truncated because a display/capture limit was reached.

An unavailable local must not be shown as its language default value. When a local disappears, emit an explicit removal/scope event instead of carrying its old value into later rows.

### 8.6 Frames, recursion, returns, and exceptions

Every invocation has a unique frame ID and a parent frame ID. Recursive calls to the same method therefore have separate arguments and locals. The UI can follow the active frame or pin a selected invocation.

The harness invocation-start hook defines the boundary between setup and the requested root call. Method signature alone is insufficient: construction or initialization may call that same method. Preserve the armed root's frame identity through recursion, exceptions, and completion.

On normal method exit, capture the real return value and identify whether it belongs to the selected root invocation or a helper. A helper's return must not overwrite the final result. `void` is a distinct return category.

JDI method-exit events are not generated when a method exits by throwing an exception. At the initial throw event, the throwing frames have not yet unwound. Reconcile tracked frames at the next suspended event or completion hook to identify removed frames instead of waiting forever for matching exit events. Preserve the original throw snapshot separately. See [MethodExitEvent](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.jdi/com/sun/jdi/event/MethodExitEvent.html).

Exception capture cannot filter only by the class where the exception was thrown. For example, `needle.charAt(j)` can throw inside `java.lang.String`. Inspect the stack for relevant user frames and retain the nearest user callsite, original exception type, available message, and catch destination.

Treat caught exceptions as trace events, not automatic run failures. The invocation outcome determines failure: a harness-caught reflection wrapper can still represent an unhandled exception in the submitted method. Use the explicit completion hook and observed unwinding to classify it correctly.

If code calls `System.exit(0)` before returning, report process termination without a captured method result. Exit code zero alone is not proof that the selected method completed successfully.

Initialization and constructor observations appear in a collapsible setup section. They may affect fields or throw before the selected method starts. Preserve them rather than presenting the root method as if it always began successfully.

Record the invocation thread at the start hook. A user-source event on another execution thread triggers `unsupported_execution` with reason `CONCURRENCY_NOT_SUPPORTED`, retaining the partial trace. Preflight warnings also flag recognizable parallel constructs. This is detection of unsupported execution, not a guarantee that all possible concurrency can be identified before it starts; never describe such a partial recording as a complete deterministic trace.

### 8.7 Heap snapshots and side-effect-free display

- Serialize primitives directly; represent integers losslessly.
- Read strings through JDI string access with bounded retained length.
- Read array elements through JDI, with total length and truncation metadata.
- Read fields for user-defined objects up to the configured depth/node limit.
- Represent other library objects by type and reference ID when a safe structural codec is unavailable.
- Use run-local object reference IDs to preserve aliases and detect cycles.
- Freeze each captured value; later mutations must not change earlier rows.
- Track heap changes separately from variable binding changes, so `items[0] = 7` is visible even though the `items` reference did not change.
- Never invoke `toString()`, getters, `equals()`, collection iterators, or watch expressions merely to display a value.

Reading a very large string through JDI may itself allocate a large response before truncation. Container memory limits remain necessary, and the tracer treats serialization failure as a bounded capture failure rather than retrying without limit.

Objects may become unreachable or collected between observations. Existing frozen snapshots remain valid; future unavailable reads are labeled explicitly. Avoid pinning every observed object for the entire run because that would materially change memory behavior.

### 8.8 Explaining the final output

Version 1 provides evidence-based explanations assembled from recorded events:

- Which method and input values were used.
- Which source locations were reached.
- How observed values changed.
- Which helper calls returned and what they returned.
- The final return or exception and its source location when available.

An explanation may say: “The method returned `2`; `occurence` was last observed as `2` at this return.” It must not claim an exact branch boolean or a mathematical reason that the tracer did not observe.

JDI line events alone do not expose arbitrary condition results. The implemented boolean probes described in §8.1 supply actual results for supported conditions; those recorded booleans may be displayed as facts. Unsupported conditions remain unavailable. Inferring a branch from successor source spans is optional future work and must carry an `inferred` label. Re-evaluating `if (i++ < limit)` to obtain its value would change program behavior and is prohibited.

## 9. Trace and value schema

### 9.1 Event envelope

```ts
interface TraceEnvelope {
  schemaVersion: 1;
  runId: string;
  attemptId: string;
  seq: number;                 // Strictly increasing within this attempt.
  captureGroupId?: string;     // Related facts from one suspended event set.
  kind: TraceKind;
  elapsedMs: number;           // Collector time; not algorithm performance.
  source?: SourceLocation;
  frameId?: string;
  threadId?: string;
}

interface SourceLocation {
  sourceId: string;
  line: number;                // One-based.
  column?: number;             // Only when known, never fabricated precision.
  endLine?: number;
  endColumn?: number;
}

type TraceKind =
  | "run-start"
  | "frame-enter"
  | "observation"
  | "checkpoint"
  | "frame-return"
  | "frame-unwind"
  | "exception"
  | "output"
  | "limit"
  | "run-end";
```

The actual schema is a discriminated union with a validated payload for every `kind`, not an unchecked `payload: any`.

One host-side collector assigns the final sequence across validated tracer events, stdout, stderr, and stored checkpoints. Sidecar-local sequence values are diagnostic only. This sequence orders collected facts; it does not establish exact cross-stream source timing.

An observation payload contains the phase (`before-instruction`), active source location, visible variable bindings, changed values, removals, and bounded heap changes. `previousObservationSeq` links comparisons within the same invocation. Capture-group IDs allow the UI to group co-located entry/breakpoint facts without removing real repeated visits.

### 9.2 Values

```ts
type TraceValue =
  | { kind: "integer"; type: string; decimal: string }
  | { kind: "float"; type: string; text: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "char"; value: string; codeUnit: number }
  | { kind: "string"; value: string; length: number; truncated: boolean }
  | { kind: "null" }
  | { kind: "void" }
  | { kind: "reference"; refId: string; type: string }
  | { kind: "unavailable"; reason: string };
```

Floats preserve `NaN`, infinities, and negative zero as explicit text representations. Arrays and objects live in a bounded heap snapshot keyed by `refId`; references remain stable within the attempt. Visibility/scope is part of the variable binding rather than an overloaded null value.

A snapshot stores only data, never live JDI objects or closures. All source text, exception messages, and output are rendered as escaped text in the browser.

### 9.3 Storage and replay strategy

Start the tracer prototype with full snapshots so correctness is easy to inspect. Before the integrated release, use a shared reducer with:

1. A full initial checkpoint.
2. Variable/heap deltas for successive observations.
3. A full checkpoint at most every 100 observations and at major frame transitions when useful.
4. Immutable chunk files, closed at 250 events or 256 KiB uncompressed, whichever happens first.
5. A small database manifest containing sequence ranges, checkpoint positions, compressed size, and checksum.

Chunk boundaries and checkpoint intervals are defaults to tune after measuring. The total uncompressed trace limit is enforced before compression, so compression cannot hide an oversized trace.

For seeking, load the nearest checkpoint at or before the target sequence and replay its remaining deltas. A browser worker can perform reconstruction when profiling shows main-thread work is noticeable. The same reducer is tested against sequential replay, random seeks, and exported traces.

A `checkpoint` event contains `stateThroughSeq`, the complete bounded replay state (active and retained frame metadata, bindings, heap previews, and result state), and its format version. It represents state after `stateThroughSeq`; the checkpoint itself does not execute or change program state. Large console content remains in output events/pages and is not copied into every checkpoint.

`GET /api/runs/:id/trace/checkpoint?atOrBeforeSeq=N` returns `{ attemptId, checkpointSeq, stateThroughSeq, state, nextAfterSeq }` for the nearest committed checkpoint no later than `N`. The client then requests normal event pages after `nextAfterSeq` until reaching `N`. For the beginning of the recording, return the initial checkpoint; for a future/uncommitted sequence, return a bounded not-yet-available response. The chunk/checkpoint index supports this lookup without scanning the entire recording. This route has the same ownership checks as every trace read.

Enforce a 256 KiB maximum serialized event/checkpoint. Apply the existing preview truncation rules consistently; if a valid full replay checkpoint still cannot fit, terminate with `trace_limited` rather than publishing an incomplete checkpoint as complete. Flush a chunk before appending an event that would exceed its target byte budget.

An uninitialized column, a scope removal, or a frame unwind must be represented in the replay data; the table must not infer these merely from missing JSON properties.

### 9.4 Output ordering

Preserve byte order within stdout and within stderr, decode UTF-8 incrementally, and retain channel identity. Host receipt order between these two pipes and debugger events is not an exact source execution order.

Output events therefore carry a collector sequence and channel, without an invented source line. Do not claim that a particular observation emitted a console chunk unless a future instrumentation mode establishes that relationship.

## 10. Public API and source consistency

| Endpoint | Purpose | Success behavior |
| --- | --- | --- |
| `GET /api/languages` | Capabilities and input/runtime limits | `200` manifest list |
| `POST /api/analyses` | Save source and queue analysis | `202` with analysis ID/hash |
| `GET /api/analyses/:id` | Analysis status, diagnostics, input schema | `200` owned analysis |
| `POST /api/runs` | Validate and enqueue one invocation | `202` with run ID |
| `GET /api/runs/:id` | Authoritative state/result/trace metadata | `200` owned run |
| `GET /api/runs/:id/events` | Live lifecycle and chunk notifications | SSE stream |
| `GET /api/runs/:id/trace?afterSeq=N&limit=M` | Recover committed events | `200` bounded page |
| `GET /api/runs/:id/trace/checkpoint?atOrBeforeSeq=N` | Get the starting state for a seek | `200` nearest checkpoint and continuation position |
| `POST /api/runs/:id/cancel` | Request termination | Idempotent acknowledgement |
| `GET /api/runs/:id/export` | Download complete/partial trace bundle | Versioned JSON download |
| `DELETE /api/runs/:id` | Cancel if active, then delete retained data | Idempotent deletion workflow |

The run request contains the stored analysis ID, source hash, opaque entry-point ID, typed argument values, optional stdin/argv as appropriate, and an idempotency key. It does not contain a Docker image, a command, or trusted user identity.

Reject stale source hashes with `409`; invalid input with `422`; payload limits with `413`; and quota failures with `429`. Cross-session resources return a non-revealing not-found response. Syntax/compiler errors belong in the analysis/run diagnostic model rather than becoming generic HTTP 500 failures.

Every run retains its source snapshot. Editing the editor after a run must not move old highlights onto new code. Show “Viewing a previous run” and allow switching back to that run's source. Parameter fields retain values only when the corresponding analyzed signature and parameter IDs are still compatible.

### 10.1 SSE delivery

- SSE messages announce persisted status changes and available trace sequence ranges; they are not the sole trace store.
- Give notifications monotonic notification IDs separate from trace event sequence IDs.
- Support `Last-Event-ID`, heartbeat comments, and an explicit resynchronization event when the retained notification window has expired.
- On reconnect, fetch current status and missing trace ranges, deduplicating by attempt ID and sequence.
- Persist chunks before announcing them.
- Set event-stream content type, `Cache-Control: no-cache, no-transform`, and disable proxy buffering.
- Close the browser EventSource after a terminal status and retrieval of the final committed chunk.
- Slow or disconnected clients must not block the JVM or consume unbounded server memory.
- Provide bounded status/trace polling when the deployment cannot maintain streaming.

Browser disconnects do not automatically cancel a run. The explicit Stop run button sends the cancellation request. Pause playback affects only the browser recording cursor.

## 11. Persistence, jobs, and failure recovery

### 11.1 Core records

| Record | Important fields |
| --- | --- |
| `source_snapshots` | ID, owner session, canonical source, hash, language, created/expiry times |
| `analyses` | Source ID, adapter/runtime version, status, descriptors, diagnostics |
| `runs` | Owner, analysis ID, invocation, status, current attempt, result, limits, timestamps |
| `jobs` | Kind, target ID, state, lease token, lease expiry, attempt count, cancellation flag |
| `run_attempts` | Run ID, attempt ID, worker identity, fencing token, runtime image digest, terminal reason |
| `trace_chunks` | Attempt ID, sequence range, checkpoint index, relative path, size, checksum |
| `run_notifications` | Run ID, notification sequence, kind, committed payload |

Store timestamps in UTC and display them in the user's locale. Source and input values are private retained data, not routine application log fields.

### 11.2 Claiming jobs

Create a job and its analysis/run record in the same SQLite transaction. A worker claims a queued job using a short immediate transaction, changes its state, assigns an unpredictable lease/fencing token, and commits before doing any compilation.

Heartbeat the lease periodically. Every status write and trace-manifest append must verify the current fencing token. A stale worker cannot finalize or append to a replaced attempt.

Start with one active execution and a separately bounded analysis lane. New analysis requests are explicitly triggered by Analyze or debounced with cancellation and deduplication; typing must not create an unbounded compile queue.

No exactly-once execution guarantee is claimed. Infrastructure failures may leave an attempt partially executed. Each new attempt gets a fresh sandbox and separate trace namespace. Do not automatically rerun a method after an uncertain post-launch failure; mark it interrupted and offer a new run. Limited automatic retries are acceptable only before user execution begins.

### 11.3 State machine

```text
queued -> preparing -> compiling -> running -> finalizing -> completed
                         |            |
                         |            +-> runtime_error
                         +-> compile_error

Any nonterminal state -> cancel_requested -> cancelled
Any active attempt    -> timed_out | resource_limited | trace_limited
Any active attempt    -> internal_error | interrupted
Any active attempt    -> unsupported_execution
```

Analysis has its own smaller state machine: `queued -> analyzing -> ready | invalid | failed | cancelled`.

Persist `traceCompleteness` separately as `none`, `partial`, or `complete`, and persist the invocation outcome separately as `returned`, `threw`, `exited`, or `aborted`. A timeout with a useful partial trace is still a timeout. A recorded helper return is not a completed root result.

When an event/output limit is reached, terminate the execution and preserve the partial recording. Do not keep running invisibly and present a final result with an apparently complete trace.

### 11.4 Atomic chunk publication and crash cleanup

1. Write a bounded temporary chunk under the server-controlled attempt directory.
2. Flush, checksum, and atomically rename it to its final immutable path.
3. Commit the chunk manifest and notification in a database transaction guarded by the attempt token.
4. Expose it through the API only after that commit.

A crash before the database commit can leave an orphan file; reconciliation deletes it later. Database entries whose files fail validation are surfaced as an interrupted/corrupt trace, not silently skipped.

On runner restart, reconcile expired leases with containers labeled by job/attempt ID. Terminate abandoned target/tracer containers and mark their attempts interrupted. A periodic reaper also cleans jobs after browser loss or worker crashes.

Cancellation races resolve transactionally: a completed result stays completed if it committed first; otherwise cancellation prevents further publication and the watchdog kills all attempt processes. Deletion waits for cancellation/cleanup and then removes owned artifacts.

## 12. Isolation and execution limits

Running submitted code is intrinsic to this product, so isolation is part of the normal architecture rather than an optional production afterthought.

### 12.1 Exact local container topology

**Analysis/compile container**

Runs only the pinned compiler utility, with bounded source, no annotation processors, no external network, no host workspace mount, and a temporary output directory. Compiler/parser failures cannot crash Next.js.

**Target container**

Runs the user JVM and fixed harness. Its network mode is `none`, which retains loopback only. JDWP binds to `127.0.0.1` inside that namespace; no debugger port is published to the host. Source/class/input files are supplied through controlled artifact staging. The target has no metadata database, worker credentials, trace output directory, or container socket.

**Tracer sidecar**

Joins only the target's network namespace with the equivalent of `--network container:<target>`, allowing loopback debugger attachment. It retains separate PID and mount namespaces, cannot be seen as a target process, and has its own read-only image and resource limits. The host runner collects its output through the container API. It does not expose an HTTP control service to the target.

Docker documents loopback-only behavior for the [none network driver](https://docs.docker.com/engine/network/drivers/none/) and shared-container networking options in [container execution](https://docs.docker.com/engine/containers/run/). This exact topology must pass the first infrastructure spike on the selected engine; it has not been proven in the current workspace.

### 12.2 Sandbox settings

- Non-root runtime user; drop all unnecessary capabilities.
- `no-new-privileges`, read-only root filesystem, and an appropriate seccomp/OS policy.
- Bounded tmpfs/work storage; no mounts containing host source trees, credentials, or unrelated files.
- No outbound network and no host networking.
- No Docker socket or orchestration secrets in compile, target, or tracer environments.
- CPU, memory, process/thread, file-size, open-file, output, and wall-clock limits.
- A host-side watchdog that can kill both target and tracer even when JDI is stuck.
- Direct executable argument arrays, never a shell command assembled from submitted values.
- Controlled environment variables; do not inherit host JVM injection variables such as `JAVA_TOOL_OPTIONS`.
- Per-attempt cleanup on success, exception, cancellation, timeout, disconnect, and orchestration failure.

The container runtime API is powerful host access. Only the dedicated runner controls it, using fixed allowlisted templates. Next.js and browser input cannot choose arbitrary mounts or container flags. See [Docker Engine security](https://docs.docker.com/engine/security/) and [seccomp profiles](https://docs.docker.com/engine/security/seccomp/).

### 12.3 Initial limit profile

These are starting configuration values to validate in the infrastructure spike, not measured performance claims.

| Resource | Initial limit |
| --- | --- |
| Source | 64 KiB UTF-8, 2,000 lines |
| Combined arguments/stdin | 64 KiB |
| Analyze/compile wall time | 15 seconds per stage |
| Debugger attachment | 5 seconds |
| Traced execution wall time | 15 seconds, including debugger suspension overhead |
| Whole job wall time | 45 seconds plus bounded finalization/cleanup |
| Target memory | 512 MiB container cap, initially `-Xmx128m` |
| Compiler memory | 512 MiB; separate from target |
| Tracer memory | 384 MiB; separate from target |
| CPU | One CPU per active sandbox process container |
| Processes/threads | Initial cap 128; verify the pinned JVM starts reliably |
| Temporary storage | 64 MiB per relevant work directory |
| Trace observations/events | 10,000 total emitted events |
| Trace size | 8 MiB uncompressed total |
| Single event/checkpoint | 256 KiB serialized |
| stdout + stderr | 256 KiB combined |
| Preview string length | 2,000 UTF-16 code units retained |
| Preview array elements | 100 per array, bounded total graph |
| Preview object depth/nodes | Depth 3, 500 nodes per observation |
| User call-stack display/capture | 256 frames; explicit limit result beyond it |
| Concurrent executions | One initially; global queue cap 20 |
| Anonymous session quota | One active run; bounded queued requests and analysis rate |
| Retention | 24 hours by default, with explicit delete |

Admission control must account for the compiler, target, and tracer combined. Heap limits alone do not limit JVM native memory or other processes. Wall time includes tracing cost and must not be advertised as the algorithm's natural runtime.

Verify effective cgroup limits at startup and with resource tests. Rootless runtimes can ignore resource controls when their host configuration does not support them; passing a flag is not proof that it is enforced. See [Docker rootless resource limits](https://docs.docker.com/engine/security/rootless/tips/).

### 12.4 Public deployment gate

The local container profile is not a claim that ordinary Docker alone safely hosts arbitrary hostile tenants. Before internet-accessible code execution, require a tested stronger isolation layer such as gVisor or microVMs, dedicated execution hosts, enforced per-user/global quotas, runtime patching, and resource/network isolation tests.

JDI, loopback attachment, and namespace joining must be verified against that chosen sandbox technology. If incompatible, adjust the sandbox transport/topology before publication; do not expose JDWP or weaken the boundary to bypass the incompatibility.

A public Next.js frontend can still use the same private runner contract. Publication of the UI is not proof that an execution backend is production-ready.

## 13. Next.js interface and interaction

### 13.1 Main workspace

**Implemented execution navigation (2026-10-17):** a 56px left language rail selects Java by default. An adjacent 248px sidebar lists retained executions as selectable rows, grouped by local date, with method/input titles, recorded outcome, status, and time. The active execution has a quiet charcoal selection. History scrolls independently of the workspace. New execution keeps the current code and input values and clears the active recording; the footer's eight-item Recent runs dropdown is removed.

History is authoritative server data, not an eight-item localStorage cache. `GET /api/runs?languageId=java&limit=30` returns compact session-owned summaries and an opaque `nextCursor`. Pages use `(created, id)` descending keyset pagination, backed by an owner/kind/creation index; limits are validated from 1 to 50. The owner filter is applied on every page, including caller-supplied cursors. Source, console streams, full arguments, and traces are excluded from list responses. Existing records without a language ID are treated as Java; new runs persist that field for future adapters. The existing 24-hour retention policy applies.

Selecting an execution fetches its saved run and original analysis, restores its source/entry point/arguments/null states/stdin, resets replay filters and position, and loads its persisted trace and output. It does not execute the program again. If the original analysis has expired, the recording remains readable and a fresh input detection is needed before rerunning. Navigation request tokens prevent late responses from replacing newer selections or edits. Active recordings temporarily disable switching and New execution, matching the runner's one-active-run policy.

At widths up to 1180px, the language rail remains and history opens as a drawer. At 900px and below, the rail becomes a compact horizontal Java/Executions strip to preserve the full workspace width. The drawer traps keyboard focus, closes through Escape, backdrop, or its close button, and restores focus to its opener. Desktop/mobile acceptance checks cover two real executions, switching between their inputs/results, refresh restoration, selection state, and drawer keyboard behavior; integration checks cover stable pagination, compact summaries, restored arguments, and owner isolation.

Use a focused operating interface suited to reading code and comparing values. The first screen is the actual workspace, seeded with the user's example and clearly labeled example inputs.

Desktop layout:

1. A compact toolbar with language, entry point, Analyze, Run, and Stop run.
2. Source editor on the left.
3. Detected input form and run summary on the right.
4. A wide trace table below, with source/frame context and playback controls.
5. Separate return value, stdout, stderr, and exception views near the trace.

The trace table gets substantial width because the example contains several simultaneously useful variables. Avoid forcing every value into a narrow decorative card.

### 13.2 Core components

| Component | Responsibility |
| --- | --- |
| `CodeEditor` | Source text, diagnostics, current/previous location decoration |
| `EntryPointPicker` | Supported signatures and unsupported reasons |
| `InputForm` | Type-driven controls and validation messages |
| `RunControls` | Analyze/Run/Stop, busy state, stale-analysis prevention |
| `ExecutionStatus` | Queue, compile, run, finalize, limit, and failure states |
| `TraceTable` | Virtualized observations and variable columns |
| `PlaybackControls` | First/previous/play/pause/next/last and seek |
| `FrameSelector` | Root/helper/recursive invocation context |
| `ValueInspector` | Expanded arrays, fields, aliases, truncation metadata |
| `ResultPanel` | Root return or terminal exception |
| `ConsolePanel` | Distinct stdout/stderr with bounded text rendering |
| `TraceNotice` | Granularity, partial trace, and unsupported-fidelity notices |

### 13.3 Table behavior

Pinned columns: observation number, source location, source excerpt, and frame. Remaining columns are the selected frame's parameters and locals, ordered by parameter order and then source declaration order.

- Highlight changed cells with both color and a non-color indicator.
- Show previous/current values on focus or click.
- Keep repeated source visits as separate rows.
- Provide a “changes only” view without deleting events from the underlying recording.
- Preserve out-of-scope markers rather than confusing them with nulls.
- Let users pin important variables and hide others.
- Open arrays/objects in an inspector instead of expanding every graph inline.
- Clicking a row moves the replay cursor and source highlight together.
- Clearly mark partial data when a limit or failure ended capture.

For the supplied example, useful columns are `haystack`, `needle`, `occurence`, `j`, `needleLength`, `haystackLength`, `i`, `haystackChar`, and `needleChar`. Preserve the user's spelling `occurence`.

### 13.4 State and responsiveness

Distinguish empty source, edited/unanalysed source, analyzing, invalid source, ready inputs, queued run, compilation, active recording, completion, and each failure category. Disabling Run must always have a visible reason.

On narrow screens, use Code / Inputs / Trace / Output tabs with shared run controls. Trace columns may scroll horizontally with the selected row and variable names still understandable. The editor loads lazily and does not block the initial page shell.

Keyboard focus must reach every control and table row action. Provide accessible labels, visible focus, meaningful status announcements, readable contrast, and reduced-motion behavior. Prefer stable layout during streaming; do not automatically jump to the newest row while the user is inspecting an earlier one.

Pause/Play refer to recorded playback. Stop run terminates server execution. Back never reruns a statement or reverses the JVM.

## 14. Worked example and correctness expectations

### 14.1 End-to-end acceptance path

1. Paste the complete supplied `Solution` class.
2. Analyze it and automatically select `strStr(String, String)`.
3. Display inputs labeled `haystack` and `needle`.
4. Enter `hello` and `ll`.
5. Run once; show compile/recording progress.
6. Display a root return value of `2` and an empty stdout panel.
7. Show parameter values, local initializations, repeated loop-source observations, and the changes to `occurence` and `j`.
8. Select a row and show the saved source with the correct highlighted location.
9. Seek backward and forward without another server execution.
10. Change the inputs or source and create a separate run.

### 14.2 Illustrative condensed progression

The following is a conceptual walkthrough of the algorithm for `hello` / `ll`, not a claimed capture from the planned JDI engine. Actual raw rows follow compiler executable locations and the before-instruction semantics specified above.

| Point in the program | `i` | `j` | `occurence` | Observed/computed fact |
| --- | --- | --- | --- | --- |
| After initializations | — | 0 | -1 | Needle length 2; haystack length 5 |
| First comparison | 0 | 0 | -1 | `h` differs from `l` |
| Second comparison | 1 | 0 | -1 | `e` differs from `l` |
| Matching character | 2 | 0 | -1 | `l` matches `l` |
| After recording candidate | 2 | 0 | 2 | `occurence` is assigned the current index |
| After increment | 2 | 1 | 2 | `j` advances |
| Next iteration | 3 | 1 | 2 | The early-return condition is reached |
| Method result | — | — | — | Returns `2` |

### 14.3 The visualizer must expose algorithm bugs

The supplied algorithm was exercised with the installed Java 17 runtime during planning. These are observed results of that method's logic; they are not JDI integration tests. They must be repeated against the pinned Java 21 runtime during implementation.

| `haystack` | `needle` | Actual supplied-method behavior | Conventional substring-search expectation |
| --- | --- | --- | --- |
| `hello` | `ll` | Returns `2` | `2` |
| `a` | `a` | Returns `-1` | `0` |
| `aaab` | `aab` | Returns `0` | `1` |
| `helxo` | `ll` | Returns `2` | `-1` |
| `a` | empty string | Throws `StringIndexOutOfBoundsException` | Common contract returns `0` |
| empty string | empty string | Returns `-1` | Common contract returns `0` |
| `abc` | `z` | Returns `-1` | `-1` |

For example, the method checks `j == needleLength - 1` before verifying the current character, so some inputs can return prematurely. The app's job is to make the executed path visible, not replace it with the expected search result. Expected outputs belong to explicit test fixtures or user-supplied assertions, not guessed program intent.

## 15. Verification strategy

### 15.1 Analyzer and input tests

- Supplied example yields exactly the two String parameter fields in the right order.
- Comments containing fake signatures do not become methods.
- Multiple overloads, static methods, package-private classes, and package declarations resolve correctly.
- An implicit no-argument constructor works; parameterized-only construction is rejected with a reason.
- Syntax errors, unknown symbols, and unsupported parameter types prevent invalid execution.
- Large `long` values round-trip exactly, including arrays of longs.
- Empty strings, whitespace, embedded quotes/newlines, nulls, and UTF-16 characters are preserved.
- Jagged arrays, empty arrays, null nested arrays, excessive depth, and aggregate limits are handled consistently.
- Stale source revisions cannot replace a newer form or enqueue against the wrong signature.

### 15.2 Real JVM tracing tests

Use real Java fixtures and execute them with tracing enabled; mocked traces alone cannot validate a debugger.

| Fixture | Required property |
| --- | --- |
| Supplied `strStr` example | Correct actual results and useful local-value observations |
| Simple assignments | Correct before-instruction labeling and deltas |
| Multiple statements on one line | Honest grouping/granularity warning |
| Compact one-line loop | No false promise of every iteration; timeout still works |
| `for`, `while`, `do/while` | Repeated executable locations retained |
| `break`, `continue`, early return | Correct observed flow and terminal result |
| Shadowed/reused local names | Separate symbol identities |
| Recursion and helper methods | Separate frames and correct root return |
| Returned array and in-place array mutation | Frozen history, visible heap changes |
| Shared references and cycles | Stable IDs, bounded traversal |
| `try/catch/finally` and finally-return override | Actual JVM outcome; correct unwind handling |
| Exception thrown inside `String.charAt` | User callsite and original failure retained |
| Static initializer/constructor failure | Setup failure before root invocation |
| Constructor/initializer calls the selected method | Setup call is not mistaken for the requested root result |
| `System.exit` | Process termination without fabricated return |
| Prints fake trace JSON | Displayed only as user stdout |
| Missing debug information/collector disconnect | Explicit failure, no misleading empty success |
| User-created thread/parallel work | Unsupported-fidelity handling, no deterministic-trace claim |

For supported deterministic fixtures, compare traced execution against an ordinary sandboxed execution using the same harness and runtime. Compare return value, exception type, and per-stream output. Do not compare timing or promise equivalence for time-sensitive/concurrent code.

### 15.3 Replay and contract tests

- TypeScript and Java fixtures conform to the same versioned schema.
- Sequential replay equals reconstruction from every checkpoint.
- Random seeks produce the same state as replay from the beginning.
- Frame exits, scope exits, nulls, unavailable values, and truncation survive export/import validation.
- Historical arrays/objects never mutate when a later event arrives.
- Duplicate/reconnected notifications do not duplicate trace rows.
- Missing sequence ranges are requested or flagged, not silently ignored.
- Unknown schema versions fail with an actionable compatibility message.

### 15.4 Lifecycle and isolation tests

- Cancellation during queueing, compilation, debugger attach, execution, and finalization.
- Worker crash and restart; expired leases; stale-token publication attempts.
- Partial chunk write, disk full, missing artifact, and checksum mismatch.
- Infinite loop without new breakpoints; memory exhaustion; output flood; excessive recursion.
- Attempts to spawn processes, read unrelated files, connect externally, or reach the host network.
- No target access to tracer process namespace, runner metadata, or Docker socket.
- No public JDWP listener and no accidental host port publication.
- Limits actually enforced under the selected Docker/WSL2 configuration.
- Cross-session analysis/run/trace/export access denied.
- Source and output containing HTML/script are rendered inertly.
- Retention expiry and explicit deletion clean both records and artifacts.

### 15.5 Browser end-to-end tests

Use Playwright for the main user journey with the real runner in integration CI: paste source, analyze, enter values, run, see `2`, inspect variable changes, seek, and export. Add flows for invalid input, compile error, runtime exception, cancellation, partial trace, reconnect, and source edits after a run.

Verify the workspace at desktop and narrow/mobile widths, keyboard navigation, and a representative 10,000-event recording. A mock transport is useful for UI edge states, but the primary acceptance journey must use real Java execution.

## 16. Implementation milestones in dependency order

### Milestone 0 — Prove the risky execution path

Before investing in a polished frontend:

1. Check Docker/WSL2 availability and effective resource limits.
2. Build pinned analyzer/harness/tracer images.
3. Prove target-container plus network-sharing tracer attachment with no host debugger port.
4. Compile the supplied class with debug symbols and invoke it through the harness.
5. Collect real parameter/local observations, a root return, and a library-thrown exception.
6. Exercise same-line-loop limitations and preserve them in fixtures/documentation.
7. Prove wall-time termination and complete cleanup even without incoming debugger events.

**Exit criteria:** a machine-readable trace for `hello` / `ll` returns `2`; `a` / empty needle records the original exception; an infinite loop is killed; all containers are removed. If the chosen sandbox transport fails, resolve that architecture issue before building UI around assumed traces.

### Milestone 1 — Workspace and shared contracts

Create the Next.js/runner workspace, TypeScript configuration, Java Maven modules, shared schemas, source IDs, error model, and example fixture. Add scripts for dev, build, focused tests, integration tests, and environment diagnostics.

**Exit criteria:** packages build; Java/TypeScript contract fixtures agree; `doctor` reports prerequisites accurately. No real user execution occurs inside Next.js.

### Milestone 2 — Durable jobs and analysis

Implement the runner's private HTTP API, SQLite migrations/repositories, job claiming/leases, analysis sandbox, diagnostics, entry-point discovery, and typed descriptors. Wire the Analyze endpoint and input form to real results.

**Exit criteria:** the user's class produces two fields automatically; overload and invalid-source cases work; stale analysis cannot overwrite current editor state.

### Milestone 3 — Safe method execution

Implement invocation validation, codecs, artifact staging, container limits, exact reflection dispatch, process output capture, cancellation, and terminal status handling.

**Exit criteria:** supplied-method results match ordinary Java; large integers and array arguments preserve values; limits terminate all relevant processes. Return values do not depend on stdout parsing.

### Milestone 4 — JDI trace engine

Implement class preparation, executable-location breakpoints, frame IDs, local identities, snapshots, method returns, exception/unwind handling, object previews, source mapping, and bounded serialization. Add the real JVM fixture suite.

**Exit criteria:** meaningful trace data for the supplied algorithm, recursion, mutation, and exceptions; no fabricated statement/branch precision; traced/untraced parity on supported deterministic fixtures.

### Milestone 5 — Stored trace and replay

Implement immutable chunks, checkpoints/deltas, manifest publication, SSE notifications, trace pagination, reconnect recovery, JSON export, and the shared replay reducer.

**Exit criteria:** a run survives browser refresh; disconnect/reconnect recovers every committed event; random seek matches linear replay; failed runs retain useful partial traces.

### Milestone 6 — Complete Next.js workspace

Build the editor/input/run workflow, virtualized variable table, source highlighting, frame/value inspectors, result/console panels, playback controls, limit notices, responsive behavior, and accessibility states.

**Exit criteria:** the complete example journey is usable from the browser; Playwright verifies a real run; the interface clearly separates replay pause from server cancellation.

### Milestone 7 — Program mode and release hardening

Implement `main` entry-point handling, argv controls, raw stdin/EOF, and source-linked basic read hints only when their serializer is reliable. Complete crash recovery, ownership tests, retention/deletion, resource tests, performance measurements, and local setup documentation.

**Exit criteria:** both Method and Program modes work on a clean supported local setup; all first-release acceptance criteria pass; limitations are visible and documented.

### Milestone 8 — Add another language to validate the design

Implement one additional adapter, likely Python, after researching its runtime-specific tracing/input semantics. Reuse the existing contracts, table, reducer, APIs, storage, and sandbox manager. A dynamic language may require user type choices/default-value hints when annotations are absent; it must not pretend to have Java's static parameter types.

**Exit criteria:** a second language can produce the common trace contract without a separate viewer. Language limitations appear in capabilities rather than hardcoded `if (language === ...)` logic across UI components.

## 17. Local development and deployment

### 17.1 Windows setup

Use Docker Desktop's Linux-container/WSL2 backend for Java sandboxes. Run Next.js and the runner in a documented development configuration, with the runner as the only process allowed to use the local container engine. Prefer container-managed volumes or validated archive transfer for job artifacts instead of exposing Windows project directories to submitted code.

The host Java installation is useful for development tools but not an execution fallback. If Docker or the required isolation checks are unavailable, the app reports “Execution backend unavailable” while allowing editing/inspection of existing traces. It must not silently execute pasted Java directly on the Windows host.

Planned developer commands, to be implemented with the workspace:

```text
pnpm install
pnpm doctor
pnpm build:java
pnpm build:sandbox-images
pnpm dev
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

`pnpm doctor` checks Node/package-manager compatibility, image availability, container engine access, workspace storage, JDI attach topology, and effective limits. It must report failures without changing host security configuration automatically.

### 17.2 Configuration

Document variables such as `RUNNER_BASE_URL`, server-only runner authentication secret, `RUNNER_DATA_DIR`, allowed runtime image digests, retention, concurrency, and limit profile. No runner secret is prefixed with `NEXT_PUBLIC_` or included in browser bundles.

Use a cryptographically random, HTTP-only, same-site session cookie for local ownership. Validate request origin for mutations. If network deployment is enabled, use TLS, secure cookies, authenticated users or explicitly bounded anonymous access, and service-to-service authentication. Bind local development services to loopback by default.

### 17.3 Production growth path

1. Keep the Next.js API and adapter contracts stable.
2. Replace SQLite repositories with PostgreSQL when multiple runner hosts or write concurrency require it.
3. Introduce a durable queue if needed, with a transactional outbox/reconciliation process so database writes and enqueue operations cannot diverge.
4. Move immutable chunks behind `TraceStore` to object storage; authorize every read through run ownership.
5. Add worker pools by language/runtime and use capacity-aware scheduling.
6. Enforce the public isolation gate before accepting untrusted internet submissions.

Do not put a JVM inside a Cloudflare Worker or assume a frontend hosting platform also supplies this execution backend. Hosting is chosen around the Next.js requirement and the separate runner's needs.

## 18. Observability and performance targets

Log run/attempt IDs, phase transitions, compiler/tracer versions, duration, container exit reason, event count, artifact size, and cleanup outcome. Do not log raw source or argument values by default.

Measure analysis time, queue time, compile time, attach time, traced wall time, serialization time, chunk latency, and browser seek/render time separately. Debugger overhead is part of recording, so displayed elapsed time is labeled as traced execution time.

Initial engineering targets, to benchmark rather than promise:

- Warm analysis of the supplied small class within roughly two seconds.
- Its full traced run within roughly five seconds on a typical development machine.
- First feedback immediately after submission, even when the run is queued.
- Smooth playback and a seek response under about 100 ms once relevant chunks are loaded.
- Bounded browser memory and DOM size for the configured maximum trace.

If tracing is slow, optimize captured frames/heap depth, batch JDI reads, and chunk serialization before hiding or sampling required observations. Sampling would need an explicitly different trace-completeness contract.

## 19. Risks and planned responses

| Risk | Consequence | Response |
| --- | --- | --- |
| JDI/container topology fails on target environment | No executable backend | Prove it in Milestone 0; no frontend-only success claim |
| Line tracing is mistaken for every assignment | Misleading educational output | Define semantics in UI/schema; compact-line warnings and tests |
| Missing or short local-variable visibility | Apparent gaps in values | Explicit unavailable states; never invent initialization values |
| Reflection changes exception wrapping | Wrong final error | Unwrap at harness boundary and reconcile actual user frames |
| Object snapshots execute user code | Changed behavior or hangs | Read debugger values/fields only |
| Large heap/trace exhausts collector memory | Runner failure | Graph/event/byte/container budgets plus watchdog |
| User program tampers with output | Fake trace or result | Separate target output from isolated tracer channel; validate all data |
| Source edited while result arrives | Wrong input form/highlight | Immutable snapshots, hashes, and revision guards |
| Browser or worker disconnects | Lost results/orphan processes | Durable jobs, fenced attempts, chunk storage, reconciliation |
| Container flags not enforced | Host resource exhaustion | Startup checks and real resource-exhaustion tests |
| Future language needs different types/events | Java coupling spreads | Capability-driven adapters and versioned value/event unions |
| Overbuilding infrastructure delays core proof | No working visualizer | Single-host storage first, vertical execution spike first |

Remaining technical experiments have named milestones and pass criteria. They are not permission gates or assumptions silently treated as verified behavior.

## 20. Definition of done for the first release

The Java-first visualizer is complete when all of the following hold:

- The user can paste the supplied class unchanged and automatically obtain `haystack` and `needle` controls.
- Running real Java produces the method's actual result or exception.
- A table shows correctly identified parameters/locals and their observed changes, with source locations and clearly defined row semantics.
- Returns, stdout, stderr, and exceptions are distinct.
- Recursion, scope changes, arrays, and supported helper methods do not corrupt historical state.
- Playback and seeking work without re-execution.
- Main/argv/raw-stdin mode works, with honest limits on automatic stdin discovery.
- Invalid input, syntax failures, runtime exceptions, timeouts, cancellation, and trace limits have usable interfaces.
- Runs remain consistent across source edits and browser reconnects.
- Compiler and submitted-code execution are isolated from Next.js and the host workspace.
- Limits, cleanup, ownership, and source/output escaping pass their integration tests.
- The real-browser example journey passes against the real Java runner.
- Setup documentation reproduces the supported local deployment.
- The adapter interface contains everything necessary to add another language without replacing the generic viewer.

The immediate implementation priority is Milestone 0: prove real input discovery, safe invocation, and trustworthy trace capture for the supplied algorithm before expanding the interface.
