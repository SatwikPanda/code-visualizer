import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  rm,
  readFile,
  writeFile,
  readdir,
  access,
  rename,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const payload = path.join(root, "src-tauri/resources/payload");
const cache = path.join(root, ".data/desktop-cache");
function run(executable, args, env = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`${path.basename(executable)} failed (${result.status})`);
}
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
async function reset(directory) {
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(root + path.sep) || resolved === root)
    throw new Error("Build cleanup escaped the workspace");
  await rm(resolved, { recursive: true, force: true });
  await mkdir(resolved, { recursive: true });
}
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("This release profile targets Windows x64.");
await mkdir(cache, { recursive: true });
console.log("Preparing Tauri icons and standalone Next.js…");
run(process.execPath, [
  "node_modules/@tauri-apps/cli/tauri.js",
  "icon",
  "src-tauri/icons/icon.svg",
  "--output",
  "src-tauri/icons",
]);
if (process.env.CODEVIZ_REUSE_DESKTOP_WEB !== "1")
  run(
    process.execPath,
    ["node_modules/next/dist/bin/next", "build", "apps/web", "--webpack"],
    { CODEVIZ_DESKTOP_BUILD: "1", NEXT_TELEMETRY_DISABLED: "1" },
  );
await reset(payload);
console.log("Copying the production server and local editor assets…");
await cp(
  path.join(root, "apps/web/.next/standalone"),
  path.join(payload, "web"),
  { recursive: true, dereference: true },
);
const webApp = path.join(payload, "web/apps/web");
if (!(await exists(path.join(webApp, "server.js"))))
  throw new Error("Standalone Next.js server is missing.");
// Next emits a CommonJS entry point, but our monorepo root declares ESM.
// Keep the generated .next package boundaries intact and mark only this entry as CJS.
await rename(path.join(webApp, "server.js"), path.join(webApp, "server.cjs"));
await cp(
  path.join(root, "apps/web/.next/static"),
  path.join(webApp, ".next/static"),
  { recursive: true, dereference: true },
);
// The asset script has no dependencies and keeps Monaco completely offline.
run(process.execPath, ["scripts/assets.mjs"]);
await cp(path.join(root, "apps/web/public"), path.join(webApp, "public"), {
  recursive: true,
  dereference: true,
});
await cp(
  path.join(root, "desktop/bootstrap.cjs"),
  path.join(payload, "bootstrap.cjs"),
);
await build({
  entryPoints: [path.join(root, "apps/runner/src/index.ts")],
  outfile: path.join(payload, "runner.cjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: false,
});
await mkdir(path.join(payload, "node"), { recursive: true });
await cp(process.execPath, path.join(payload, "node/node.exe"));
let javaHome = process.env.JAVA_HOME;
if (!javaHome) {
  const result = spawnSync("java", ["-XshowSettings:properties", "-version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  javaHome = result.stderr.match(/java\.home\s*=\s*(.+)/)?.[1]?.trim();
}
if (!javaHome || !(await exists(path.join(javaHome, "bin/jlink.exe"))))
  throw new Error(
    "A full JDK with jlink is required to build the bundled runtime.",
  );
console.log("Compiling Java tools and creating a bundled Java runtime…");
const tools = path.join(payload, "java-tools");
await mkdir(tools, { recursive: true });
const javaSources = (await readdir(path.join(root, "java/src/codeviz")))
  .filter((file) => file.endsWith(".java"))
  .map((file) => path.join(root, "java/src/codeviz", file));
run(path.join(javaHome, "bin/javac.exe"), [
  "--add-modules",
  "jdk.jdi,jdk.compiler",
  "-g",
  "-encoding",
  "UTF-8",
  "-d",
  tools,
  ...javaSources,
]);
const javaRelease = await readFile(path.join(javaHome, "release"), "utf8");
const fingerprint = createHash("sha256")
  .update(javaRelease)
  .digest("hex")
  .slice(0, 16);
const runtime = path.join(cache, `java-${fingerprint}`);
if (!(await exists(path.join(runtime, "bin/java.exe")))) {
  if (await exists(runtime)) await reset(runtime);
  // jlink requires the output path not to exist.
  if (await exists(runtime))
    await rm(runtime, { recursive: true, force: true });
  run(path.join(javaHome, "bin/jlink.exe"), [
    "--module-path",
    path.join(javaHome, "jmods"),
    "--add-modules",
    "ALL-MODULE-PATH",
    "--strip-debug",
    "--no-header-files",
    "--no-man-pages",
    "--compress=2",
    "--output",
    runtime,
  ]);
}
await cp(runtime, path.join(payload, "java"), {
  recursive: true,
  dereference: true,
});
run(path.join(payload, "java/bin/java.exe"), [
  "--add-modules",
  "jdk.jdi,jdk.compiler",
  "-version",
]);
const licenses = path.join(payload, "licenses");
await mkdir(licenses, { recursive: true });
const nodeLicense = path.join(
  cache,
  `node-${process.versions.node}-LICENSE.txt`,
);
if (!(await exists(nodeLicense))) {
  const response = await fetch(
    `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok)
    throw new Error("Unable to retrieve the bundled Node.js license.");
  await writeFile(nodeLicense, await response.text());
}
await cp(nodeLicense, path.join(licenses, "Node.js-LICENSE.txt"));
for (const name of [
  "next",
  "react",
  "react-dom",
  "monaco-editor",
  "zod",
  "lucide-react",
  "@monaco-editor/react",
  "@tanstack/react-virtual",
]) {
  const directory = path.join(root, "node_modules", name);
  for (const file of await readdir(directory))
    if (/^(license|notice|copying)(\.|$)/i.test(file)) {
      const source = path.join(directory, file);
      try {
        await cp(
          source,
          path.join(licenses, `${name.replaceAll("/", "_")}-${file}`),
        );
      } catch {}
    }
}
await writeFile(
  path.join(payload, "runtime-manifest.json"),
  JSON.stringify(
    {
      appVersion: version,
      languages: ["java", "cpp"],
      cppToolchain: "external-clang-c++20",
      visualizations: ["step-table", "animated-canvas"],
      target: "x86_64-pc-windows-msvc",
      node: process.versions.node,
      java: javaRelease.match(/JAVA_VERSION="([^"]+)"/)?.[1],
      javaModules: "ALL-MODULE-PATH",
      builtAt: new Date().toISOString(),
      nodeSha256: createHash("sha256")
        .update(await readFile(process.execPath))
        .digest("hex"),
    },
    null,
    2,
  ),
);
await writeFile(
  path.join(licenses, "README.txt"),
  "Code Visualizer bundles Node.js, OpenJDK, Next.js, React, Monaco, and their dependencies. Runtime licenses are included here and in java/legal. OpenJDK is distributed under GPLv2 with the Classpath Exception; source and build information: https://github.com/adoptium/temurin17-binaries/releases . Frontend dependency license files are retained alongside their packages and compiled assets. Tauri uses MIT or Apache-2.0 licensed components: https://github.com/tauri-apps/tauri .\n",
);
console.log(`Desktop payload ready: ${payload}`);
