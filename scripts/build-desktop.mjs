import { spawnSync } from "node:child_process";
import { mkdir, cp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const target = path.join(
  root,
  "src-tauri/target/x86_64-pc-windows-msvc/release",
);
await cp(
  path.join(target, "CodeVisualizer.exe"),
  path.join(portable, "CodeVisualizer.exe"),
);
await cp(
  path.join(root, "src-tauri/resources/payload"),
  path.join(portable, "payload"),
  { recursive: true, dereference: true },
);
const installers = (await readdir(path.join(target, "bundle/nsis"))).filter(
  (file) => file.endsWith("-setup.exe"),
);
if (installers.length !== 1)
  throw new Error("Expected one NSIS release installer");
await cp(
  path.join(target, "bundle/nsis", installers[0]),
  path.join(output, installers[0]),
);
await writeFile(
  path.join(portable, "README.txt"),
  "Code Visualizer 0.1.0 — Windows x64\r\nRun CodeVisualizer.exe. Keep the payload folder next to it. Node.js and Java are bundled; WebView2 Runtime is required (the setup installer handles it). Saved executions are in %LOCALAPPDATA%\\dev.codevisualizer.desktop. Java executes locally: run code you trust.\r\n",
);
const zip = path.join(output, "CodeVisualizer_0.1.0_windows-x64_portable.zip");
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
const files = [installers[0], path.basename(zip)];
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
  `Release installer: ${path.join(output, installers[0])}\nPortable ZIP: ${zip}`,
);
