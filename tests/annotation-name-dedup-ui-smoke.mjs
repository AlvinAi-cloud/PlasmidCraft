import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium } from "./ui-browser.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
const browser = await chromium.launch({ headless: true });
const page = await fixturePage(browser, { viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const feature = (id, name, start, end, type, strand = 1) => ({ id, name, type, strand, color: "#79a995", segments: [{ start, end }], qualifiers: { note: [`Evidence ${id}`] } });
const source = { name: "Nested duplicate definitions", sequence: "A".repeat(2000), topology: "circular", primers: [], features: [
  feature("p-short", "AmpR promoter", 100, 172, "promoter"),
  feature("p-long", "AMPR PROMOTER", 67, 172, "promoter"),
  feature("f-short", "f1 ori", 500, 859, "rep_origin"),
  feature("f-long", "F1 ORI", 500, 956, "rep_origin"),
  feature("l-long", "lac operator", 1100, 1125, "protein_bind"),
  feature("l-short", "LAC OPERATOR", 1104, 1121, "protein_bind"),
  feature("separate", "AmpR promoter", 1300, 1405, "promoter"),
  feature("reverse", "AmpR promoter", 67, 172, "promoter", -1),
  feature("other", "Different annotation", 67, 172, "promoter"),
] };
let checks = 0;
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  await page.locator("#file-input").setInputFiles({ name: "duplicates.pcraft", mimeType: "application/json", buffer: Buffer.from(serializeProject(source)) });
  await page.locator('#view-tabs [data-view="features"]').click();
  const merge = page.locator('[data-command="deduplicate-features"]');
  assert.match(await merge.textContent(), /\(3\)/);
  assert.equal(await merge.isEnabled(), true);
  await page.locator('#main-panel tr[data-feature="p-short"]').click();
  await merge.click();
  assert.equal(await page.locator("#feature-count").textContent(), "6");
  assert.equal(await merge.isDisabled(), true);
  assert.equal(await page.locator('#main-panel tr[data-feature="p-long"].selected').count(), 1);
  assert.equal(await page.locator('#main-panel tr[data-feature="p-short"]').count(), 0);
  checks++;
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  const download = await downloadPromise;
  const saved = parseProject(await fs.readFile(await download.path(), "utf8"));
  assert.equal(saved.sequence, source.sequence);
  assert.deepEqual(saved.features.map((f) => f.id), ["p-long", "f-long", "l-long", "separate", "reverse", "other"]);
  assert.deepEqual(saved.features.find((f) => f.id === "p-long").qualifiers.note, ["Evidence p-long", "Evidence p-short"]);
  checks++;
  await page.locator("#undo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "9");
  assert.equal(await merge.isEnabled(), true);
  await page.locator("#redo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "6");
  assert.equal(await merge.isDisabled(), true);
  await page.locator('#view-tabs [data-view="map"]').click();
  assert.equal(await page.locator('#plasmid-map [data-feature="p-short"]').count(), 0);
  assert.ok(await page.locator('#plasmid-map [data-feature="p-long"]').count() > 0);
  assert.deepEqual(errors, []);
  checks++;
  console.log(`${checks} annotation-name cleanup UI checks passed: case-insensitive nested spans, longest-definition retention, separate-copy/strand preservation, saved metadata and single-step undo/redo.`);
} finally { await browser.close(); }
