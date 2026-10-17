import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
mkdirSync(".data/java", { recursive: true });
const executable = process.env.JAVA_HOME
  ? path.join(
      process.env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "javac.exe" : "javac",
    )
  : "javac";
const sources = readdirSync("java/src/codeviz")
  .filter((x) => x.endsWith(".java"))
  .map((x) => `java/src/codeviz/${x}`);
const result = spawnSync(
  executable,
  [
    "--add-modules",
    "jdk.jdi,jdk.compiler",
    "-g",
    "-encoding",
    "UTF-8",
    "-d",
    ".data/java",
    ...sources,
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
