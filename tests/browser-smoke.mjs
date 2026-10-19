// Optional browser checks: install Playwright or set PLASMIDCRAFT_PLAYWRIGHT_PATH.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseProject } from "../viewer/project.mjs";
import { fixturePage, chromium, testOutput } from "./ui-browser.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const errors = [],
  requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => requests.push(request.url()));
const url = process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317";
let checks = 0;
try {
  await page.goto(url);
  await page.locator("#plasmid-map").waitFor();
  assert.equal(await page.locator(".annotation-row").count(), 6);
  checks++;
  await page.screenshot({
    path:
      process.env.PLASMIDCRAFT_SCREENSHOT || testOutput("plasmidcraft-map.png"),
    fullPage: true,
  });
  await page.locator('.annotation-row[data-feature="feature-1"]').click();
  assert.match(
    await page.locator(".inspector-name").textContent(),
    /Reporter CDS/,
  );
  checks++;
  await page.getByRole("button", { name: "Show in sequence" }).click();
  assert.ok((await page.locator("[data-position].selected").count()) > 0);
  checks++;
  await page.locator("#sequence-search").fill("GAATTC");
  await page.waitForFunction(() =>
    document.querySelector("#search-status").textContent.includes("matches"),
  );
  assert.match(await page.locator("#search-status").textContent(), /of/);
  checks++;
  await page.locator("#go-to").click();
  await page.locator("#range-start").fill("4800");
  await page.locator("#range-end").fill("20");
  await page
    .getByRole("button", { name: "Show sequence", exact: true })
    .click();
  assert.match(
    await page.locator("#selection-status").textContent(),
    /47 bp selected/,
  );
  checks++;
  await page.getByRole("button", { name: "Annotate selection" }).click();
  await page.locator("#annotation-name").fill("Origin-spanning test");
  await page
    .getByRole("button", { name: "Add annotation", exact: true })
    .last()
    .click();
  assert.equal(await page.locator(".annotation-row").count(), 7);
  checks++;
  await page.locator("#undo-button").click();
  assert.equal(await page.locator(".annotation-row").count(), 6);
  checks++;
  await page.locator("#redo-button").click();
  assert.equal(await page.locator(".annotation-row").count(), 7);
  checks++;
  await page.locator("#export-button").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-export="gb"]').click();
  const download = await downloadPromise;
  const text = await fs.readFile(await download.path(), "utf8");
  assert.match(text, /Origin-spanning test/);
  assert.match(text, /join\(4800\.\.4826,1\.\.20\)/);
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  checks++;
  const projectDownloadPromise = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  const projectDownload = await projectDownloadPromise;
  const projectBytes = await fs.readFile(await projectDownload.path());
  const saved = parseProject(projectBytes.toString("utf8"));
  assert.equal(saved.features.length, 7);
  assert.equal(saved.features.at(-1).name, "Origin-spanning test");
  assert.equal(saved.primers.length, 2);
  assert.equal(await page.locator("#dirty-indicator").isHidden(), true);
  checks++;
  await page.locator("#file-input").setInputFiles({
    name: "saved.pcraft",
    mimeType: "application/json",
    buffer: projectBytes,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#document-format").textContent === "PlasmidCraft",
  );
  assert.equal(await page.locator(".annotation-row").count(), 7);
  await page.locator('[data-close-document="document-2"]').click();
  assert.equal(await page.locator("#doc-count").textContent(), "1");
  checks++;
  await page.locator("#tools-button").click();
  await page.locator('[data-view="enzymes"]').click();
  await page.locator('[data-digest="EcoRI"]').check();
  assert.match(await page.locator(".digest-card").textContent(), /EcoRI/);
  checks++;
  await page.locator("#tools-button").click();
  await page.locator('[data-view="translation"]').click();
  assert.equal(await page.locator(".translation-block").count(), 6);
  checks++;
  await page.locator("#file-input").setInputFiles({
    name: "two.fasta",
    mimeType: "text/plain",
    buffer: Buffer.from(">first\nACGTNN\n>second\nRYSW\n"),
  });
  await page.waitForFunction(
    () => document.querySelector("#doc-count").textContent === "3",
  );
  assert.equal(await page.locator("#document-name").textContent(), "first");
  checks++;
  await page.locator('#view-tabs [data-view="sequence"]').click();
  assert.equal(await page.locator("[data-position]").count(), 6);
  assert.equal(await page.locator(".base.ambiguous").count(), 2);
  checks++;
  await page.locator("#file-input").setInputFiles({
    name: "bad.fasta",
    mimeType: "text/plain",
    buffer: Buffer.from(">invalid\nAC-GT\n"),
  });
  await page.locator("#toast.error").waitFor();
  assert.equal(await page.locator("#doc-count").textContent(), "3");
  checks++;
  await page
    .locator("#file-input")
    .setInputFiles(path.join(root, "tests/fixtures/synthetic-test.gb"));
  await page.waitForFunction(
    () => document.querySelector("#doc-count").textContent === "4",
  );
  assert.equal(await page.locator(".annotation-row").count(), 8);
  checks++;
  await page.locator('.annotation-row[data-feature="feature-6"]').click();
  await page
    .locator("#inspector")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.locator("#annotation-name").fill("Edited forward primer");
  await page
    .getByRole("button", { name: "Save annotation", exact: true })
    .click();
  await page.locator('#view-tabs [data-view="primers"]').click();
  assert.equal(await page.locator(".data-table tbody tr").count(), 2);
  assert.match(
    await page.locator(".data-table").textContent(),
    /Edited forward primer/,
  );
  await page.locator("#undo-button").click();
  assert.match(await page.locator(".data-table").textContent(), /Reporter-F/);
  assert.doesNotMatch(
    await page.locator(".data-table").textContent(),
    /Edited forward primer/,
  );
  checks++;
  await page.locator('#view-tabs [data-view="features"]').click();
  await page.locator("#table-filter").fill("Reporter");
  assert.equal(await page.locator(".data-table tbody tr").count(), 3);
  checks++;
  await page.locator('#view-tabs [data-view="map"]').click();
  await page.locator('[data-layout="linear"]').click();
  assert.match(
    await page.locator("#plasmid-map").getAttribute("aria-label"),
    /Linear/,
  );
  checks++;
  if (process.env.PLASMIDCRAFT_REFERENCE_DIR) {
    await page
      .locator("#file-input")
      .setInputFiles(
        path.join(process.env.PLASMIDCRAFT_REFERENCE_DIR, "sample-f.dna"),
      );
    await page.waitForFunction(
      () =>
        document.querySelector("#document-format").textContent === "SnapGene",
    );
    assert.equal(await page.locator(".annotation-row").count(), 2);
    checks++;
    await page
      .locator("#file-input")
      .setInputFiles(
        path.join(process.env.PLASMIDCRAFT_REFERENCE_DIR, "3730.ab1"),
      );
    await page.waitForSelector(".trace-card svg");
    assert.equal(await page.locator(".trace-card svg path").count(), 5);
    await page.screenshot({
      path: testOutput("plasmidcraft-trace.png"),
      fullPage: true,
    });
    checks++;
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  checks++;
  assert.deepEqual(errors, []);
  assert.ok(requests.every((request) => request.startsWith(url)));
  checks++;
  console.log(
    `${checks} browser checks passed; no page errors or external network requests.`,
  );
} finally {
  await browser.close();
}
