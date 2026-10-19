import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { COMMON_FEATURE_LIBRARY as catalog } from "../viewer/common-features.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
import { snapgeneExport } from "../viewer/snapgene-export.mjs";
import { parseSnapgene } from "../viewer/core.mjs";
import { fixturePage, chromium, testOutput } from "./ui-browser.mjs";
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
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0;
const egfp = catalog.features.find((f) => f.name === "EGFP");
const source = {
  name: "Catalog export test",
  description: "Public EGFP variant test",
  sequence: "GGGG" + egfp.sequence + "CCCCTAGCTAGC",
  topology: "circular",
  features: [],
  primers: [],
  comments: [],
  warnings: [],
};
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  await page.locator("#file-input").setInputFiles({
    name: "test.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(source)),
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent ===
      "Catalog export test",
  );
  async function command(menu, action) {
    await page.getByRole("button", { name: menu, exact: true }).click();
    await page
      .locator(`.app-menu-popup:not([hidden]) [data-command="${action}"]`)
      .click();
  }
  async function click(action) {
    await page.locator(`[data-wf-action="${action}"]`).click();
  }
  async function saved() {
    const pending = page.waitForEvent("download");
    await page.locator("#save-project-button").click();
    return parseProject(
      await fs.readFile(await (await pending).path(), "utf8"),
    );
  }
  await command("Tools", "feature-libraries");
  assert.equal(await page.locator("#library-entries tbody tr").count(), 68);
  assert.equal(
    await page.locator('[data-wf-action="library-delete"]').isDisabled(),
    true,
  );
  assert.equal(await page.locator("#lib-entry-name").isVisible(), false);
  checks++;
  await page.locator("#library-filter").fill("Myc tag");
  assert.equal(await page.locator("#library-entries tbody tr").count(), 1);
  assert.match(
    await page.locator("#library-entries").textContent(),
    /8 DNA patterns/,
  );
  await page.locator("#library-entries details summary").click();
  checks++;
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/myc-library.png",
    });
  }
  await page.locator("#library-filter").fill("U55762.1");
  assert.ok((await page.locator("#library-entries tbody tr").count()) > 1);
  await page.locator("#library-category").selectOption("Reporters");
  assert.equal(await page.locator("#library-entries tbody tr").count(), 1);
  assert.match(await page.locator("#library-entries").textContent(), /EGFP/);
  checks++;
  await page.locator("#library-entries details summary").click();
  assert.equal(
    await page.locator("#library-entries a").getAttribute("href"),
    "https://www.ncbi.nlm.nih.gov/nuccore/U55762.1",
  );
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/feature-catalog.png",
    });
  }
  await click("library-match");
  await page.locator("#wf-progress").waitFor({ state: "hidden" });
  assert.equal((await page.locator("#wf-error").textContent()).trim(), "");
  assert.equal(await page.locator("#library-matches tbody tr").count(), 1);
  await click("library-apply");
  assert.equal(await page.locator("#feature-count").textContent(), "1");
  checks++;
  await page.locator("#undo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "0");
  await page.locator("#redo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "1");
  checks++;
  const out = await saved();
  assert.equal(out.features[0].name, "EGFP");
  await click("library-copy");
  assert.equal(
    await page.locator('[data-wf-action="library-delete"]').isEnabled(),
    true,
  );
  await page.locator("#library-filter").fill("");
  await page.locator("#library-category").selectOption("");
  assert.equal(await page.locator("#library-entries tbody tr").count(), 68);
  await page.locator("#library-filter").fill("Myc tag");
  await page.locator('[data-wf-action="library-edit"]').click();
  assert.equal(
    (await page.locator("#lib-entry-alternates").inputValue()).split("\n")
      .length,
    7,
  );
  await page.locator("#lib-entry-name").fill("Myc tag reviewed");
  await click("library-add");
  assert.equal(await page.locator("#library-entries tbody tr").count(), 1);
  assert.match(
    await page.locator("#library-entries").textContent(),
    /8 DNA patterns/,
  );
  await page.locator("#library-filter").fill("");
  checks++;
  const local = {
    ...source,
    features: [
      {
        id: "local",
        name: "Private test motif",
        type: "misc_feature",
        strand: 1,
        segments: [{ start: 0, end: 8 }],
        qualifiers: {},
        color: "#123456",
      },
    ],
  };
  await page.locator("#library-file-input").setInputFiles({
    name: "Synthetic.ftrs",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(snapgeneExport(local).bytes),
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#library-select")
      .selectedOptions[0].textContent.startsWith("Synthetic"),
  );
  assert.equal(await page.locator("#library-entries tbody tr").count(), 1);
  assert.match(
    await page.locator("#library-entries").textContent(),
    /Private test motif/,
  );
  checks++;
  await page.reload();
  await page.locator("#plasmid-map").waitFor();
  await command("Tools", "feature-libraries");
  assert.equal(await page.locator("#library-entries tbody tr").count(), 1);
  assert.match(
    await page.locator("#library-select option:checked").textContent(),
    /Synthetic/,
  );
  checks++;
  await page.locator("#file-input").setInputFiles({
    name: "out.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(out)),
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent ===
      "Catalog export test",
  );
  await command("File", "export-snapgene");
  await page.getByRole("heading", { name: "SnapGene format" }).waitFor();
  if (process.env.PLASMIDCRAFT_SCREENSHOTS)
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/dna-export.png",
    });
  const pending = page.waitForEvent("download");
  await page.locator('[data-action="save-snapgene-export"]').click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /\.dna$/);
  const bytes = await fs.readFile(await download.path()),
    [imported] = parseSnapgene(bytes);
  assert.equal(imported.sequence, out.sequence);
  assert.equal(imported.features[0].name, "EGFP");
  assert.equal(await page.locator("#dirty-indicator").isHidden(), true);
  checks++;
  await page.locator("#file-input").setInputFiles({
    name: "Reopened.dna",
    mimeType: "application/octet-stream",
    buffer: bytes,
  });
  await page.waitForFunction(
    () => document.querySelectorAll("#document-tabs button").length >= 2,
  );
  assert.equal(await page.locator("#feature-count").textContent(), "1");
  checks++;
  assert.deepEqual(errors, []);
  console.log(`${checks} catalog/export browser checks passed.`);
} finally {
  await browser.close();
}
