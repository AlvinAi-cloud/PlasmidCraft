import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium } from "./ui-browser.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
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
  sequence: "ATGCGTACCGATGCTACGATGCAATGCTAGCTAGCTAG",
  features: [],
  primers: [],
});
const first = makeRecord("Linear FASTA-like document", "linear");
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
}
let checks = 0;
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  await load(first);
  await layout("linear");
  await page.locator('[data-layout="circular"]').click();
  await layout("circular");
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
  assert.equal(await page.locator("#dirty-indicator").isHidden(), true);
  assert.equal(await page.locator("#undo-button").isDisabled(), true);
  const waiting = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  const file = await waiting;
  const saved = parseProject(await fs.readFile(await file.path(), "utf8"));
  assert.equal(saved.topology, "linear");
  assert.equal(saved.sequence, first.sequence);
  assert.deepEqual(saved.viewSettings, { mapLayout: "circular" });
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
  assert.deepEqual(parseProject(secondBytes.toString()).viewSettings, {
    mapLayout: "linear",
  });
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "linear-view-reopened.pcraft",
      mimeType: "application/json",
      buffer: secondBytes,
    });
  await layout("linear");
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} map-layout memory checks passed: independent per-document choices, toolbar/menu controls, repeated tab switches, saved/reopened layouts in a fresh renderer, legacy defaults and unchanged DNA/topology.`,
  );
} finally {
  await browser.close();
}
