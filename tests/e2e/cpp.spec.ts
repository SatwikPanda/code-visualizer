import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { TraceEvent } from "../../packages/contracts/src/index";
async function runCpp(page: Page, source: string, args: unknown[]) {
  let analysis = await (
    await page.request.post("/api/analyses", {
      data: { languageId: "cpp", source },
    })
  ).json();
  await expect
    .poll(
      async () => {
        analysis = await (
          await page.request.get(`/api/analyses/${analysis.id}`)
        ).json();
        return analysis.status;
      },
      { timeout: 30000 },
    )
    .toBe("ready");
  let run = await (
    await page.request.post("/api/runs", {
      data: {
        analysisId: analysis.id,
        sourceHash: analysis.sourceHash,
        entryPointId: analysis.entryPoints[0].id,
        args,
        stdin: "",
        idempotencyKey: randomUUID(),
      },
    })
  ).json();
  await expect
    .poll(
      async () => {
        run = await (await page.request.get(`/api/runs/${run.id}`)).json();
        return run.status;
      },
      { timeout: 30000 },
    )
    .toBe("completed");
  await page.evaluate(
    (id) => localStorage.setItem("codeviz-last-run", id),
    run.id,
  );
  await page.reload();
  return run.id as string;
}
async function settledCanvas(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect
    .poll(() =>
      page
        .locator(".canvas-scroll canvas")
        .evaluate((node: HTMLCanvasElement) => {
          const pixels = node
            .getContext("2d")!
            .getImageData(0, 0, node.width, node.height).data;
          return pixels.some((value, index) => index % 4 === 3 && value > 0);
        }),
    )
    .toBe(true);
  await expect(page.locator(".canvas-scroll canvas")).toHaveAttribute(
    "data-animation-state",
    "settled",
  );
}
test("C++20 runs, canvas and table share playback, history restores language, and mobile remains usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "C++", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "values", exact: true }),
  ).toHaveValue('["4","2","6"]', { timeout: 30000 });
  await page.getByRole("button", { name: "Run & visualize" }).click();
  await expect(page.getByTestId("return-value")).toHaveText("20", {
    timeout: 45000,
  });
  await page
    .getByRole("button", { name: "Animated canvas", exact: true })
    .click();
  await page.getByLabel("Seek recording").fill("7");
  await expect(page.locator(".canvas-scroll canvas")).toBeVisible();
  await expect(page.locator(".canvas-explanation")).toContainText("L8");
  const step = await page.getByLabel("Seek recording").inputValue();
  await page.getByRole("button", { name: "Step table", exact: true }).click();
  await expect(page.getByLabel("Execution trace table")).toBeVisible();
  await expect(page.getByLabel("Seek recording")).toHaveValue(step);
  await page
    .getByRole("button", { name: "Animated canvas", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Next observation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replay step animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
  await page.getByLabel("Seek recording").fill("9");
  await expect(page.getByLabel("Step explanation")).toContainText(
    "Read a value into a variable",
  );
  await expect(page.getByLabel("Before and after values")).toContainText("+4");
  await page
    .getByRole("button", { name: "Show numeric values as bars" })
    .click();
  await expect(
    page.getByRole("button", { name: "Show numeric values as bars" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Seek recording")).toHaveValue("9");
  await page
    .getByRole("button", { name: "Show numeric values as bars" })
    .click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1300 });
  await settledCanvas(page);
  await page.screenshot({
    path: ".data/screenshots/cpp-canvas-desktop.png",
    fullPage: true,
  });
  await page
    .locator(".animation-view")
    .screenshot({ path: ".data/screenshots/canvas-explainer.png" });
  await page.setViewportSize({ width: 1092, height: 825 });
  await settledCanvas(page);
  await page.screenshot({
    path: ".data/screenshots/cpp-canvas-user-1092.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1300 });
  await settledCanvas(page);
  const runId = await page
    .getByTestId("execution-item")
    .first()
    .getAttribute("data-run-id");
  const trace = (await (
    await page.request.get(`/api/runs/${runId}/trace?limit=1000`)
  ).json()) as { events: TraceEvent[] };
  const swapIndex = trace.events
    .filter((e) => e.kind === "observation" && !e.setup)
    .findIndex((e) => e.line === 11 && e.phase === "after-instruction");
  expect(swapIndex).toBeGreaterThan(0);
  await page.getByLabel("Seek recording").fill(String(swapIndex));
  await expect(page.getByLabel("Step explanation")).toContainText(
    "Two values exchange places",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await settledCanvas(page);
  const finalPixels = await page
    .locator(".canvas-scroll canvas")
    .evaluate((node: HTMLCanvasElement) => node.toDataURL());
  await page.getByRole("button", { name: "Replay step animation" }).click();
  await expect
    .poll(() =>
      page
        .locator(".canvas-scroll canvas")
        .evaluate(
          (node: HTMLCanvasElement, expected: string) =>
            node.toDataURL() === expected,
          finalPixels,
        ),
    )
    .toBe(false);
  await expect(page.locator(".canvas-scroll canvas")).toHaveAttribute(
    "data-animation-state",
    "settled",
  );
  // Repeated canvas draws can switch browser rasterization paths. Allow tiny
  // antialiasing differences while requiring the replay to reach the same image.
  await expect
    .poll(() =>
      page
        .locator(".canvas-scroll canvas")
        .evaluate(async (node: HTMLCanvasElement, expected: string) => {
          const image = new Image();
          image.src = expected;
          await image.decode();
          const reference = document.createElement("canvas");
          reference.width = node.width;
          reference.height = node.height;
          const ctx = reference.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          const before = ctx.getImageData(0, 0, node.width, node.height).data;
          const after = node
            .getContext("2d")!
            .getImageData(0, 0, node.width, node.height).data;
          let difference = 0;
          for (let i = 0; i < before.length; i++)
            difference += Math.abs(before[i] - after[i]);
          return difference / before.length;
        }, finalPixels),
    )
    .toBeLessThan(0.5);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .locator(".animation-view")
    .screenshot({ path: ".data/screenshots/canvas-swap.png" });
  await page.getByLabel("Seek recording").fill("6");
  await expect(page.getByLabel("Step explanation")).toContainText(
    "Condition is true",
  );
  await expect(
    page.getByRole("img", { name: "Recorded true branch", exact: true }),
  ).toBeVisible();
  await page
    .locator(".animation-view")
    .screenshot({ path: ".data/screenshots/canvas-condition.png" });
  await page.reload();
  await expect(page.getByTestId("return-value")).toHaveText("20", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "C++", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Animated canvas", exact: true })
    .click();
  await page.getByLabel("Seek recording").fill("9");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await expect(page.locator(".canvas-scroll canvas")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await settledCanvas(page);
  await page.screenshot({
    path: ".data/screenshots/cpp-canvas-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Next observation", exact: true })
    .click();
  await page.getByRole("button", { name: "Step table", exact: true }).click();
  await expect(page.getByLabel("Execution trace table")).toBeVisible();
  expect(errors).toEqual([]);
});

test("stack and map examples have their own canvas representations", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "C++", exact: true }).click();
  for (const [example, expected, step] of [
    ["stack", "7", "10"],
    ["map", "6", "8"],
  ]) {
    await page.getByLabel("C++ example").selectOption(example);
    await page
      .getByRole("button", { name: "Load example", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Run & visualize" }),
    ).toBeEnabled({ timeout: 30000 });
    await page.getByRole("button", { name: "Run & visualize" }).click();
    await expect(page.getByTestId("return-value")).toHaveText(expected, {
      timeout: 30000,
    });
    await page
      .getByRole("button", { name: "Animated canvas", exact: true })
      .click();
    await page.getByLabel("Seek recording").fill(step);
    if (example === "map")
      await expect(page.getByLabel("Before and after values")).toContainText(
        'counts["red"]',
      );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1300 });
    await settledCanvas(page);
    await page.screenshot({
      path: `.data/screenshots/cpp-${example}-canvas.png`,
      fullPage: true,
    });
    if (example === "stack") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Trace", exact: true }).click();
      await settledCanvas(page);
      await page.screenshot({
        path: ".data/screenshots/cpp-stack-canvas-mobile.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1300 });
    }
  }
  await page.getByRole("button", { name: "Java", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run & visualize" }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Run & visualize" }).click();
  await expect(page.getByTestId("return-value")).toHaveText("2", {
    timeout: 30000,
  });
  await expect(page.locator(".canvas-scroll canvas")).toBeVisible();
  await page
    .getByRole("button", { name: "Last observation", exact: true })
    .click();
  await expect(page.locator(".canvas-scroll canvas")).toHaveAttribute(
    "aria-label",
    /haystack/,
  );
});

test("two iterators sharing a cell retain separate labels and move independently", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Run & visualize" }),
  ).toBeEnabled({ timeout: 30000 });
  await runCpp(
    page,
    "#include <vector>\nint track(std::vector<int> values) { auto left=values.begin(); auto right=values.begin(); ++right; return *left+*right; }",
    [["4", "2", "6"]],
  );
  await expect(page.getByTestId("return-value")).toHaveText("6", {
    timeout: 30000,
  });
  await page
    .getByRole("button", { name: "Animated canvas", exact: true })
    .click();
  await page.getByLabel("Seek recording").fill("4");
  await expect(page.locator(".canvas-scroll canvas")).toHaveAttribute(
    "aria-label",
    /left → \[0\].*right → \[0\]/,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1300 });
  await settledCanvas(page);
  await page.screenshot({
    path: ".data/screenshots/cpp-two-iterators-canvas.png",
    fullPage: true,
  });
  await page.getByLabel("Seek recording").fill("6");
  await expect(page.locator(".canvas-scroll canvas")).toHaveAttribute(
    "aria-label",
    /right → \[1\]/,
  );
});

test("transferred large integers keep their exact recorded value", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Run & visualize" }),
  ).toBeEnabled({ timeout: 30000 });
  const value = "9223372036854775807";
  const runId = await runCpp(
    page,
    "#include <vector>\nlong long readValue(std::vector<long long> values) {\nlong long result = 0;\nresult = values[0];\nreturn result;\n}",
    [[value]],
  );
  await expect(page.getByTestId("return-value")).toHaveText(value, {
    timeout: 30000,
  });
  const trace = (await (
    await page.request.get(`/api/runs/${runId}/trace?limit=1000`)
  ).json()) as { events: TraceEvent[] };
  const index = trace.events
    .filter((e) => e.kind === "observation" && !e.setup)
    .findIndex((e) => e.line === 4 && e.phase === "after-instruction");
  expect(index).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Animated canvas", exact: true })
    .click();
  await page.getByLabel("Seek recording").fill(String(index));
  await expect(page.getByLabel("Step explanation")).toContainText(value);
  await expect(page.locator(".canvas-scroll canvas")).toHaveAttribute(
    "aria-label",
    new RegExp(`read → result: ${value}`),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1300 });
  await settledCanvas(page);
  await page
    .locator(".animation-view")
    .screenshot({ path: ".data/screenshots/canvas-long-value.png" });
});
