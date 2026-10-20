import { spawnSync } from "node:child_process";
import { mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const target = path.join(
  root,
  "src-tauri/target/x86_64-pc-windows-msvc/release",
);
const stagedPayload = path.resolve(target, "payload");
if (
  !stagedPayload.startsWith(path.resolve(root, "src-tauri/target") + path.sep)
)
  throw new Error("Invalid staged desktop payload path");
await rm(stagedPayload, { recursive: true, force: true });
const cli = path.join(root, "node_modules/@tauri-apps/cli/tauri.js");
const result = spawnSync(
  process.execPath,
  [cli, "build", "--target", "x86_64-pc-windows-msvc"],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
if (result.status !== 0) process.exit(result.status || 1);
const output = path.join(root, "release"),
  portable = path.join(output, "CodeVisualizer-windows-x64");
await mkdir(output, { recursive: true });
if (!portable.startsWith(root + path.sep) || portable === root)
  throw new Error("Invalid release path");
await rm(portable, { recursive: true, force: true });
await mkdir(portable, { recursive: true });
await cp(
  path.join(target, "CodeVisualizer.exe"),
  path.join(portable, "CodeVisualizer.exe"),
);
await cp(
  path.join(root, "src-tauri/resources/payload"),
  path.join(portable, "payload"),
  { recursive: true, dereference: true },
);
const installer = `Code Visualizer_${version}_x64-setup.exe`;
await cp(
  path.join(target, "bundle/nsis", installer),
  path.join(output, installer),
);
await writeFile(
  path.join(portable, "README.txt"),
  `Code Visualizer ${version} — Windows x64\r\nRun CodeVisualizer.exe. Keep the payload folder next to it. Includes Java and C++20 tracing, the step table, and animated canvas. Node.js and Java are bundled. C++ requires an installed Clang C++20 toolchain with standard-library headers on PATH (or CODEVIZ_CLANGXX); its bin directory must be on PATH for runtime DLLs. WebView2 Runtime is required (the setup installer handles it). Saved executions are in %LOCALAPPDATA%\\dev.codevisualizer.desktop. Programs execute locally: run code you trust.\r\n`,
);
const zip = path.join(
  output,
  `CodeVisualizer_${version}_windows-x64_portable.zip`,
);
// Fixed script body; file paths travel through environment variables, not shell interpolation.
const archive = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Compress-Archive -LiteralPath $env:CODEVIZ_ARCHIVE_SOURCE -DestinationPath $env:CODEVIZ_ARCHIVE_DEST -CompressionLevel Optimal -Force",
  ],
  {
    env: {
      ...process.env,
      CODEVIZ_ARCHIVE_SOURCE: portable,
      CODEVIZ_ARCHIVE_DEST: zip,
    },
    stdio: "inherit",
    windowsHide: true,
  },
);
if (archive.status !== 0) throw new Error("Unable to create portable ZIP");
const files = [installer, path.basename(zip)];
const hashes = await Promise.all(
  files.map(
    async (name) =>
      `${createHash("sha256")
        .update(await readFile(path.join(output, name)))
        .digest("hex")}  ${name}`,
  ),
);
await writeFile(path.join(output, "SHA256SUMS.txt"), hashes.join("\n") + "\n");
console.log(
  `Release installer: ${path.join(output, installer)}\nPortable ZIP: ${zip}`,
);
