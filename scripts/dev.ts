import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
const local = process.argv.includes("--local");
const production = process.argv.includes("--production");
for (const script of [...(local ? ["scripts/build-java.mjs"] : []), "scripts/assets.mjs"]) {
  const r = spawnSync(process.execPath, [script], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
const env = {
  ...process.env,
  RUNNER_SECRET: process.env.RUNNER_SECRET || randomBytes(32).toString("hex"),
  CODEVIZ_BACKEND: local ? "local" : "docker",
  CODEVIZ_ALLOW_LOCAL: local ? "1" : "0",
};
if (local)
  console.log(
    "LOCAL DEVELOPMENT MODE: submitted programs run on this computer. Use only code you trust. Both services bind to 127.0.0.1.",
  );
const children: ChildProcess[] = [];
children.push(
  spawn(process.execPath, ["--import", "tsx", "apps/runner/src/index.ts"], {
    env,
    stdio: "inherit",
    windowsHide: true,
  }),
);
children.push(
  spawn(
    process.execPath,
    [
      path.resolve("node_modules/next/dist/bin/next"),
      production ? "start" : "dev",
      "apps/web",
      "--hostname",
      "127.0.0.1",
      "--port",
      process.env.WEB_PORT || "3000",
      ...(!production ? ["--webpack"] : []),
    ],
    { env, stdio: "inherit", windowsHide: true },
  ),
);
function stop() {
  for (const child of children) child.kill();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stop();
    setTimeout(() => process.exit(), 1500).unref();
  });
for (const child of children)
  child.on("exit", (code) => {
    if (code) {
      stop();
      process.exitCode = code;
    }
  });
