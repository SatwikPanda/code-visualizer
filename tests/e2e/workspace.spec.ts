import { test, expect } from "@playwright/test";
test("the supplied Java example works from input detection through replay and output", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByLabel("Code Visualizer home")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Java", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(24, 24, 24)",
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
  await expect(
    page.getByRole("columnheader", { name: "occurence", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "j", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Last observation", exact: true })
    .click();
  await expect(page.getByLabel("Selected observation values")).toContainText(
    "occurence",
  );
  await expect(page.getByLabel("Selected observation values")).toContainText(
    "2",
  );
  await expect(
    page.locator(".monaco-editor .condition-inline.condition-true").first(),
  ).toBeVisible();
  await expect(
    page.locator(".monaco-editor .condition-inline.condition-false").first(),
  ).toBeVisible();
  await expect(
    page.getByLabel("Condition evaluated true").first(),
  ).toBeVisible();
  await expect(page.getByTestId("condition-equation")).toHaveText(
    "(1 == 2 - 1)→true",
  );
  await expect(page.getByLabel("Recorded operand values")).toContainText("j=1");
  await expect(page.getByLabel("Recorded operand values")).toContainText(
    "needleLength=2",
  );
  await expect(
    page
      .locator(".condition-row-values")
      .filter({ hasText: "(1 == 2 - 1)" })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "First observation", exact: true })
    .click();
  await expect(
    page.locator(".monaco-editor .condition-inline.condition-true"),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Next observation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Last observation", exact: true })
    .click();
  await expect(
    page.locator(".trace-table .selected-row .row-select"),
  ).toBeInViewport({ ratio: 1 });
  // Capture the complete workspace at a stable viewport; full-page capture can resize a virtual scroll container mid-capture.
  await page.setViewportSize({ width: 1440, height: 1650 });
  await page
    .getByRole("button", { name: "Last observation", exact: true })
    .click();
  await expect(
    page.locator(".trace-table .selected-row .row-select"),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: ".data/screenshots/desktop.png",
    fullPage: false,
  });
  await page.screenshot({
    path: ".data/screenshots/conditions-desktop.png",
    fullPage: false,
  });
  await page.reload();
  await expect(page.getByTestId("return-value")).toHaveText("2", {
    timeout: 30000,
  });
  await expect(
    page.getByRole("textbox", { name: "haystack", exact: true }),
  ).toHaveValue("hello", { timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "Detect inputs", exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Variable history" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".data/screenshots/mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Inputs", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "haystack", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".data/screenshots/mobile-inputs.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Output", exact: true }).click();
  await expect(page.getByTestId("return-value")).toHaveText("2");
  await page.screenshot({
    path: ".data/screenshots/mobile-output.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "21", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Variable history" }),
  ).toBeVisible();
  await expect(
    page.locator(".trace-table .selected-row .row-select"),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: ".data/screenshots/mobile-return-line.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("execution sidebars restore saved inputs and recordings on desktop and mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1650 });
  await page.goto("/");
  const history = page.getByRole("complementary", {
    name: "Execution history",
  });
  await expect(history.getByText("No executions yet.")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "haystack", exact: true }),
  ).toHaveValue("hello", { timeout: 30000 });
  await page.getByRole("button", { name: "Run & visualize" }).click();
  await expect(page.getByTestId("return-value")).toHaveText("2", {
    timeout: 30000,
  });
  const firstId = await history
    .getByTestId("execution-item")
    .first()
    .getAttribute("data-run-id");
  await history
    .getByRole("button", { name: "New execution", exact: true })
    .click();
  await expect(page.getByTestId("return-value")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "haystack", exact: true })
    .fill("world");
  await page.getByRole("textbox", { name: "needle", exact: true }).fill("zz");
  await page.getByRole("button", { name: "Run & visualize" }).click();
  await expect(page.getByTestId("return-value")).toHaveText("-1", {
    timeout: 30000,
  });
  await expect(history.getByTestId("execution-item")).toHaveCount(2);
  const secondId = await history
    .getByTestId("execution-item")
    .first()
    .getAttribute("data-run-id");
  await history.locator(`[data-run-id="${firstId}"]`).click();
  await expect(page.getByTestId("return-value")).toHaveText("2");
  await expect(
    page.getByRole("textbox", { name: "haystack", exact: true }),
  ).toHaveValue("hello");
  await expect(
    page.getByRole("textbox", { name: "needle", exact: true }),
  ).toHaveValue("ll");
  await expect(history.locator(`[data-run-id="${firstId}"]`)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page
    .getByRole("button", { name: "Last observation", exact: true })
    .click();
  await expect(page.getByTestId("condition-equation")).toHaveText(
    "(1 == 2 - 1)→true",
  );
  await page.screenshot({
    path: ".data/screenshots/sidebars-desktop.png",
    fullPage: false,
  });
  await page.reload();
  await expect(page.getByTestId("return-value")).toHaveText("2", {
    timeout: 30000,
  });
  await expect(history.getByTestId("execution-item")).toHaveCount(2);
  await expect(
    page.getByRole("textbox", { name: "haystack", exact: true }),
  ).toHaveValue("hello");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(history).not.toBeVisible();
  await page
    .getByRole("button", { name: "Open execution history", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: "Execution history" });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("button", {
      name: "Close execution history",
      exact: true,
    }),
  ).toBeFocused();
  await page.screenshot({
    path: ".data/screenshots/sidebars-mobile.png",
    fullPage: false,
  });
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByTestId("execution-item").last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    drawer.getByRole("button", { name: "Refresh executions", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open execution history", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Open execution history", exact: true })
    .click();
  await drawer.locator(`[data-run-id="${secondId}"]`).click();
  await expect(drawer).not.toBeVisible();
  await page.getByRole("button", { name: "Inputs", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "haystack", exact: true }),
  ).toHaveValue("world");
  await expect(
    page.getByRole("textbox", { name: "needle", exact: true }),
  ).toHaveValue("zz");
  await page.getByRole("button", { name: "Output", exact: true }).click();
  await expect(page.getByTestId("return-value")).toHaveText("-1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
