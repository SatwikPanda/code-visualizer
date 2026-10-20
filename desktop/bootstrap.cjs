// Packaged backend supervisor. No npm, system Node, or system Java is used at runtime.
const { spawn } = require("node:child_process");
const { randomBytes, randomUUID } = require("node:crypto");
const { createServer } = require("node:net");
const {
  mkdirSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
  existsSync,
  rmSync,
} = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const root = __dirname,
  data = path.resolve(process.argv[2]);
mkdirSync(data, { recursive: true });
const log = createWriteStream(path.join(data, "services.log"), { flags: "a" });
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  log.end();
  setTimeout(() => process.exit(code), 500).unref();
}
function fork(file, env) {
  const child = spawn(process.execPath, [file], {
    env,
    cwd: data,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.once("exit", (code) => {
    if (!stopping) {
      console.error(
        `${path.basename(file)} exited (${code}). See services.log.`,
      );
      stop(1);
    }
  });
  return child;
}
async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
async function start() {
  // Generated Next page responses can survive a desktop upgrade beside the
  // bundled files. Always start from this build's immutable prerendered pages.
  const serverDirectory = path.resolve(root, "web/apps/web/.next/server");
  const pageCache = path.resolve(serverDirectory, "route-cache");
  if (!pageCache.startsWith(serverDirectory + path.sep))
    throw new Error("Invalid generated page-cache path");
  rmSync(pageCache, { recursive: true, force: true });
  const sessionFile = path.join(data, "desktop-session.json");
  let owner;
  if (existsSync(sessionFile)) {
    const session = JSON.parse(readFileSync(sessionFile, "utf8"));
    if (/^[-\w]{36}$/.test(session.owner)) owner = session.owner;
  }
  if (!owner) {
    owner = randomUUID();
    writeFileSync(sessionFile, JSON.stringify({ owner }), { mode: 0o600 });
  }
  const env = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    CODEVIZ_BACKEND: "local",
    CODEVIZ_ALLOW_LOCAL: "1",
    CODEVIZ_DESKTOP_MODE: "1",
    CODEVIZ_DESKTOP_OWNER: owner,
    CODEVIZ_DESKTOP_TOKEN: randomBytes(32).toString("hex"),
    RUNNER_SECRET: randomBytes(32).toString("hex"),
    RUNNER_DATA_DIR: path.join(data, "executions"),
    CODEVIZ_JAVA_CLASSES: path.join(root, "java-tools"),
    JAVA_HOME: path.join(root, "java"),
    RUNNER_PORT: "0",
  };
  delete env.NODE_OPTIONS;
  const runner = fork(path.join(root, "runner.cjs"), env);
  const runnerPort = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Execution service startup timed out")),
      30000,
    );
    const lines = readline.createInterface({ input: runner.stdout });
    lines.on("line", (line) => {
      if (line.startsWith("CODEVIZ_RUNNER_READY ")) {
        clearTimeout(timeout);
        lines.close();
        resolve(Number(line.slice(21)));
      }
    });
    runner.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Execution service did not start"));
    });
  });
  env.RUNNER_BASE_URL = `http://127.0.0.1:${runnerPort}`;
  const port = await availablePort();
  env.PORT = String(port);
  env.HOSTNAME = "127.0.0.1";
  fork(path.join(root, "web", "apps", "web", "server.cjs"), env);
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 120; n++) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        if (process.env.CODEVIZ_DESKTOP_TEST === "1")
          writeFileSync(
            path.join(data, "test-runtime.json"),
            JSON.stringify({
              base,
              runnerPort,
              pids: children.map((child) => child.pid),
            }),
          );
        process.stdout.write(
          `CODEVIZ_READY ${base}/desktop/launch?token=${env.CODEVIZ_DESKTOP_TOKEN}\n`,
        );
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Workspace startup timed out");
}
process.stdin.setEncoding("utf8");
process.stdin.once("data", (input) => {
  if (input.trim() === "START")
    start().catch((error) => {
      console.error(error);
      stop(1);
    });
  else stop(1);
});
process.stdin.on("end", () => stop());
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
