import assert from "node:assert/strict";
import { chromium, fixturePage, testOutput } from "./ui-browser.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await fixturePage(browser, {
  viewport: { width: 1440, height: 1000 },
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0;
const expected = {
  analyze: [
    "auto-annotation",
    "view-enzymes",
    "simulate-pcr",
    "align-reads",
    "compare-plasmids",
    "read-consensus",
    "protein-analysis",
    "coding-proteins",
    "find-orfs",
    "view-translation",
    "blast",
  ],
  design: [
    "design-primers",
    "create-selection-primer",
    "design-mutagenesis",
    "assembly-workbench",
    "design-gibson",
    "design-golden",
    "optimize-codons",
    "protein-documents",
  ],
};
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  for (const [kind, commands] of Object.entries(expected)) {
    for (const selector of [`#${kind}-menu`])
      assert.deepEqual(
        await page
          .locator(`${selector} [data-command]`)
          .evaluateAll((nodes) => nodes.map((n) => n.dataset.command)),
        commands,
      );
  }
  assert.equal(await page.locator("#app-tools-menu").count(), 1);
  assert.equal(
    await page
      .locator('#app-tools-menu [data-command="feature-libraries"]')
      .count(),
    1,
  );
  checks++;
  await page.locator("#export-button").click();
  assert.equal(await page.locator("#export-menu").isVisible(), true);
  await page.locator("#analyze-button").click();
  assert.equal(await page.locator("#export-menu").isVisible(), false);
  assert.equal(
    await page.locator("#analyze-button").getAttribute("aria-expanded"),
    "true",
  );
  await page.screenshot({ path: testOutput("analyze-menu.png") });
  await page.locator('#analyze-menu [data-command="auto-annotation"]').click();
  await page.locator("#auto-annotation-library").waitFor();
  assert.equal(
    await page.locator('#auto-annotation-library option[value="all"]').count(),
    1,
  );
  assert.equal(
    await page.locator("#analyze-button").getAttribute("aria-expanded"),
    "false",
  );
  await page.locator('#modal [data-action="close-modal"]').first().click();
  checks++;
  await page.locator("#design-button").click();
  assert.equal(await page.locator("#analyze-menu").isVisible(), false);
  await page.screenshot({ path: testOutput("design-menu.png") });
  await page.locator('#design-menu [data-command="design-golden"]').click();
  await page
    .getByRole("heading", { name: "Golden Gate cloning design", exact: true })
    .waitFor();
  assert.equal(await page.locator("#clone-enzyme").count(), 1);
  checks++;
  await page
    .locator('.application-menus [aria-controls="app-tools-menu"]')
    .click();
  await page
    .locator('#app-tools-menu [data-command="feature-libraries"]')
    .click();
  await page.locator("#library-entries").waitFor();
  checks++;
  await page.locator("#analyze-button").focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page
      .locator('#analyze-menu [data-command="auto-annotation"]')
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.locator("#design-button").getAttribute("aria-expanded"),
    "true",
  );
  assert.equal(await page.locator("#analyze-menu").isVisible(), false);
  await page.keyboard.press("End");
  assert.equal(
    await page
      .locator('#design-menu [data-command="protein-documents"]')
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .locator("#design-button")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(
    await page.locator("#design-button").getAttribute("aria-expanded"),
    "false",
  );
  checks++;
  for (const size of [
    { width: 760, height: 600 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    for (const kind of ["analyze", "design"]) {
      await page.locator(`#${kind}-button`).click();
      const rect = await page.locator(`#${kind}-menu`).boundingBox();
      assert.ok(
        rect.x >= 0 &&
          rect.y >= 0 &&
          rect.x + rect.width <= size.width &&
          rect.y + rect.height <= size.height + 1,
        JSON.stringify(rect),
      );
      await page
        .locator(`#${kind}-menu button`)
        .last()
        .scrollIntoViewIfNeeded();
      const last = await page
        .locator(`#${kind}-menu button`)
        .last()
        .boundingBox();
      assert.ok(last.y + last.height <= size.height);
      await page.locator("#document-name").click();
      assert.equal(
        await page.locator(`#${kind}-button`).getAttribute("aria-expanded"),
        "false",
      );
    }
  }
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} Analyze/Design checks passed: focused toolbar menus with unchanged Tools menu, auto annotation, Golden Gate routing, library management, keyboard navigation and narrow viewport access.`,
  );
} finally {
  await browser.close();
}
