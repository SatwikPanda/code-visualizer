import { chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portable = path.join(
  root,
  "release/CodeVisualizer-windows-x64/CodeVisualizer.exe",
);
const executable = path.resolve(
  process.argv[2] ||
    process.env.CODEVIZ_TEST_EXE ||
    (existsSync(portable)
      ? portable
      : path.join(
          root,
          "src-tauri/target/x86_64-pc-windows-msvc/release/CodeVisualizer.exe",
        )),
);
assert.ok(
  existsSync(executable),
  `Release executable is missing: ${executable}`,
);
const data = path.join(root, ".data", `desktop-test-${randomUUID()}`);
await mkdir(data, { recursive: true });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class StartupFailure extends Error {}
async function waitFor(check, message, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check().catch((error) => {
      if (error instanceof StartupFailure) throw error;
      return undefined;
    });
    if (value) return value;
    await delay(200);
  }
  throw new Error(message);
}
async function port() {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const value = socket.address().port;
      socket.close(() => resolve(value));
    });
  });
}
let native, browser, runtime;
async function launch() {
  await rm(path.join(data, "test-runtime.json"), { force: true });
  const cdp = await port();
  await writeFile(path.join(data, "test-debug-port.txt"), String(cdp));
  // Deliberately omit system Node and Java from PATH; the release must use its payload.
  native = spawn(executable, [], {
    windowsHide: true,
    env: {
      ...process.env,
      PATH: path.join(process.env.SystemRoot, "System32"),
      JAVA_HOME: "",
      CODEVIZ_DESKTOP_DATA_DIR: data,
      CODEVIZ_DESKTOP_TEST: "1",
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdp}`,
      WEBVIEW2_USER_DATA_FOLDER: path.join(data, "webview"),
    },
    stdio: "ignore",
  });
  let launchError;
  native.once("error", (error) => {
    launchError = error;
  });
  await waitFor(async () => {
    if (launchError) throw new StartupFailure(launchError.message);
    if (native.exitCode !== null)
      throw new StartupFailure("Native process exited");
    return (
      await fetch(`http://127.0.0.1:${cdp}/json/version`, {
        signal: AbortSignal.timeout(800),
      })
    ).ok;
  }, "WebView2 did not start");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`);
  // Playwright defaults CDP contexts to deny downloads. Restore the native
  // WebView2 policy so Tauri's real download handler is exercised by this test.
  const protocol = await browser.newBrowserCDPSession();
  await protocol.send("Browser.setDownloadBehavior", { behavior: "default" });
  await protocol.detach();
  // Tauri's native navigate may replace the startup document while CDP attaches.
  // Observe the final page instead of waiting on a navigation of the old frame.
  const page = await waitFor(async () => {
    return browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => {
        const url = new URL(candidate.url());
        return (
          url.protocol === "http:" &&
          url.hostname === "127.0.0.1" &&
          url.pathname === "/"
        );
      });
  }, "Desktop workspace did not appear");
  runtime = JSON.parse(
    await readFile(path.join(data, "test-runtime.json"), "utf8"),
  );
  await expect(
    page.getByRole("heading", { name: "Program inputs", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  console.log("Native workspace loaded.");
  return page;
}
async function close() {
  if (!native) return;
  const id = native.pid;
  // Ask this owned test window to close normally, exercising Tauri's shutdown path.
  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-Process -Id $env:CODEVIZ_TEST_APP_PID -ErrorAction Stop).CloseMainWindow() | Out-Null",
    ],
    {
      env: { ...process.env, CODEVIZ_TEST_APP_PID: String(id) },
      windowsHide: true,
    },
  );
  await waitFor(
    async () => native.exitCode !== null,
    "Desktop app did not close",
    15000,
  );
  for (const childPid of runtime?.pids || []) {
    await waitFor(
      async () => {
        try {
          process.kill(childPid, 0);
          return false;
        } catch {
          return true;
        }
      },
      `Packaged service ${childPid} survived app exit`,
      10000,
    );
  }
  await browser?.close().catch(() => {});
  browser = undefined;
  native = undefined;
}
try {
  let page = await launch();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const unauthenticated = await fetch(`${runtime.base}/api/runs`);
  assert.equal(
    unauthenticated.status,
    401,
    "Desktop API must reject requests without the launch cookie",
  );
  await expect(
    page.getByRole("textbox", { name: "haystack", exact: true }),
  ).toHaveValue("hello", { timeout: 30000 });
  await expect(
    page.getByRole("textbox", { name: "needle", exact: true }),
  ).toHaveValue("ll");
  await page.getByRole("button", { name: "Run & visualize" }).click();
  await expect(page.getByTestId("return-value")).toHaveText("2", {
    timeout: 30000,
  });
  console.log("Bundled Java returned 2.");
  await page
    .getByRole("button", { name: "Last observation", exact: true })
    .click();
  await expect(page.getByTestId("condition-equation")).toHaveText(
    "(1 == 2 - 1)→true",
  );
  await expect(page.getByLabel("Recorded operand values")).toContainText(
    "needleLength=2",
  );
  await expect(page.getByTestId("execution-item")).toHaveCount(1);
  await page.screenshot({
    path: path.join(data, "desktop-release.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const exported = await waitFor(
    async () => {
      const files = await readdir(path.join(data, "exports"));
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            return JSON.parse(
              await readFile(path.join(data, "exports", file), "utf8"),
            );
          } catch {}
        }
      }
    },
    "Native JSON export did not finish",
    15000,
  );
  assert.ok(
    exported.events?.some((event) => event.condition?.operands?.length),
    "Export must retain actual condition operands",
  );
  assert.deepEqual(errors, []);
  const previousPorts = { base: runtime.base, runnerPort: runtime.runnerPort };
  await close();
  console.log("Native shutdown and child cleanup passed.");
  assert.equal(
    await fetch(previousPorts.base, { signal: AbortSignal.timeout(800) }).then(
      () => true,
      () => false,
    ),
    false,
    "Web service must stop",
  );
  page = await launch();
  await expect(page.getByTestId("execution-item")).toHaveCount(1, {
    timeout: 30000,
  });
  await page.getByTestId("execution-item").click();
  await expect(page.getByTestId("return-value")).toHaveText("2", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("textbox", { name: "haystack", exact: true }),
  ).toHaveValue("hello");
  await close();
  await writeFile(
    path.join(data, "verification.json"),
    JSON.stringify(
      {
        passed: true,
        executable,
        nodeAndJavaRemovedFromPath: true,
        result: 2,
        conditionOperands: true,
        export: true,
        restartHistory: true,
        desktopAuthentication: true,
        processCleanup: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `Desktop release verified: detect inputs → real Java → operands → return 2; export; restart/history; authenticated API; service cleanup.\nEvidence: ${data}`,
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page
      .screenshot({ path: path.join(data, "failure.png") })
      .catch(() => {});
    await writeFile(
      path.join(data, "failure.txt"),
      `${page.url().split("?")[0]}\n${await page
        .locator("body")
        .innerText()
        .catch(() => "Unavailable")}`,
    ).catch(() => {});
  }
  console.error(`Desktop failure evidence: ${data}`);
  throw error;
} finally {
  if (native) {
    spawnSync("taskkill.exe", ["/PID", String(native.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
  await browser?.close().catch(() => {});
}
