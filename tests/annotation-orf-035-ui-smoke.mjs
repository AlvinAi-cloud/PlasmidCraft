import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { fixturePage, chromium } from "./ui-browser.mjs";
import { serializeProject } from "../viewer/project.mjs";
import { COMMON_FEATURE_LIBRARY } from "../viewer/common-features.mjs";
import { findOrfs, orfFeature } from "../viewer/protein.mjs";
const browser = await chromium.launch({ headless: true });
const page = await fixturePage(browser, {
  viewport: { width: 1440, height: 1000 },
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let checks = 0;
async function screenshot(name) {
  if (!process.env.PLASMIDCRAFT_SCREENSHOTS) return;
  await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: `${process.env.PLASMIDCRAFT_SCREENSHOTS}/${name}.png`,
  });
}
const amp = COMMON_FEATURE_LIBRARY.features.find((f) => /AmpR/.test(f.name));
// One synonymous third-position change; never import a user's private sequence.
const ampVariant =
  amp.sequence.slice(0, 44) +
  (amp.sequence[44] === "C" ? "T" : "C") +
  amp.sequence.slice(45);
const origin =
  "ACGTTGCAAGTCGATCGATGCTAGCTAGCATCGATCGTACGTAGCTGATGCTAGCTAGCTACGATCGATGCTAGCATCGATGCTACGTACGATCGATGC";
const originVariant =
  origin.slice(0, 40) + (origin[40] === "A" ? "C" : "A") + origin.slice(41);
const entry = (id, name, sequence, type = "promoter") => ({
  id,
  name,
  sequence,
  type,
  directional: true,
});
await page.addInitScript(
  (features) => {
    localStorage.setItem(
      "plasmidcraft.feature-libraries.v1",
      JSON.stringify({
        version: 1,
        libraries: [
          { id: "local-boundary", name: "Boundary variants", features },
        ],
      }),
    );
  },
  [
    entry("p1", "Amp promoter", originVariant.slice(10, 40)),
    entry("p2", "AMP PROMOTER", originVariant.slice(9, 42)),
    entry("p3", "Amp promoter", originVariant.slice(11, 41)),
    entry("ori", "Test origin", origin, "rep_origin"),
  ],
);
const record = {
  name: "Annotation preview 035",
  sequence: originVariant + "CCCC" + ampVariant + "GGGG",
  topology: "linear",
  features: [],
  primers: [],
};
async function load(record) {
  await page.locator("#file-input").setInputFiles({
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
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  await load(record);
  await command("auto-annotation");
  await page.locator("#auto-annotation-library").selectOption("all");
  await page.locator('[data-command="auto-annotation-preview"]').click();
  await page.locator("#library-variant-matches tbody tr").first().waitFor();
  const ampRow = page
    .locator("#library-variant-matches tbody tr")
    .filter({ hasText: "TEM-1 beta-lactamase / AmpR" });
  assert.equal(await ampRow.count(), 1);
  assert.match(await ampRow.textContent(), /99\.88% DNA identity/);
  assert.equal(
    await ampRow.locator('input[type="checkbox"]').isChecked(),
    false,
  );
  assert.equal(
    await page
      .locator("#library-variant-matches tbody tr")
      .filter({ hasText: "Test origin" })
      .count(),
    1,
  );
  const promoters = page
    .locator("#library-matches tbody tr")
    .filter({ hasText: /amp promoter/i });
  assert.equal(await promoters.count(), 1);
  assert.match(await promoters.textContent(), /10–42/);
  checks++;
  await page.locator("#library-close-results").scrollIntoViewIfNeeded();
  await screenshot("close-annotation-matches");
  await ampRow.locator('input[type="checkbox"]').check();
  await page
    .locator("#library-variant-matches tbody tr")
    .filter({ hasText: "Test origin" })
    .locator('input[type="checkbox"]')
    .check();
  await page.locator('[data-wf-action="library-apply"]').click();
  assert.ok(Number(await page.locator("#feature-count").textContent()) >= 3);
  await page.locator("#undo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "0");
  checks++;
  await page.locator("#library-close-matches").uncheck();
  await page.locator('[data-wf-action="library-match"]').click();
  await page.waitForFunction(
    () =>
      !document.querySelector("#wf-progress") ||
      document.querySelector("#wf-progress").hidden,
  );
  assert.equal(
    await page.locator("#library-variant-matches tbody tr").count(),
    0,
  );
  checks++;
  const orfSource = {
    name: "ORF review 035",
    sequence: "CCCATGATGAAATAACCCATGCCCAAACCTTAACCC",
    topology: "linear",
    features: [],
    primers: [],
  };
  const candidates = findOrfs(orfSource, {
    minAa: 1,
    nested: true,
    strands: "forward",
  }).orfs;
  orfSource.features.push(
    orfFeature(
      candidates.find((o) => o.segments[0].start === 3),
      { id: "known", name: "Known CDS" },
    ),
  );
  await load(orfSource);
  await command("find-orfs");
  assert.equal(await page.locator("#orf-min-aa").inputValue(), "80");
  await page.locator("#orf-min-aa").fill("1");
  await page.locator("#orf-strands").selectOption("forward");
  await page.locator("#orf-nested").check();
  await page.locator('#orf-form button[type="submit"]').click();
  await page.locator('[data-orf-action="review"]').click();
  const dialog = page.locator("#orf-review-dialog");
  assert.equal(await dialog.getAttribute("aria-modal"), "false");
  assert.equal(await dialog.locator("tbody tr").count(), 1);
  await page.locator("#orf-review-only-new").uncheck();
  assert.equal(await dialog.locator("tbody tr").count(), 3);
  assert.equal(await dialog.locator("[data-orf-select]:disabled").count(), 2);
  await page.locator("#orf-review-only-new").check();
  checks++;
  assert.ok((await dialog.boundingBox()).width <= 660);
  assert.equal(
    await dialog
      .getByRole("columnheader", { name: "Inspect", exact: true })
      .count(),
    0,
  );
  await page.locator('#view-tabs [data-view="map"]').click();
  assert.equal(await page.locator("#plasmid-map").isVisible(), true);
  assert.equal(await dialog.isVisible(), true);
  await screenshot("orf-review-map");
  await page.locator('#view-tabs [data-view="sequence"]').click();
  assert.equal(await page.locator("#sequence-editor").isVisible(), true);
  assert.equal(await dialog.isVisible(), true);
  const before = await dialog.boundingBox();
  await dialog.locator(".modal-header").focus();
  await page.keyboard.press("ArrowRight");
  const after = await dialog.boundingBox();
  assert.ok(
    after.x > before.x,
    JSON.stringify({
      before,
      after,
      dom: await dialog.evaluate((d) => ({
        header: d.querySelector(".modal-header").outerHTML,
        focus: document.activeElement.outerHTML,
        left: d.style.left,
      })),
      errors,
    }),
  );
  checks++;
  await dialog.locator("[data-orf-name]").fill("");
  await dialog.locator("[data-orf-select]").check();
  await page.locator("#orf-review-apply").click();
  assert.match(
    await page.locator("#orf-review-error").textContent(),
    /Give every selected ORF a name/,
  );
  assert.equal(await page.locator("#feature-count").textContent(), "1");
  await dialog.locator("[data-orf-name]").fill("Reviewed ORF");
  await page.locator("#orf-review-apply").click();
  assert.equal(await page.locator("#feature-count").textContent(), "2");
  assert.equal(await dialog.locator("tbody tr").count(), 0);
  await page.locator("#undo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "1");
  assert.equal(await dialog.locator("tbody tr").count(), 1);
  await page.locator("#redo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "2");
  checks++;
  await load({ ...orfSource, name: "Other source", features: [] });
  assert.match(await dialog.textContent(), /source document changed/);
  assert.equal(await page.locator("#orf-review-apply").isDisabled(), true);
  assert.equal(await page.locator("#feature-count").textContent(), "0");
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} v0.35 UI checks passed: longest-span deduplication, separate close origin/AmpR matches, exact-only option, movable ORF review, live Map/Sequence inspection, batch validation/undo and source guards.`,
  );
} finally {
  await browser.close();
}
