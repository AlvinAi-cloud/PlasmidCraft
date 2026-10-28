import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium } from "./ui-browser.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
import { parseGenbank, parseSnapgene } from "../viewer/core.mjs";
const browser = await chromium.launch({ headless: true });
const page = await fixturePage(browser, {
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const makeRecord = (name, topology) => ({
  name,
  topology,
  // EcoRI is present only across the circular origin (GAAT + TC).
  sequence: "TCGCGTACCGATGCTACGATGCAATGCTAGCTAGAAT",
  features: [],
  primers: [],
});
const first = makeRecord("Linear FASTA-like document", "linear");
first.dnaEnds = {
  left: { kind: "blunt", overhang: "", phosphorylated: true },
  right: { kind: "blunt", overhang: "", phosphorylated: false },
};
const second = makeRecord("Circular annotated document", "circular");
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
async function select(name) {
  await page
    .locator("#document-tabs .file-tab")
    .filter({ hasText: `${name}.pcraft` })
    .click();
}
async function layout(value) {
  assert.match(
    await page.locator("#plasmid-map").getAttribute("aria-label"),
    value === "circular" ? /Circular/ : /Linear/,
  );
  assert.match(
    await page.locator(`[data-layout="${value}"]`).getAttribute("class"),
    /active/,
  );
  assert.match(
    await page.locator("#document-summary").textContent(),
    value === "circular" ? /Circular DNA/ : /Linear DNA/,
  );
  assert.equal(
    await page.getByRole("button", { name: "Circular map", exact: true }).getAttribute("aria-pressed"),
    String(value === "circular"),
  );
}
let checks = 0;
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  await load(first);
  await layout("linear");
  await page.locator('[data-layout="circular"]').click();
  await layout("circular");
  assert.equal(await page.locator("#dirty-indicator").isVisible(), true);
  assert.equal(await page.locator("#undo-button").isEnabled(), true);
  await page.locator("#undo-button").click();
  await layout("linear");
  assert.equal(await page.locator("#dirty-indicator").isHidden(), true);
  assert.match(await page.locator("#inspector").textContent(), /DNA ENDS/);
  await page.locator("#redo-button").click();
  await layout("circular");
  assert.doesNotMatch(await page.locator("#inspector").textContent(), /DNA ENDS/);
  checks++;
  await load(second);
  await layout("circular");
  await page.getByRole("button", { name: "Linear map", exact: true }).click();
  await layout("linear");
  checks++;
  for (let i = 0; i < 3; i++) {
    await select(first.name);
    await layout("circular");
    await select(second.name);
    await layout("linear");
  }
  checks++;
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page.locator('#app-view-menu [data-command="layout-circular"]').click();
  await select(first.name);
  await layout("circular");
  await select(second.name);
  await layout("circular");
  await page.locator('[data-layout="linear"]').click();
  await select(first.name);
  await layout("circular");
  await select(second.name);
  await layout("linear");
  checks++;
  await select(first.name);
  await page.locator('#view-tabs [data-view="sequence"]').click();
  await select(second.name);
  await select(first.name);
  await layout("circular");
  assert.equal(await page.locator("#dirty-indicator").isVisible(), true);
  assert.equal(await page.locator("#undo-button").isEnabled(), true);
  // Downstream tools must see the unsaved setting, including the joined origin.
  await page.locator("#sequence-search").fill("GAATTC");
  await page.waitForFunction(() => document.querySelector("#search-status").textContent === "1 of 1 matches");
  await page.locator('#view-tabs [data-view="enzymes"]').click();
  assert.equal(await page.locator('[data-digest="EcoRI"]').locator("xpath=../..").locator("td").nth(4).textContent(), "1");
  await page.locator('#view-tabs [data-view="map"]').click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator('#app-edit-menu [data-command="set-origin"]').click();
  assert.equal(await page.locator("#dna-origin").isVisible(), true);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  checks++;
  for (const [format, parse] of [["gb", parseGenbank], ["dna", parseSnapgene]]) {
    const exported = page.waitForEvent("download");
    await page.locator("#export-button").click();
    await page.locator(`[data-export="${format}"]`).click();
    const bytes = await fs.readFile(await (await exported).path());
    const record = parse(format === "gb" ? bytes.toString() : bytes)[0];
    assert.equal(record.topology, "circular");
    assert.equal(record.sequence, first.sequence);
  }
  checks++;
  const waiting = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  const file = await waiting;
  const saved = parseProject(await fs.readFile(await file.path(), "utf8"));
  assert.equal(saved.topology, "circular");
  assert.equal(saved.sequence, first.sequence);
  assert.equal(saved.viewSettings, undefined);
  assert.equal(saved.dnaEnds, undefined);
  assert.equal(saved.editHistory.nodes.at(-1).record.topology, "circular");
  // A fresh renderer has no in-memory document preferences from the first page.
  const reopened = await fixturePage(browser, {
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  reopened.on("pageerror", (error) => errors.push(error.message));
  await reopened.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await reopened.locator("#plasmid-map").waitFor();
  await reopened
    .locator("#file-input")
    .setInputFiles({
      name: "reopened.pcraft",
      mimeType: "application/json",
      buffer: Buffer.from(await fs.readFile(await file.path())),
    });
  await reopened.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent ===
      "Linear FASTA-like document",
  );
  assert.match(
    await reopened.locator("#plasmid-map").getAttribute("aria-label"),
    /Circular/,
  );
  await reopened.close();
  checks++;
  await select(second.name);
  await layout("linear");
  const secondWaiting = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  const secondFile = await secondWaiting;
  const secondBytes = await fs.readFile(await secondFile.path());
  assert.equal(parseProject(secondBytes.toString()).topology, "linear");
  assert.equal(parseProject(secondBytes.toString()).viewSettings, undefined);
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "linear-view-reopened.pcraft",
      mimeType: "application/json",
      buffer: secondBytes,
    });
  await layout("linear");
  await page.locator("#sequence-search").fill("GAATTC");
  await page.waitForFunction(() => document.querySelector("#search-status").textContent === "No matches");
  await page.locator('#view-tabs [data-view="enzymes"]').click();
  assert.equal(await page.locator('[data-digest="EcoRI"]').locator("xpath=../..").locator("td").nth(4).textContent(), "0");
  checks++;
  // Honor files saved by the earlier display-only implementation, once.
  await load({ ...makeRecord("Legacy saved choice", "linear"), viewSettings: { mapLayout: "circular" } });
  await layout("circular");
  assert.equal(await page.locator("#dirty-indicator").isVisible(), true);
  await page.locator("#undo-button").click();
  await layout("linear");
  await page.locator("#redo-button").click();
  await layout("circular");
  checks++;
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator('#app-edit-menu [data-command="set-origin"]').click();
  await page.locator("#dna-origin").fill("3");
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  assert.equal(await page.locator("#apply-sequence-tool").isEnabled(), true);
  await page.getByRole("button", { name: "Linear map", exact: true }).click();
  await page.locator("#apply-sequence-tool").click();
  assert.match(await page.locator("#modal-error").textContent(), /source document changed/i);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} document-topology checks passed: unsaved per-document status, toolbar/menu controls, tab switches, undo/redo, DNA ends, circular-origin search and restriction sites, origin tools, GenBank/SnapGene export, save/reopen and legacy choice migration.`,
  );
} finally {
  await browser.close();
}
