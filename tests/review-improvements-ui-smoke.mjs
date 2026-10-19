import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium, testOutput } from "./ui-browser.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
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
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0,
  seed = 5129;
const dna = (length) =>
  Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return "ACGT"[seed >>> 30];
  }).join("");
async function save() {
  const pending = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  return parseProject(await fs.readFile(await (await pending).path(), "utf8"));
}
async function load(record) {
  await page.locator("#file-input").setInputFiles({
    name: record.name + ".pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(record)),
  });
  await page.waitForFunction(
    (name) => document.querySelector("#document-name").textContent === name,
    record.name,
  );
}
async function click(action) {
  await page.locator(`[data-wf-action="whole-${action}"]`).click();
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  const sequence = dna(1200);
  const reference = {
    name: "Review reference",
    sequence,
    topology: "circular",
    features: [
      {
        id: "marker",
        name: "Downstream marker",
        type: "misc_feature",
        strand: 1,
        segments: [{ start: 800, end: 950 }],
        qualifiers: {},
        color: "#548dbb",
      },
    ],
    primers: [],
    comments: [],
    warnings: [],
    description:
      "Expression vector.\nPlasmidCraft: DNA edit at 5494 (removed 51 bp; inserted 30 bp). Created from a reviewed AI proposal. Connected AI operation Replace 5494–5544: 51 bp → 30 bp Exported by PlasmidCraft independent basic DNA exporter.",
  };
  await load(reference);
  assert.equal(
    await page.locator("#inspector > .inspector-note").first().textContent(),
    "Expression vector.",
  );
  await page.locator(".inspector-provenance summary").click();
  assert.match(
    await page.locator(".inspector-provenance").textContent(),
    /5494–5544/,
  );
  assert.equal((await save()).description, reference.description);
  checks++;
  const referenceId = await page
    .locator("#document-tabs .active")
    .getAttribute("data-document");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .locator('#app-tools-menu [data-command="compare-plasmids"]')
    .click();
  assert.equal(
    await page.locator("#whole-reference").inputValue(),
    referenceId,
  );
  assert.equal(
    await page.locator("#whole-advanced").getAttribute("open"),
    null,
  );
  const mutated =
    sequence.slice(0, 400) +
    "GGTACCGATGCA" +
    sequence.slice(407, 600) +
    (sequence[600] === "A" ? "C" : "A") +
    sequence.slice(601);
  const rc = reverseComplement(mutated),
    query = rc.slice(317) + rc.slice(0, 317);
  await page.locator("#whole-query-files").setInputFiles({
    name: "Observed plasmid.fasta",
    mimeType: "text/plain",
    buffer: Buffer.from(">Observed plasmid\n" + query),
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#whole-result")
      ?.textContent.includes("substitutions"),
  );
  let saved = await save();
  assert.equal(saved.name, reference.name);
  assert.equal(saved.sequence, reference.sequence);
  assert.equal(saved.comparisons[0].result.strand, -1);
  assert.ok(saved.comparisons[0].result.inserted > 0);
  assert.ok((await page.locator(".whole-overview button").count()) <= 160);
  checks++;
  await click("difference-next");
  assert.ok((await page.locator(".whole-current-difference").count()) > 0);
  await page.locator("#whole-position").fill("900");
  await click("position");
  assert.match(
    await page.locator(".alignment-display").textContent(),
    /reference/,
  );
  await click("reference");
  assert.match(
    await page
      .locator('#view-tabs [data-view="sequence"]')
      .getAttribute("class"),
    /active/,
  );
  assert.ok((await page.locator("[data-position].selected").count()) > 0);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .locator('#app-tools-menu [data-command="compare-plasmids"]')
    .click();
  checks++;
  await page.screenshot({ path: testOutput("whole-alignment-improved.png") });
  await click("annotated");
  const derived = await save();
  assert.equal(derived.sequence, mutated);
  assert.equal(derived.features[0].name, "Downstream marker");
  assert.deepEqual(derived.features[0].segments, [{ start: 805, end: 955 }]);
  assert.notEqual(derived.name, reference.name);
  const markers = derived.features.filter(
    (f) => f.qualifiers.alignment_operation,
  );
  assert.ok(markers.some((f) => f.qualifiers.alignment_operation[0] === "I"));
  assert.ok(markers.some((f) => f.qualifiers.alignment_operation[0] === "X"));
  assert.match(
    await page.locator('#view-tabs [data-view="map"]').getAttribute("class"),
    /active/,
  );
  assert.match(
    await page.locator("#inspector .inspector-name").textContent(),
    /Substitution|Insertion/,
  );
  assert.ok((await page.locator(".annotation-row").count()) > 1);
  assert.match(await page.locator(".map-legend").textContent(), /Substitution/);
  assert.match(await page.locator(".map-legend").textContent(), /Insertion/);
  await page.screenshot({ path: testOutput("query-copy-change-markers.png") });
  await page.locator('#view-tabs [data-view="sequence"]').click();
  assert.ok(
    (await page
      .locator(".sequence-annotation")
      .filter({ hasText: /Substitution|Insertion/ })
      .count()) > 0,
  );

  checks++;
  await page.locator(`#document-tabs [data-document="${referenceId}"]`).click();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .locator('#app-tools-menu [data-command="compare-plasmids"]')
    .click();
  await page.locator(".whole-paste > summary").click();
  await page.locator("#whole-paste-name").fill("Pasted exact");
  await page.locator("#whole-paste").fill(sequence);
  await click("paste");
  await page.waitForFunction(() =>
    document
      .querySelector("#whole-result")
      ?.textContent.includes("complete molecules match"),
  );
  assert.equal((await save()).comparisons[0].result.identity, 100);
  checks++;
  await page.setViewportSize({ width: 800, height: 900 });
  assert.ok(await page.locator("#whole-result").isVisible());
  assert.deepEqual(errors, []);
  console.log(
    `${checks} review improvement UI checks passed: readable legacy notes, imported/pasted queries, reversed circular alignment, overview/difference navigation, linked Sequence inspection and remapped annotated copies.`,
  );
} finally {
  await browser.close();
}
