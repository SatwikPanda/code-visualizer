import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1300 });
  await settledCanvas(page);
  await page.screenshot({
    path: ".data/screenshots/cpp-canvas-desktop.png",
    fullPage: true,
  });
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
  await page.getByLabel("Seek recording").fill("7");
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
    ["map", "6", "12"],
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
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1300 });
    await settledCanvas(page);
    await page.screenshot({
      path: `.data/screenshots/cpp-${example}-canvas.png`,
      fullPage: true,
    });
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
  let analysis = await (
    await page.request.post("/api/analyses", {
      data: {
        languageId: "cpp",
        source:
          "#include <vector>\nint track(std::vector<int> values) { auto left=values.begin(); auto right=values.begin(); ++right; return *left+*right; }",
      },
    })
  ).json();
  for (
    let n = 0;
    analysis.status === "queued" || analysis.status === "analyzing";
    n++
  ) {
    expect(n).toBeLessThan(150);
    await new Promise((r) => setTimeout(r, 100));
    analysis = await (
      await page.request.get(`/api/analyses/${analysis.id}`)
    ).json();
  }
  expect(analysis.status).toBe("ready");
  let run = await (
    await page.request.post("/api/runs", {
      data: {
        analysisId: analysis.id,
        sourceHash: analysis.sourceHash,
        entryPointId: analysis.entryPoints[0].id,
        args: [["4", "2", "6"]],
        stdin: "",
        idempotencyKey: randomUUID(),
      },
    })
  ).json();
  for (let n = 0; run.status !== "completed"; n++) {
    expect(n).toBeLessThan(200);
    await new Promise((r) => setTimeout(r, 100));
    run = await (await page.request.get(`/api/runs/${run.id}`)).json();
  }
  await page.evaluate(
    (id) => localStorage.setItem("codeviz-last-run", id),
    run.id,
  );
  await page.reload();
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
