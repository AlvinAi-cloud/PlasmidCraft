import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium } from "./ui-browser.mjs";
import { parseProject } from "../viewer/project.mjs";
import { reverseComplement } from "../viewer/core.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await fixturePage(browser, {
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0;
async function save() {
  const pending = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  return parseProject(await fs.readFile(await (await pending).path(), "utf8"));
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator('#view-tabs [data-view="sequence"]').click();
  const start = page.locator('[data-position="100"]'),
    end = page.locator('[data-position="119"]');
  await start.click();
  await end.click({ modifiers: ["Shift"] });
  assert.equal(await page.locator("[data-position].selected").count(), 20);
  await start.click({ button: "right" });
  await page.locator("#context-selection-primer").click();
  await page
    .getByRole("heading", { name: "Create Primer from Selection", exact: true })
    .waitFor();
  const original = await page.locator("#selected-primer-sequence").inputValue();
  assert.equal(original.length, 20);
  checks++;
  const changed = (original[0] === "A" ? "C" : "A") + original.slice(1);
  await page.locator("#selected-primer-name").fill("Manual mismatch primer");
  await page.locator("#selected-primer-sequence").fill(changed);
  await page.locator("#selected-primer-tail").fill("GGATCC");
  assert.match(
    await page.locator("#selected-primer-preview").textContent(),
    /1 mismatch\(es\)/,
  );
  assert.equal(await page.locator(".primer-alignment-mismatch").count(), 2);
  checks++;
  await page.locator("#selected-primer-strand").selectOption("-1");
  assert.equal(
    await page.locator("#selected-primer-sequence").inputValue(),
    reverseComplement(changed),
  );
  assert.equal(
    await page.locator("#selected-primer-tail").inputValue(),
    "GGATCC",
  );
  checks++;
  await page.locator("#selected-primer-save").click();
  assert.equal(await page.locator("#modal").isVisible(), false);
  const result = await save(),
    primer = result.primers.find((p) => p.name === "Manual mismatch primer");
  assert.ok(primer);
  assert.equal(primer.sequence, "GGATCC" + reverseComplement(changed));
  assert.deepEqual(primer.sites, [
    { strand: -1, segments: [{ start: 100, end: 120 }] },
  ]);
  assert.equal(result.sequence.slice(100, 120), original);
  checks++;
  await page
    .locator('#inspector [data-command="edit-selected-primer"]')
    .click();
  await page.locator("#selected-primer-sequence").fill("A".repeat(201));
  assert.equal(await page.locator("#selected-primer-save").isDisabled(), true);
  assert.match(
    await page.locator("#selected-primer-error").textContent(),
    /200|bases/,
  );
  checks++;
  await page
    .locator("#selected-primer-sequence")
    .fill(reverseComplement(original));
  await page.locator("#selected-primer-save").click();
  const edited = await save();
  assert.equal(edited.primers.length, result.primers.length);
  assert.equal(
    edited.primers.find((p) => p.id === primer.id).annealingSequence,
    reverseComplement(original),
  );
  checks++;
  await page.locator("#undo-button").click();
  const undone = await save();
  assert.equal(
    undone.primers.find((p) => p.id === primer.id).annealingSequence,
    reverseComplement(changed),
  );
  await page.locator("#redo-button").click();
  const redone = await save();
  assert.equal(
    redone.primers.find((p) => p.id === primer.id).annealingSequence,
    reverseComplement(original),
  );
  checks++;
  await page
    .locator(`.sequence-primer-track[data-primer="${primer.id}"]`)
    .first()
    .click();
  await page
    .locator('#inspector [data-command="edit-selected-primer"]')
    .click();
  await page
    .locator("#selected-primer-sequence")
    .fill(reverseComplement(changed));
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path:
        process.env.PLASMIDCRAFT_SCREENSHOTS +
        "/selected-primer-mismatches.png",
    });
  }
  await page.setViewportSize({ width: 800, height: 650 });
  assert.equal(
    await page
      .locator("#modal")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} selected-primer UI checks passed: mouse selection, context menu, mismatches, reverse orientation, tails, save, edit, undo/redo and unchanged template.`,
  );
} finally {
  await browser.close();
}
