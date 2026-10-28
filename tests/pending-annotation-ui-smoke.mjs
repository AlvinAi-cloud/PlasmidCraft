import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium } from "./ui-browser.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
import { COMMON_FEATURE_LIBRARY } from "../viewer/common-features.mjs";
const browser = await chromium.launch({ headless: true });
const page = await fixturePage(browser, {
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let checks = 0;
const amp = COMMON_FEATURE_LIBRARY.features.find((f) => /AmpR/.test(f.name));
const ampVariant =
  amp.sequence.slice(0, 44) +
  (amp.sequence[44] === "C" ? "T" : "C") +
  amp.sequence.slice(45);
const origin =
  "ACGTTGCAAGTCGATCGATGCTAGCTAGCATCGATCGTACGTAGCTGATGCTAGCTAGCTACGATCGATGCTAGCATCGATGCTACGTACGATCGATGC";
const variant =
  origin.slice(0, 40) + (origin[40] === "A" ? "C" : "A") + origin.slice(41);
await page.addInitScript(
  (features) =>
    localStorage.setItem(
      "plasmidcraft.feature-libraries.v1",
      JSON.stringify({
        version: 1,
        libraries: [{ id: "review-lib", name: "Review candidates", features }],
      }),
    ),
  [
    {
      id: "origin",
      name: "Test origin",
      type: "rep_origin",
      sequence: origin,
      directional: true,
    },
    { ...amp, id: "amp" },
    {
      id: "promoter",
      name: "Test promoter",
      type: "promoter",
      sequence: variant.slice(10, 40),
      directional: true,
    },
  ],
);
const source = {
  name: "Pending annotation source",
  sequence: variant + "CCCC" + ampVariant + "GGGG",
  topology: "linear",
  features: [],
  primers: [],
};
async function load(record) {
  await page
    .locator("#file-input")
    .setInputFiles({
      name: `${record.name}.pcraft`,
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(record)),
    });
  await page.waitForFunction(
    (name) => document.querySelector("#document-name").textContent === name,
    record.name,
  );
}
async function command(action) {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.locator(`#app-tools-menu [data-command="${action}"]`).click();
}
const tab = (view) => page.locator(`#view-tabs [data-view="${view}"]`).click();
const pending = () =>
  page.locator('#main-panel [data-annotation-preview="true"]');
async function saved() {
  const promise = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  const download = await promise;
  return parseProject(await fs.readFile(await download.path(), "utf8"));
}
async function annotationSearch() {
  await command("auto-annotation");
  await page.locator("#auto-annotation-library").selectOption("review-lib");
  await page.locator('[data-command="auto-annotation-preview"]').click();
  await page.locator("#library-variant-matches tbody tr").first().waitFor();
}
async function screenshot(name) {
  if (!process.env.PLASMIDCRAFT_SCREENSHOTS) return;
  await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: `${process.env.PLASMIDCRAFT_SCREENSHOTS}/${name}.png`,
  });
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  await load(source);
  await annotationSearch();
  await page.locator('[data-wf-action="library-select-close"]').click();
  assert.equal(
    await page.locator("#library-variant-matches input:checked").count(),
    2,
  );
  assert.equal(await page.locator("#feature-count").textContent(), "0");
  assert.equal(await page.locator("#dirty-indicator").isHidden(), true);
  assert.equal(await page.locator("#undo-button").isDisabled(), true);
  checks++;
  await tab("map");
  const panel = page.locator("#annotation-review-dialog");
  assert.equal(await panel.isVisible(), true);
  assert.match(
    await page.locator("#annotation-review-confirm").textContent(),
    /\(3\)/,
  );
  assert.ok((await pending().count()) > 0);
  assert.match(
    await page.locator("#plasmid-map").textContent(),
    /TEM-1 beta-lactamase/,
  );
  assert.equal(await page.locator("#feature-count").textContent(), "0");
  checks++;
  const ampRow = panel
    .locator("tr")
    .filter({ hasText: "TEM-1 beta-lactamase / AmpR" });
  await ampRow.locator('input[type="checkbox"]').uncheck();
  assert.doesNotMatch(
    await page.locator("#plasmid-map").textContent(),
    /TEM-1 beta-lactamase/,
  );
  await ampRow.locator('input[type="checkbox"]').check();
  await command("feature-libraries");
  await panel.waitFor({ state: "hidden" });
  assert.equal(
    await page.locator("#library-variant-matches input:checked").count(),
    2,
  );
  await tab("map");
  assert.equal(await panel.isVisible(), true);
  await tab("sequence");
  assert.equal(await panel.isVisible(), true);
  assert.ok(
    (await page
      .locator('.sequence-annotation[data-annotation-preview="true"]')
      .count()) > 0,
  );
  assert.equal(await page.locator("#feature-count").textContent(), "0");
  const beforeConfirm = await saved();
  assert.equal(beforeConfirm.features.length, 0);
  assert.equal(beforeConfirm.primers.length, 0);
  assert.equal(beforeConfirm.sequence, source.sequence);
  await screenshot("floating-annotations-sequence");
  checks++;
  await page.locator("#annotation-review-confirm").click();
  await panel.waitFor({ state: "hidden" });
  assert.equal(await page.locator("#feature-count").textContent(), "3");
  assert.equal(await pending().count(), 0);
  const confirmed = await saved();
  assert.equal(confirmed.features.length, 3);
  assert.ok(confirmed.features.every((f) => !f.id.startsWith("pending-")));
  await page.locator("#undo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "0");
  assert.equal(await pending().count(), 0);
  checks++;
  await load({ ...source, name: "Discard annotation source" });
  await annotationSearch();
  await page.locator('[data-wf-action="library-select-close"]').click();
  await tab("map");
  assert.ok((await pending().count()) > 0);
  await panel.locator('[data-annotation-review="discard"]').last().click();
  await panel.waitFor({ state: "hidden" });
  assert.equal(await pending().count(), 0);
  assert.equal(await page.locator("#feature-count").textContent(), "0");
  assert.equal((await saved()).features.length, 0);
  await annotationSearch();
  await page.locator('[data-wf-action="library-select-close"]').click();
  await tab("map");
  await load({ ...source, name: "Different review document" });
  assert.equal(
    await page.locator("#annotation-review-confirm").isDisabled(),
    true,
  );
  assert.match(await panel.textContent(), /source document changed/);
  assert.equal(await pending().count(), 0);
  await page
    .locator("#document-tabs .file-tab")
    .filter({ hasText: "Discard annotation source.pcraft" })
    .click();
  assert.equal(
    await page.locator("#annotation-review-confirm").isDisabled(),
    false,
  );
  assert.ok((await pending().count()) > 0);
  await panel.locator('[data-annotation-review="discard"]').last().click();
  checks++;
  const orfSource = {
    name: "Temporary ORFs",
    sequence:
      "CCCATG" + "GCT".repeat(79) + "TAACCCATG" + "GGT".repeat(89) + "TAACCC",
    topology: "linear",
    features: [],
    primers: [],
  };
  await load(orfSource);
  await command("find-orfs");
  assert.equal(await page.locator("#orf-min-aa").inputValue(), "80");
  await page.locator("#orf-strands").selectOption("forward");
  await page.locator('#orf-form button[type="submit"]').click();
  await page.locator('[data-orf-action="review"]').click();
  const orfs = page.locator("#orf-review-dialog");
  assert.ok((await orfs.boundingBox()).width <= 660);
  assert.equal(
    await orfs
      .getByRole("columnheader", { name: "Inspect", exact: true })
      .count(),
    0,
  );
  await orfs.locator('[data-orf-review="select"]').click();
  await tab("map");
  assert.ok((await pending().count()) > 0);
  assert.equal(await page.locator("#feature-count").textContent(), "0");
  await orfs.locator("[data-orf-name]").first().fill("Renamed ORF");
  assert.match(await page.locator("#plasmid-map").textContent(), /Renamed ORF/);
  await screenshot("narrow-orf-preview-map");
  await orfs.locator("[data-orf-select]").first().uncheck();
  assert.doesNotMatch(
    await page.locator("#plasmid-map").textContent(),
    /Renamed ORF/,
  );
  await orfs.locator("[data-orf-select]").first().check();
  await tab("sequence");
  assert.ok(
    (await page
      .locator('.sequence-annotation[data-annotation-preview="true"]')
      .count()) > 0,
  );
  assert.equal((await saved()).features.length, 0);
  checks++;
  await page.setViewportSize({ width: 780, height: 650 });
  await page.waitForFunction(() => {
    const dialog = document.querySelector("#orf-review-dialog").getBoundingClientRect();
    const confirm = document.querySelector("#orf-review-apply").getBoundingClientRect();
    return dialog.width <= innerWidth && dialog.top >= 0 && dialog.bottom <= innerHeight && confirm.bottom <= innerHeight;
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Moving a floating panel after resizing keeps the toolbar accessible.
  await orfs.locator(".modal-header").focus();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.locator("#orf-review-apply").click();
  assert.equal(await page.locator("#feature-count").textContent(), "2");
  assert.equal(await pending().count(), 0);
  await page.locator("#undo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "0");
  assert.equal(await pending().count(), 0);
  await orfs.locator('[data-orf-review="select"]').click();
  assert.ok((await pending().count()) > 0);
  await orfs.locator('[data-orf-review="close"]').last().click();
  await orfs.waitFor({ state: "hidden" });
  await page.waitForFunction(
    () =>
      !document.querySelector('#main-panel [data-annotation-preview="true"]'),
  );
  assert.equal((await saved()).features.length, 0);
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} pending-annotation UI checks passed: close-match select-all, persistent floating selections, live Map/Sequence previews, save isolation, confirmation/undo, discarding previews, 80-aa defaults and narrow ORF review.`,
  );
} finally {
  await browser.close();
}
