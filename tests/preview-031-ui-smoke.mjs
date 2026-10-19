import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium, testOutput } from "./ui-browser.mjs";
import { syntheticTestRecord } from "./fixtures/synthetic-plasmid.mjs";
import { serializeProject } from "../viewer/project.mjs";
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
const tab = (name) => page.locator(`#view-tabs [data-view="${name}"]`).click();
async function tools(command) {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.locator(`#app-tools-menu [data-command="${command}"]`).click();
}
async function moveDialog(left = 16, top = 120) {
  const h = await page.locator("#modal .modal-header").boundingBox();
  await page.mouse.move(h.x + 30, h.y + 20);
  await page.mouse.down();
  await page.mouse.move(left + 30, top + 20, { steps: 8 });
  await page.mouse.up();
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  assert.match(await page.locator("#version-label").textContent(), /0\.31\.0/);
  const sizes = await page.evaluate(() =>
    [
      document.body,
      document.querySelector(".ribbon-button"),
      document.querySelector(".inspector-note"),
    ]
      .filter(Boolean)
      .map((el) => parseFloat(getComputedStyle(el).fontSize)),
  );
  assert.ok(
    sizes.every((n) => n >= 12.5),
    String(sizes),
  );
  checks++;
  await page.screenshot({ path: testOutput("031-map.png") });
  const order = await page
    .locator("#app-tools-menu [data-command]")
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.command));
  assert.equal(
    order.indexOf("align-reads") + 1,
    order.indexOf("compare-plasmids"),
  );
  checks++;
  await tab("sequence");
  const rowBases = () =>
    page
      .locator("#sequence-editor")
      .getAttribute("data-bases-per-line")
      .then(Number);
  await page.setViewportSize({ width: 1920, height: 1050 });
  await page.waitForFunction(
    () => +document.querySelector("#sequence-editor").dataset.basesPerLine > 60,
  );
  const wide = await rowBases();
  await page.setViewportSize({ width: 1050, height: 900 });
  await page.waitForFunction(
    (wide) =>
      +document.querySelector("#sequence-editor").dataset.basesPerLine < wide,
    wide,
  );
  assert.ok((await rowBases()) < wide);
  assert.equal(
    await page
      .locator("#sequence-editor")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
    true,
  );
  assert.equal(await page.locator("[data-position]").count(), 4826);
  checks++;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#main-panel [data-action="annotate"]').click();
  await page.locator("#annotation-name").fill("Movable annotation draft");
  await moveDialog();
  const moved = await page.locator("#modal").boundingBox();
  assert.ok(
    Math.abs(moved.x - 16) < 3 && Math.abs(moved.y - 120) < 3,
    JSON.stringify(moved),
  );
  assert.equal(
    await page.locator("#modal").getAttribute("aria-modal"),
    "false",
  );
  await tab("map");
  await page.locator('#inspector [data-feature="feature-1"]').first().click();
  assert.equal(
    await page.locator("#annotation-name").inputValue(),
    "Movable annotation draft",
  );
  await tab("sequence");
  assert.equal(await page.locator("#modal").evaluate((el) => el.open), true);
  await page.screenshot({ path: testOutput("031-movable-annotation.png") });
  await page.locator('#modal [data-action="close-modal"]').first().click();
  checks++;
  await page.locator('.toolbar-button[data-command="edit-dna"]').click();
  await moveDialog();
  await page.locator("#dna-insert").fill("GGT");
  await tab("map");
  assert.equal(await page.locator("#dna-insert").inputValue(), "GGT");
  await page.locator("#modal .modal-header").focus();
  await page.keyboard.press("ArrowRight");
  assert.ok((await page.locator("#modal").boundingBox()).x >= 25);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#modal").evaluate((el) => el.open), false);
  checks++;
  await tools("design-mutagenesis");
  const source = syntheticTestRecord();
  const replacement = source.sequence[199] === "A" ? "T" : "A";
  await page.locator("#mutagenesis-edits").fill(`200: ${replacement}`);
  await page.locator('[data-mutagenesis="preview"]').click();
  await page.locator("#mutagenesis-pool").waitFor();
  assert.equal(await page.locator("#mutagenesis-error").textContent(), "");
  assert.match(
    await page.locator("#mutagenesis-result").textContent(),
    /unknown or mixed bases/,
  );
  await page.screenshot({ path: testOutput("031-primer-design.png") });
  checks++;
  await tab("sequence");
  await page.locator('#main-panel [data-action="annotate"]').click();
  await page.locator("#annotation-name").fill("Source-bound annotation");
  const other = {
    ...source,
    name: "Another plasmid",
    features: [],
    primers: [],
  };
  await page.locator("#file-input").setInputFiles({
    name: "other.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(other)),
  });
  await page.locator('#modal [data-action="save-annotation"]').click();
  assert.match(
    await page.locator("#modal-error").textContent(),
    /Return to the source document/,
  );
  await page.locator('#modal [data-action="close-modal"]').first().click();
  checks++;
  await tab("sequence");
  await page.screenshot({ path: testOutput("031-readable-sequence.png") });
  const long = {
    ...other,
    name: "Responsive long sequence",
    sequence: "ACGT".repeat(25000),
  };
  await page.locator("#file-input").setInputFiles({
    name: "long.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(long)),
  });
  await tab("sequence");
  await page.locator("#go-to").click();
  await page.locator("#range-start").fill("90001");
  await page.locator("#range-end").fill("90060");
  await page.locator('#modal [data-action="go-range"]').click();
  const before = await rowBases();
  await page.setViewportSize({ width: 1920, height: 1050 });
  await page.waitForFunction(
    (before) =>
      +document.querySelector("#sequence-editor").dataset.basesPerLine > before,
    before,
  );
  assert.equal(
    await page.locator("#sequence-editor").getAttribute("data-virtual"),
    "true",
  );
  await page.waitForFunction(() => {
    const base = document.querySelector('[data-position="90000"]'),
      editor = document.querySelector("#sequence-editor");
    if (!base) return false;
    const b = base.getBoundingClientRect(),
      r = editor.getBoundingClientRect();
    return b.top >= r.top && b.bottom <= r.bottom;
  });
  assert.equal(
    await page.locator(".reference-track .base.selected").count(),
    60,
  );
  assert.equal(
    await page
      .locator("#sequence-editor")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
    true,
  );
  checks++;
  await tab("map");
  await page.setViewportSize({ width: 1050, height: 900 });
  await tab("sequence");
  await page.waitForFunction(() => {
    const base = document.querySelector('[data-position="90000"]');
    if (!base) return false;
    const b = base.getBoundingClientRect(),
      r = document.querySelector("#sequence-editor").getBoundingClientRect();
    return b.top >= r.top && b.bottom <= r.bottom;
  });
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} 0.31 preview UI checks passed: typography, Tools order, adaptive rows, movable modeless dialogs, source guards and primer design on ambiguous templates.`,
  );
} finally {
  await browser.close();
}
