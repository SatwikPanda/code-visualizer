# Code Visualizer

A Next.js workspace for recording real Java execution. Paste a class, detect its method parameters, enter values, and inspect a table of JVM variable observations. The included `Solution.strStr` example detects `haystack` and `needle`; `hello` / `ll` returns `2`.

## Run on this machine

Requirements: Node 22.13+ and a full JDK 17+ on PATH (or `JAVA_HOME`). The checked-in npm lockfile pins dependencies.

```powershell
npm install
npm run dev:local
```

Open **http://127.0.0.1:3000**. The script builds the Java tools, serves Monaco assets locally, and starts both Next.js and the execution service. The example is loaded and analyzed automatically. Click **Run & visualize** to record it.

`dev:local` deliberately enables execution on your computer, without a security sandbox. Use only trusted code. This mode is restricted to localhost, displays a visible notice, and requires an explicit opt-in; it is never an automatic fallback from Docker. This machine has JDK 17 and no Docker, so the completed integration and browser checks used this mode.

## Docker execution profile

Requirements: Node 22.13+ and Docker Engine, or Docker Desktop using Linux containers/WSL2 on Windows.

```powershell
npm install
npm run build:sandbox-images
npm run dev
```

Docker is the default backend. The runner resolves the built `codeviz-java:21` image to its immutable local image ID before using it. The image is built from the Java 21 Temurin tag; for reproducible deployments, supply a patched, reviewed digest with `docker build --build-arg JAVA_IMAGE=eclipse-temurin@sha256:<digest> -t codeviz-java:21 -f infra/java.Dockerfile .`.

Compilation runs in a disposable container. Execution uses a target container and a JDI tracer sidecar sharing only the target's loopback network namespace, with separate PID/mount namespaces. The configuration drops capabilities, uses non-root users, limits memory/CPU/processes, and does not publish a JDWP port. Only the dedicated per-job staging directory is mounted; the application workspace and credentials are not mounted into the target.

**Docker execution is implemented but has not been exercised on this machine because Docker is unavailable.** Treat that profile as pending infrastructure verification. Public hostile-code hosting also requires the stronger sandbox and deployment checks in `implementation-plan.md`; the local development mode is not suitable for that use.

## What works

- Compiler-backed discovery of public methods, exact overloads, static methods, package declarations, and package-private `Solution` classes.
- Type-driven String, boolean, character, integer, floating-point, and one/two-dimensional primitive/String array inputs. Java long values travel as decimal strings; quote large integers in JSON array inputs.
- Instance methods with a non-private no-argument constructor; helper calls, recursion, and setup calls.
- Real JVM execution through a fixed reflection harness and a separate JDI recorder. The editor retains the original source; a separate compilation adds narrow boolean probes when Java's flow rules allow them.
- Visible locals/parameters, array mutation and bounded object previews, actual method returns, library-thrown exceptions, and independent stdout/stderr.
- Source highlighting, changed-value markers, frame selection, a virtualized trace table, playback/seek/speed, and a variable inspector.
- Recorded TRUE/FALSE markers and actual operand values beside `if`, `for`, `while`, `do-while`, and ternary conditions, synchronized with replay and the selected invocation. A condition detail strip explains the selected or last evaluated test.
- `main(String[] args)` with an argument-array input and a multiline stdin buffer followed by EOF.
- Durable SQLite jobs, immutable compressed trace chunks with checksums, checkpoints, live SSE hints with polling recovery, refresh recovery, recent runs, cancellation, and JSON export.
- A language adapter boundary and common value/trace contracts for additional languages.
- A Java-selected language rail and adjacent execution history, grouped by date with inputs, status, and outcome. Selecting a run restores its saved source, arguments, stdin, trace, and result. History comes from session-owned SQLite records with pagination; it is no longer limited to eight browser-cached entries. New execution keeps the current code and inputs while starting a fresh workspace. On smaller screens, history opens in a keyboard-accessible drawer.

## Trace semantics and limits

Rows are debugger observations. Ordinary line observations show the location about to execute; condition rows show the state after that boolean expression was evaluated. Changed cells compare with the prior observation in that invocation. A line with multiple statements can hide intermediate assignments, and a compact one-line loop may not produce a line observation for every iteration. Source layout notices explain those cases. The app does not re-evaluate expressions or repair the submitted algorithm.

Condition probes pass each expression's already computed boolean through an identity method. They preserve side effects and short-circuit evaluation without executing the expression twice. Green **TRUE** and coral **FALSE** badges show the latest recorded result at the replay cursor in the selected invocation. A neutral **—** means no result is available yet, including a new visit just before evaluation. **N/A** means that condition cannot safely be probed; hover for the reason. Pattern-variable conditions and constant loops are preserved, and if probing violates Java's flow-sensitive compilation rules the run falls back to the original compiled classes. Original source line numbers remain intact. Old saved runs need a fresh execution to include condition results.

Typed identity probes also capture up to 24 operand occurrences per condition, including variable/field reads, method results, array reads, and increments. These are the actual values at evaluation time, not reconstructed from the later variable snapshot. For `i++ == 0 && i++ == 1`, the explanation can therefore show `0 == 0 && 1 == 1` while the subsequent local `i` is already `2`. Unevaluated operands are labeled **not evaluated** and appear as `[skipped]` in the substituted expression. Literal values stay in the original expression. Every new evaluation starts a fresh operand capture scoped to its invocation; nested conditions, helper calls, and recursion cannot borrow another invocation's values. Expressions beyond the capture limit remain as source. Older recordings show a rerun prompt when operand data is absent.

The workspace uses neutral charcoal surfaces and off-white controls inspired by the supplied reference, with color reserved for condition outcomes, errors, and changed values. The former branding header is removed.

The example intentionally preserves the user's algorithm: `a` / `a` returns `-1`; `aaab` / `aab` returns `0`; an empty needle with a nonempty haystack throws `StringIndexOutOfBoundsException`.

Defaults: 64 KiB source and inputs, 2,000 source lines, 15 seconds of traced execution, 10,000 events, 8 MiB uncompressed trace, 256 KiB per event, bounded heap previews, and 256 captured frames. Local execution has process/time/output limits but cannot enforce the OS isolation/resource controls provided by containers.

Arbitrary custom object arguments, external dependencies, multi-file projects, concurrency fidelity, general expression tracing, complete branch coverage, and interactive stdin are outside this release. Required stdin reads cannot generally be inferred; Program mode accepts a raw buffer.

## Architecture and source map

```text
Browser / Next.js workspace
  -> same-origin session-protected Route Handler
  -> private authenticated localhost execution service
  -> Java language adapter
  -> compiler / invocation harness / JDI collector
  -> immutable trace storage -> generic table and replay
```

- `apps/web`: Next.js UI and browser-facing API. No Java execution inside Next.js.
- `apps/runner`: persistent job worker, SQLite metadata, process supervision, trace storage, ownership, and cancellation.
- `packages/contracts`: input/value/event contracts and validation.
- `packages/trace-model`: frame state, checkpoints, and variable diffs.
- `packages/language-java`: Java adapter and Docker/local execution transport.
- `java/src/codeviz`: dependency-free compiler analyzer, JSON codec, fixed harness, and JDI recorder.
- `tests`: unit, real Java API integration, and browser acceptance tests.

The runner intentionally supports **one service process per data directory** and one execution at a time. Jobs are transactionally claimed and publication is tied to an attempt token. After a service restart, interrupted jobs are marked explicitly; programs are not automatically rerun. This is not a distributed queue.

## Development and verification

```powershell
npm run doctor
npm test
npm run test:integration
npm run typecheck
npm run build

# While npm run dev:local is running:
npm run test:e2e
```

Browser tests use installed Microsoft Edge by default. Change `channel` in `playwright.config.ts` if needed. The tests exercise the real Next.js API and Java runner, not a simulated trace. Screenshots are saved under `.data/screenshots/`.

After building, `npm run start:local` starts a production Next.js server with the explicitly enabled local runner; `npm start` uses the Docker profile. Local execution requires the full JDK at startup. Docker execution does not require a host JDK.

On Windows, a restricted execution environment may block localhost sockets. Start the app and its integration/browser tests from a normal local terminal in that case; no firewall or system security changes are required.

## Storage and configuration

`.data/` contains the ignored SQLite database, compiled tools, job staging, and retained trace chunks. Records expire after 24 hours by default. The run API also supports explicit deletion. Source and argument values are retained with the run and should be treated as private.

`GET /api/runs?languageId=java&limit=30` lists the current session's retained executions, newest first. The returned `nextCursor` can be passed as `cursor` to load earlier pages (limit 1–50). The list contains compact summaries; saved source and full inputs are fetched only when reopening a run. Pagination uses creation time and ID so new runs do not shift earlier pages. The former Recent runs footer dropdown is replaced by this sidebar.

| Variable | Default / purpose |
| --- | --- |
| `WEB_PORT` | `3000` |
| `RUNNER_PORT` | `4317` |
| `RUNNER_DATA_DIR` | `.data` |
| `RUNNER_BASE_URL` | private localhost runner URL |
| `RUNNER_SECRET` | generated in memory by the launcher, shared only between servers |
| `CODEVIZ_IMAGE` | `codeviz-java:21`, resolved to an image ID |
| `JAVA_HOME` | optional JDK location for local development |

Both servers bind to `127.0.0.1`. The runner rejects requests without its private key and session-owner header. The browser receives neither the key nor direct runner access.

## Implementation-plan status

The main Java vertical slice is implemented and verified end to end. Compared with the full roadmap:

- npm is used with an exact lockfile instead of a pnpm workspace launcher.
- Java tools use the JDK build script and a dependency-free JSON codec, so Maven is not needed.
- An explicit JDK 17+ local development mode was added because Docker is absent here; the Java 21 Docker profile remains separate.
- Version 1 retains bounded full observation snapshots plus checkpoints; it does not yet delta-encode the stored trace.
- SSE is a disposable progress hint. Authoritative status and sequence pagination recover missed updates; there is no separate durable SSE notification log.
- The worker is a single service with transactional claims and restart reconciliation. Distributed lease renewal, multi-host scheduling, object storage, and stronger production sandboxing remain future work.
- No second language, speculative stdin-form inference, automatic source formatting, or AI-generated execution facts were added.

These limits are explicit so subsequent work can extend the architecture without mistaking local verification for a completed public execution platform.
