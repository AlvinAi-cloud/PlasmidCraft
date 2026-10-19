import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { serializeProject, parseProject } from "../viewer/project.mjs";
import { translateCds, translateDna } from "../viewer/protein.mjs";
import { CODON_USAGE } from "../viewer/codon-usage.mjs";
import { chromium, testOutput } from "./ui-browser.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0;
const source = {
  name: "Codon source",
  description: "Synthetic CDS",
  sequence: "CCCCATGCGTAGATCATAAGGGG",
  topology: "linear",
  features: [
    {
      id: "gene",
      name: "Arginine marker",
      type: "CDS",
      strand: 1,
      segments: [{ start: 4, end: 19 }],
      color: "#79a995",
      qualifiers: { transl_table: ["11"] },
    },
  ],
  primers: [],
  comments: [],
  warnings: [],
};
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  async function load(r) {
    await page.locator("#file-input").setInputFiles({
      name: r.name + ".pcraft",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(r)),
    });
    await page.waitForFunction(
      (name) => document.querySelector("#document-name").textContent === name,
      r.name,
    );
    return page.locator("#document-tabs .active").getAttribute("data-document");
  }
  async function command(c) {
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .locator(`.app-menu-popup:not([hidden]) [data-command="${c}"]`)
      .click();
  }
  async function action(c) {
    await page.locator(`[data-codon="${c}"]`).click();
  }
  async function preview() {
    await action("preview");
    await page.locator("#codon-output").waitFor();
    assert.equal((await page.locator("#codon-error").textContent()).trim(), "");
  }
  async function download(selector) {
    const p = page.waitForEvent("download");
    await page.locator(selector).click();
    return fs.readFile(await (await p).path(), "utf8");
  }
  async function save() {
    return parseProject(await download("#save-project-button"));
  }
  async function close() {
    await page.locator('#modal [data-action="close-modal"]').first().click();
  }
  const id = await load(source);
  await page
    .locator('#plasmid-map [data-feature="gene"] rect')
    .first()
    .click({ button: "right" });
  await page.locator("#context-optimize-codons").click();
  assert.match(
    await page.locator("#codon-source").textContent(),
    /Arginine marker/,
  );
  assert.equal(await page.locator("#codon-host option").count(), 8);
  checks++;
  await page.locator("#codon-host").selectOption("human");
  await preview();
  assert.equal(
    translateDna(await page.locator("#codon-output").inputValue()),
    "MRRS*",
  );
  const human = await page.locator("#codon-output").inputValue();
  checks++;
  await page.locator("#codon-dual").check();
  await page.locator("#codon-second").selectOption("yeast");
  await preview();
  assert.equal(await page.locator("#codon-scores tbody tr").count(), 2);
  assert.match(await page.locator("#codon-scores").textContent(), /50%/);
  checks++;
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.locator("#codon-scores").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/dual-host-result.png",
    });
  }
  await page.locator("#codon-weight").fill("75");
  assert.equal(await page.locator("#codon-output").count(), 0);
  await preview();
  const report = JSON.parse(await download('[data-codon="report"]'));
  assert.equal(report.hosts[0].weight, 0.75);
  assert.equal(
    translateCds(report.record, report.record.features[0]).protein,
    "MRRS",
  );
  assert.equal(report.record.sequence.slice(0, 4), "CCCC");
  checks++;
  await action("apply");
  let edited = await save();
  assert.notEqual(edited.sequence, source.sequence);
  assert.equal(translateCds(edited, edited.features[0]).protein, "MRRS");
  assert.equal(edited.name, source.name);
  await page.locator("#undo-button").click();
  assert.equal((await save()).sequence, source.sequence);
  checks++;
  await page.locator('[data-view="features"]').click();
  await page.locator('tr[data-feature="gene"]').click({ button: "right" });
  await page.locator("#context-optimize-codons").click();
  await preview();
  await action("create");
  const copy = await save();
  assert.notEqual(copy.name, source.name);
  assert.equal(translateCds(copy, copy.features[0]).protein, "MRRS");
  await page.locator(`#document-tabs [data-document="${id}"]`).click();
  assert.equal((await save()).sequence, source.sequence);
  checks++;
  await page.locator("#file-input").setInputFiles({
    name: "proteins.faa",
    mimeType: "text/plain",
    buffer: Buffer.from(
      ">Imported protein\nMARRS*\n>DNA alphabet protein\nACGT\n",
    ),
  });
  await page.locator("#protein-sequence").waitFor();
  assert.equal(await page.locator("#codon-protein option").count(), 2);
  assert.equal(await page.locator("#protein-sequence").inputValue(), "MARRS*");
  checks++;
  await page.locator("#codon-host").selectOption("human");
  await page.locator("#codon-second").selectOption("ecoli-w3110");
  await preview();
  assert.equal(
    translateDna(await page.locator("#codon-output").inputValue()),
    "MARRS*",
  );
  const savedProtein = await download('[data-codon="save-protein"]');
  assert.equal(JSON.parse(savedProtein).record.molecule, "protein");
  checks++;
  await page
    .locator("#codon-protein")
    .selectOption({ label: "DNA alphabet protein (4 residues)" });
  await page.locator("#codon-stop").uncheck();
  await preview();
  assert.equal(
    translateDna(await page.locator("#codon-output").inputValue()),
    "ACGT",
  );
  await action("create");
  const dna = await save();
  assert.equal(translateCds(dna, dna.features[0]).protein, "ACGT");
  assert.equal(dna.sequence.length, 12);
  checks++;
  await command("protein-documents");
  await page.locator("#protein-import-file").setInputFiles({
    name: "again.pcprotein",
    mimeType: "application/json",
    buffer: Buffer.from(savedProtein),
  });
  await page.waitForFunction(
    () => document.querySelectorAll("#codon-protein option").length === 3,
  );
  assert.equal(await page.locator("#protein-sequence").inputValue(), "MARRS*");
  checks++;
  await page.locator("#protein-import-file").setInputFiles({
    name: "ambiguous.faa",
    mimeType: "text/plain",
    buffer: Buffer.from(">Unknown protein\nMXU\n"),
  });
  await action("preview");
  await page.waitForFunction(() =>
    document
      .querySelector("#codon-error")
      .textContent.includes("defined amino"),
  );
  assert.equal(await page.locator("#codon-output").count(), 0);
  checks++;
  await page
    .locator("#codon-protein")
    .selectOption({ label: "Imported protein (5 residues)" });
  const csv =
    "Codon,Count\n" +
    Object.entries(CODON_USAGE[0].counts)
      .map(([c, n]) => c + "," + n)
      .join("\n");
  await page.locator("#codon-table-file").setInputFiles({
    name: "Measured custom table.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.waitForFunction(
    () => document.querySelectorAll("#codon-host option").length === 9,
  );
  await page.locator("#codon-dual").uncheck();
  await preview();
  assert.equal(
    translateDna(await page.locator("#codon-output").inputValue()),
    "MARRS*",
  );
  checks++;
  await page.setViewportSize({ width: 800, height: 800 });
  assert.ok(await page.locator('[data-codon="create"]').isVisible());
  const box = await page.locator("#modal").boundingBox();
  assert.ok(box.width <= 800);
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/codon-optimization.png",
    });
  }
  checks++;
  await close();
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "New from Pasted Protein…", exact: true })
    .click();
  await page.locator("#protein-paste-name").fill("Pasted protein");
  await page.locator("#protein-paste-sequence").fill("MPEPTIDE");
  await action("paste-create");
  assert.equal(
    await page.locator("#protein-sequence").inputValue(),
    "MPEPTIDE",
  );
  const fasta = await download('[data-codon="fasta"]');
  assert.match(fasta, />Pasted protein\nMPEPTIDE/);
  checks++;
  await preview();
  await page.locator("#codon-dual").check();
  await page
    .locator("#codon-second")
    .selectOption(await page.locator("#codon-host").inputValue());
  await action("preview");
  await page.waitForFunction(() =>
    document.querySelector("#codon-error").textContent.includes("different"),
  );
  assert.equal(await page.locator("#codon-output").count(), 0);
  checks++;
  await close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await command("protein-documents");
  await page.locator("#codon-dual").uncheck();
  // Change settings before the worker can return; its old preview must never be applied.
  await page.evaluate(() => {
    document.querySelector('[data-codon="preview"]').click();
    const host = document.querySelector("#codon-host");
    host.value = "yeast";
    host.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(await page.locator("#codon-output").count(), 0);
  await preview();
  assert.match(
    await page.locator("#codon-scores").textContent(),
    /Saccharomyces/,
  );
  checks++;
  await close();
  await page.locator(`#document-tabs [data-document="${id}"]`).click();
  await page.locator('.annotation-row[data-feature="gene"]').click();
  await page.locator('[data-view="sequence"]').click();
  await page.locator("#sequence-editor").click({ button: "right" });
  await page.locator("#context-optimize-codons").click();
  assert.match(
    await page.locator("#codon-source").textContent(),
    /Arginine marker/,
  );
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} codon/protein browser checks passed: CDS context menus, single/dual host, weighting, immutable previews, apply/undo, copies, protein import/save/reopen/FASTA, ambiguous input, custom counts and narrow layout.`,
  );
} finally {
  await browser.close();
}
