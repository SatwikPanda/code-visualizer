# Tauri 2 desktop app

This project builds a Windows x64 desktop app using the Next.js UI and Java/C++20 tracing engines. Version 0.2.0 includes an NSIS installer and a portable ZIP, with synchronized step-table and animated-canvas playback. It does not require system Node.js or Java at runtime.

The release includes C++20 tracing and the new animated data canvas: magnitude bars, moving transfer values, swap arcs, insertion/removal motion, before/after deltas, iterator arrows, container-specific layouts, and recorded branches. C++ requires an installed Clang C++20 toolchain and standard-library headers on PATH (or `CODEVIZ_CLANGXX`); its `bin` directory must be on PATH for runtime DLLs. The desktop payload does not bundle Clang. The installer updates an earlier installation while retaining app-data history under the existing retention policy.

## Runtime architecture

```text
Tauri native window / WebView2
  -> authenticated Next.js server on a random 127.0.0.1 port
  -> private execution service on a different random 127.0.0.1 port
  -> bundled Java compiler, invocation harness, and JDI tracer
  -> installed Clang C++20 compiler and native statement recorder
  -> SQLite execution history and compressed trace chunks in app data
```

The application retains a Next.js server because it uses dynamic Route Handlers, session protection, streaming, and a private service proxy. A static export would discard that behavior. The desktop shell therefore bundles Next's standalone production output rather than substituting an incomplete static site.

`src-tauri/src/main.rs` constructs the dark native window and starts the bundled Node supervisor. On Windows it first assigns Node to a Job Object configured to terminate all descendants on close; a stdin handshake prevents services from starting before this containment exists. This also covers Java processes when the desktop app is closed during a run. A single-instance plugin focuses the existing window instead of starting a second worker against the same database.

`desktop/bootstrap.cjs` clears generated Next page responses before startup so cached pages from an earlier installation cannot override the new build. It starts the execution service, discovers its allocated port, and starts the production Next server. The native window waits for readiness, then visits a per-launch URL that establishes an HttpOnly, SameSite=Strict session cookie. Desktop API requests without the per-launch cookie are rejected. Runner credentials remain in server processes. The WebView can navigate only to the startup page or the allocated frontend origin, and the remote page receives no Tauri IPC commands or native capabilities.

The Java adapter accepts the bundled tool-class path through `CODEVIZ_JAVA_CLASSES`. Its language-neutral contracts, trace storage, replay model, and future language-adapter boundary are shared with the browser version.

## Packaging process

`npm run desktop:build` runs `scripts/build-desktop.mjs` and the Tauri CLI. The build helper first removes the generated target payload to prevent stale resources from merging into the new build. Its preparation hook:

1. Generates native icons from `src-tauri/icons/icon.svg`.
2. Builds Next.js with standalone output and the repository as its tracing root.
3. Copies traced dependencies, static assets, and offline Monaco assets into the payload. The generated CommonJS server entry is named `server.cjs` so the monorepo's ESM package setting cannot change its interpretation.
4. Bundles the runner into `runner.cjs` using esbuild.
5. Copies the build machine's Node executable, compiles the Java tools with debug information, and creates a Java image using `jlink`. All modules are retained so ordinary Java standard-library programs and the compiler/debugger are available.
6. Includes runtime licenses and a version/checksum manifest.
7. Compiles the Rust shell for `x86_64-pc-windows-msvc` and builds the current-user NSIS installer, including the WebView2 bootstrapper.
8. Creates a portable folder, ZIP, and SHA-256 checksums under `release/`.

The packaged payload is generated under `src-tauri/resources/payload/` and is ignored by source control, as are Rust build output, caches, tests' app data, and release artifacts. Keep both npm's lockfile and `src-tauri/Cargo.lock` when transferring the source.

The portable app consists of the executable **and its entire payload folder**. Moving the executable alone is unsupported. The installer places both together automatically. The bootstrapper can download WebView2 if missing; the portable app needs an existing WebView2 installation. No code-signing certificate is configured in this release.

## Data and diagnostics

Default data directory: `%LOCALAPPDATA%\dev.codevisualizer.desktop`.

| Path | Purpose |
| --- | --- |
| `desktop-session.json` | Stable local history owner across restarts |
| `executions/` | SQLite metadata, compiled job files, and retained traces |
| `webview/` | WebView2 profile and cache |
| `desktop.log` | Supervisor startup errors |
| `services.log` | Execution-service and Next.js logs |

Existing retention remains 24 hours. The app does not migrate browser-session history from `.data/`. Files in app data may contain submitted source and input values. Java runs with the user's OS permissions; the Job Object controls lifetime, not filesystem or network access.

For startup failures, inspect `desktop.log` and `services.log`. Both servers bind to loopback with automatically selected ports. Runtime resources are located beside the installed executable; source directories and the current working directory are not runtime dependencies.

## Verification

`npm run test:desktop` launches the release executable and attaches Playwright to its real WebView2 through a test-only debugging environment variable. System Node and Java are removed from the child application's PATH, and `JAVA_HOME` is cleared. Only the external Clang toolchain and Windows system directory remain on PATH. The test uses an isolated workspace data directory and verifies:

- Automatic discovery of `haystack` and `needle` in the supplied example.
- Real Java execution of `hello` / `ll`, returning `2`.
- Recorded condition results and actual operand values in the UI.
- Real C++ vector execution returning `20`, stack/queue execution returning `7`, and map execution returning `6`.
- Animated canvas replay producing changing pixels and settling, numeric bars, before/after changes, iterator transfers, swaps, and container-specific diagrams.
- Shared table/canvas playback and saved C++ histories whose language, inputs, and result are restored when opened after restart.
- JSON export containing condition operands.
- Rejection of unauthenticated desktop API calls.
- Removal of a simulated previous-build page cache before each launch.
- Native shutdown, terminated service processes, and a closed frontend port.
- Relaunch using the same data directory, with saved history and restored inputs/result.

Screenshots and `verification.json` are written to `.data/desktop-test-<id>/`. Export destinations are redirected into that same test directory. Normal releases do not enable remote debugging or create test evidence. Pass an alternate executable path as `npm run test:desktop -- <path>` when checking a development release.

The Windows x64 v0.2.0 release was built and installed on 20 October 2026. Native acceptance passed for the built executable and the installed copy using bundled Node 22.20.0 and Java 17.0.17, with external MSYS2 UCRT64 Clang 22.1.8. Java returned `2`; the C++ vector, stack/queue, and map examples returned `20`, `7`, and `6`. Canvas motion, shared table playback, export, authentication, stale-page cleanup, shutdown, and Java/C++ history reopening passed. All 20 unit tests and TypeScript checks passed.

Both release checksums and all 2,633 portable ZIP files were verified. The installed copy's 2,631 payload files match the portable release; its executable differs only in Tauri's three-byte NSIS bundle-type marker. Existing desktop history/session files were unchanged by installation. Release and installation verification records are in `.data/release-verification-0.2.0.json` and `.data/installed-verification-0.2.0.json`; native evidence is in `.data/desktop-test-<id>/`.

The Windows release profile is the supported package target in this revision. macOS and Linux require native builds, platform-specific runtimes, packaging configuration, and lifecycle testing before they can be distributed.
