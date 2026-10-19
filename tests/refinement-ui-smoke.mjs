import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium } from "./ui-browser.mjs";
import { serializeProject } from "../viewer/project.mjs";
import { serializeLibrary } from "../viewer/library.mjs";
import { reverseComplement } from "../viewer/core.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await fixturePage(browser, {
  viewport: { width: 1440, height: 1050 },
  acceptDownloads: true,
});
await page.addInitScript(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (value) => {
        window.__copied = value;
      },
    },
  });
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0;
const bases = Array(300).fill("C");
const put = (at, dna) => bases.splice(at, dna.length, ...dna);
put(0, "ATGAAAACCGGTTAA");
put(21, "ATGGCTGCTGCTTAA");
put(60, reverseComplement("ATGAAACCCTTCTAA"));
put(120, "ATGA");
put(140, "AATAA");
put(200, "ACCGTATTAAGC");
const feature = (id, segments, strand = 1) => ({
  id,
  name: id,
  type: "CDS",
  strand,
  segments,
  color: "#79a995",
  qualifiers: {},
});
const rec = {
  name: "Sequence and library refinement",
  sequence: bases.join(""),
  topology: "linear",
  features: [
    feature("A", [{ start: 0, end: 15 }]),
    feature("B", [{ start: 21, end: 36 }]),
    feature("Overlap", [{ start: 0, end: 15 }]),
    feature("Reverse", [{ start: 60, end: 75 }], -1),
    feature("Joined", [
      { start: 120, end: 124 },
      { start: 140, end: 145 },
    ]),
  ],
  primers: [],
};
const residue = (key, n) =>
  page.locator(`[data-protein-track="${key}"][data-residue="${n}"]`);
async function menu(name, command) {
  await page.getByRole("button", { name, exact: true }).click();
  await page
    .locator(`.app-menu-popup:not([hidden]) [data-command="${command}"]`)
    .click();
}
async function chooser() {
  await menu("Edit", "copy-sequence");
  await page.locator("#copy-format").waitFor();
}
async function copyChoice(value) {
  await chooser();
  if (value !== undefined)
    await page.locator("#copy-format").selectOption(value);
  await page.locator('[data-action="copy-selected-choice"]').click();
  return page.evaluate(() => window.__copied);
}
async function screenshot(name) {
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/" + name + ".png",
    });
  }
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#file-input").setInputFiles({
    name: "refinement.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(rec)),
  });
  await page.locator('#view-tabs [data-view="sequence"]').click();
  const a = await page
      .getByLabel("Inline CDS A", { exact: true })
      .boundingBox(),
    b = await page.getByLabel("Inline CDS B", { exact: true }).boundingBox(),
    overlap = await page
      .getByLabel("Inline CDS Overlap", { exact: true })
      .boundingBox();
  assert.equal(a.y, b.y);
  assert.ok(overlap.y >= a.y + 40);
  assert.equal(
    await page
      .locator('[data-sequence-row="0"] .sequence-protein-lane')
      .count(),
    2,
  );
  checks++;
  await residue("A", 2).click();
  await residue("A", 4).click({ modifiers: ["Shift"] });
  assert.equal(
    await page.locator(".reference-track .base.selected").count(),
    9,
  );
  assert.equal(
    await page.locator(".complement-track .base.selected").count(),
    9,
  );
  assert.equal(
    await page.locator('[data-protein-track="A"].linked-selected').count(),
    3,
  );
  assert.equal(await copyChoice(), "KTG");
  checks++;
  await page.locator("#protein-letter-format").selectOption("three");
  await residue("Reverse", 1).click();
  await residue("Reverse", 2).click({ modifiers: ["Shift"] });
  assert.equal(await copyChoice("bottom"), "ATGAAA");
  assert.equal(await copyChoice("top"), "TTTCAT");
  checks++;
  await residue("Joined", 2).click();
  const positions = await page
    .locator(".reference-track .base.selected")
    .evaluateAll((ns) => ns.map((n) => Number(n.dataset.position)));
  assert.deepEqual(positions, [123, 140, 141]);
  assert.equal(await copyChoice(), "K");
  await screenshot("linked-protein-selection");
  checks++;
  await page.locator('[data-position="0"]').click();
  await page.locator('[data-position="8"]').click({ modifiers: ["Shift"] });
  assert.equal(
    await page.locator('[data-protein-track="A"].linked-selected').count(),
    3,
  );
  await chooser();
  assert.equal(await page.locator("#copy-format option").count(), 4);
  await page.locator("#copy-format").selectOption("0");
  const download = page.waitForEvent("download");
  await page.locator('[data-action="export-selected-choice"]').click();
  const exported = await fs.readFile(await (await download).path(), "utf8");
  assert.match(exported, /\nMKT\n/);
  checks++;
  await menu("Tools", "feature-libraries");
  for (const [id, name] of [
    ["a", "Shared motif A"],
    ["b", "Shared motif B"],
  ]) {
    const lib = {
      id,
      name: "Library " + id.toUpperCase(),
      features: [
        {
          id: "motif",
          name,
          sequence: "ACCGTATTAAGC",
          type: "misc_feature",
          directional: true,
          color: "#79a995",
        },
      ],
    };
    await page.locator("#library-file-input").setInputFiles({
      name: id + ".pclib",
      mimeType: "application/json",
      buffer: Buffer.from(serializeLibrary(lib)),
    });
    await page
      .locator("#library-select option")
      .filter({ hasText: "Library " + id.toUpperCase() })
      .waitFor({ state: "attached" });
  }
  await page
    .locator("#library-select")
    .selectOption({ label: "My feature library (0)" });
  await page.locator("#library-search-all").check();
  await page.locator("#library-filter").fill("Shared motif");
  await page.locator('[data-wf-action="library-match"]').click();
  await page.locator("#library-matches tbody tr").waitFor();
  assert.equal(await page.locator("#library-matches tbody tr").count(), 1);
  assert.match(
    await page.locator("#wf-result").textContent(),
    /1 duplicate identifications merged/,
  );
  assert.match(
    await page.locator("#library-matches").textContent(),
    /Library A.*Library B/s,
  );
  checks++;
  await page.locator('[data-wf-action="library-apply"]').click();
  await page.locator('[data-wf-action="library-match"]').click();
  await page.locator("#library-matches tbody tr").waitFor();
  assert.equal(await page.locator("[data-library-match]:disabled").count(), 1);
  await screenshot("all-library-matching");
  checks++;
  await page.locator("#ai-assistant-button").click();
  assert.equal(await page.locator("#ai-key").isVisible(), false);
  assert.equal(await page.locator(".ai-connected-composer").isVisible(), true);
  await menu("AI", "ai-settings");
  assert.equal(await page.locator("#ai-workspace #ai-provider").count(), 0);
  assert.equal(
    await page.locator('[data-ai="navigate-connection"]').count(),
    0,
  );
  assert.equal(await page.locator("#ai-key").isVisible(), true);
  assert.equal(await page.locator("#ai-settings-dialog").isVisible(), true);
  await screenshot("ai-accounts-page");
  checks++;
  await page.locator('[data-ai="settings-close"]').click();
  await page.locator('[data-ai="navigate-external"]').click();
  assert.equal(await page.locator("#ai-key").isVisible(), false);
  assert.equal(await page.locator('[data-ai="copy"]').isVisible(), true);
  assert.equal(await page.locator('[data-ai="send"]').isVisible(), false);
  await page.locator("#ai-goal").fill("Review these synthetic annotations");
  await page.locator('[data-ai="copy"]').click();
  assert.match(
    await page.evaluate(() => window.__copied),
    /Review these synthetic annotations/,
  );
  await screenshot("ai-external-page");
  checks++;
  assert.equal(await page.locator("#ai-response").isVisible(), true);
  assert.equal(await page.locator("#ai-design-section").isVisible(), true);
  await page.locator('[data-ai="navigate-design"]').click();
  assert.equal(
    await page.locator("#ai-goal").inputValue(),
    "Review these synthetic annotations",
  );
  await page.setViewportSize({ width: 760, height: 650 });
  assert.equal(
    await page.locator('[data-ai="navigate-design"]').isVisible(),
    true,
  );
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} refinement UI checks passed: packed CDS lanes, linked residue/DNA selection, copy/export choices, all-library deduplication and separate AI pages.`,
  );
} finally {
  await browser.close();
}
