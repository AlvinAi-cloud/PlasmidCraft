// Uses the actual shipped example, without the synthetic regression fixture.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, testOutput } from "./ui-browser.mjs";
import { parseFile } from "../viewer/core.mjs";
const [source] = parseFile(
  await fs.readFile(new URL("../examples/pET-21b(+).dna", import.meta.url)),
  "pET-21b(+).dna",
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0;
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  assert.equal(await page.locator("#document-name").textContent(), source.name);
  assert.match(
    await page.locator("#document-summary").textContent(),
    /5,442 bp/,
  );
  assert.equal(
    await page.locator(".annotation-row").count(),
    source.features.length,
  );
  assert.equal(await page.locator("#primer-count").textContent(), "0");
  assert.equal(await page.locator("#dirty-indicator").isVisible(), false);
  checks++;
  await page.screenshot({ path: testOutput("pET-21b-default-map.png") });
  await page.locator('#view-tabs [data-view="sequence"]').click();
  const dna = await page.locator("[data-position]").allTextContents();
  assert.equal(dna.join(""), source.sequence);
  assert.ok((await page.locator('[aria-label="Inline CDS AmpR"]').count()) > 0);
  assert.ok((await page.locator('[aria-label="Inline CDS lacI"]').count()) > 0);
  checks++;
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.locator('#app-help-menu [data-command="example"]').click();
  assert.equal(await page.locator("#doc-count").textContent(), "1");
  checks++;
  await page.locator("#document-tabs [data-close-document]").click();
  assert.equal(await page.locator("#doc-count").textContent(), "0");
  await page.locator('#main-panel [data-action="example"]').click();
  assert.equal(await page.locator("#document-name").textContent(), source.name);
  assert.equal(await page.locator("#doc-count").textContent(), "1");
  assert.doesNotMatch(
    await page.locator("body").textContent(),
    /pCraft-demo|synthetic example plasmid/i,
  );
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} supplied pET-21b example UI checks passed: real startup, exact DNA and annotations, translations, deduplication and reopen.`,
  );
} finally {
  await browser.close();
}
