import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { serializeProject, parseProject } from "../viewer/project.mjs";
import { featureSequence } from "../viewer/core.mjs";
import { fixturePage, chromium, testOutput } from "./ui-browser.mjs";
const source = {
  name: "DNA-tools-test",
  description: "Synthetic coordinate test",
  sequence: "ATGACCCCGGGGTTTA",
  topology: "circular",
  warnings: [],
  features: [
    {
      id: "cds",
      name: "Coding feature",
      type: "CDS",
      strand: 1,
      color: "#589",
      segments: [{ start: 0, end: 12 }],
      qualifiers: {
        codon_start: ["1"],
        translation: ["TEST"],
        protein_id: ["source-id"],
      },
    },
    {
      id: "marker",
      name: "Reverse marker",
      type: "misc_feature",
      strand: -1,
      color: "#9a7",
      segments: [{ start: 8, end: 14 }],
      qualifiers: {},
    },
    {
      id: "bind",
      name: "Primer binding",
      type: "primer_bind",
      strand: 1,
      color: "#7a9",
      segments: [{ start: 4, end: 8 }],
      qualifiers: {},
    },
  ],
  primers: [
    {
      id: "p",
      name: "Test primer",
      sequence: "CCCC",
      annotationId: "bind",
      description: "",
      sites: [{ strand: 1, segments: [{ start: 4, end: 8 }] }],
    },
  ],
};
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
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  async function load(record = source) {
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
  async function command(menu, action) {
    await page.getByRole("button", { name: menu, exact: true }).first().click();
    await page
      .locator(`.app-menu-popup:not([hidden]) [data-command="${action}"]`)
      .click();
  }
  async function preview() {
    await page
      .getByRole("button", { name: "Preview changes", exact: true })
      .click();
  }
  async function apply() {
    await page.locator("#apply-sequence-tool").click();
    await page.locator("#modal").waitFor({ state: "hidden" });
  }
  async function saved() {
    const promise = page.waitForEvent("download");
    await page.locator("#save-project-button").click();
    const download = await promise;
    return parseProject(await fs.readFile(await download.path(), "utf8"));
  }
  await load();
  await command("Edit", "edit-dna");
  await page.locator("#dna-edit-mode").selectOption("replace");
  await page.locator("#dna-start").fill("5");
  await page.locator("#dna-end").fill("8");
  await page.locator("#dna-insert").fill("NN");
  await preview();
  assert.match(
    await page.locator("#sequence-tool-preview").textContent(),
    /14 bp/,
  );
  assert.match(
    await page.locator("#sequence-tool-preview").textContent(),
    /Test primer/,
  );
  assert.match(await page.locator("#document-summary").textContent(), /16 bp/);
  checks++;
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    // setViewportSize acknowledges the browser resize before resize handlers and
    // ResizeObserver necessarily finish repositioning a floating dialog. Poll
    // actual geometry instead of asserting against that intermediate frame.
    try {
      await page.waitForFunction(
        ({ width, height }) => {
          const button = document.querySelector("#apply-sequence-tool");
          if (!button || innerWidth !== width || innerHeight !== height)
            return false;
          const rect = button.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top >= 0 &&
            rect.bottom <= height &&
            rect.left >= 0 &&
            rect.right <= width
          );
        },
        viewport,
        { timeout: 5000 },
      );
    } catch (error) {
      await page.screenshot({
        path: testOutput("sequence-tool-viewport-failure.png"),
      });
      const bounds = await page.locator("#apply-sequence-tool").boundingBox();
      throw new Error(
        `Apply did not fit viewport ${JSON.stringify(viewport)}; bounds ${JSON.stringify(bounds)}`,
        { cause: error },
      );
    }
    const applyBounds = await page
      .locator("#apply-sequence-tool")
      .boundingBox();
    assert.ok(
      applyBounds.y >= 0 &&
        applyBounds.y + applyBounds.height <= viewport.height,
      "Apply stays within viewport after preview",
    );
    assert.ok(
      applyBounds.x >= 0 && applyBounds.x + applyBounds.width <= viewport.width,
      "Apply fits narrow dialogs",
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks++;
  await page.locator("#dna-insert").fill("NNN");
  assert.equal(await page.locator("#apply-sequence-tool").isDisabled(), true);
  await page.locator("#dna-insert").fill("NN");
  await preview();
  await apply();
  assert.match(await page.locator("#document-summary").textContent(), /14 bp/);
  const edited = await saved();
  assert.equal(edited.sequence, "ATGANNGGGGTTTA");
  assert.equal(edited.features.length, 2);
  assert.equal(edited.primers[0].sequence, "CCCC");
  assert.equal(edited.primers[0].sites.length, 0);
  assert.equal(edited.features[0].qualifiers.translation, undefined);
  checks++;
  await page.locator("#undo-button").click();
  assert.match(await page.locator("#document-summary").textContent(), /16 bp/);
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  await page.locator("#redo-button").click();
  assert.match(await page.locator("#document-summary").textContent(), /14 bp/);
  assert.equal(await page.locator("#dirty-indicator").isHidden(), true);
  await page.locator("#undo-button").click();
  checks++;
  await command("Edit", "set-origin");
  await page.locator("#dna-origin").fill("6");
  await preview();
  await apply();
  const rotated = await saved();
  assert.equal(rotated.sequence, "CCCGGGGTTTAATGAC");
  source.features.forEach((f, i) =>
    assert.equal(
      featureSequence(rotated, rotated.features[i]),
      featureSequence(source, f),
    ),
  );
  await page.locator("#undo-button").click();
  checks++;
  await command("Edit", "reverse-dna");
  await preview();
  await apply();
  const reversed = await saved();
  assert.equal(reversed.sequence, "TAAACCCCGGGGTCAT");
  assert.equal(reversed.features[0].strand, -1);
  assert.equal(reversed.primers[0].sequence, "CCCC");
  assert.equal(reversed.primers[0].sites[0].strand, -1);
  await page.locator("#undo-button").click();
  checks++;
  await command("File", "extract-dna");
  await page.locator("#dna-output-name").fill("Origin fragment");
  await page.locator("#dna-start").fill("14");
  await page.locator("#dna-end").fill("3");
  await page.locator("#dna-extract-reverse").check();
  await preview();
  await apply();
  assert.equal(
    await page.locator("#document-name").textContent(),
    "Origin fragment",
  );
  assert.equal(await page.locator("#doc-count").textContent(), "3");
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  const fragment = await saved();
  assert.equal(fragment.sequence, "CATTAA");
  assert.equal(fragment.topology, "linear");
  checks++;
  await page
    .locator('#document-tabs [data-document="document-2"]')
    .first()
    .click();
  const originalAgain = await saved();
  assert.equal(originalAgain.sequence, source.sequence);
  assert.equal(originalAgain.features.length, 3);
  assert.equal(originalAgain.primers[0].sites.length, 1);
  checks++;
  await command("Edit", "edit-dna");
  await page.locator("#dna-edit-mode").selectOption("delete");
  await page.locator("#dna-start").fill("1");
  await page.locator("#dna-end").fill("16");
  await preview();
  assert.match(
    await page.locator("#modal-error").textContent(),
    /at least one base/,
  );
  assert.equal(await page.locator("#apply-sequence-tool").isDisabled(), true);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  checks++;
  await command("Edit", "edit-dna");
  await page.locator("#dna-edit-mode").selectOption("insert");
  await page.locator("#dna-start").fill("17");
  await page.locator("#dna-insert").fill("RY");
  await preview();
  await apply();
  const appended = await saved();
  assert.equal(appended.sequence, source.sequence + "RY");
  await page.locator("#undo-button").click();
  checks++;
  await command("Edit", "edit-dna");
  await page.locator("#dna-edit-mode").selectOption("delete");
  await page.locator("#dna-start").fill("2");
  await page.locator("#dna-end").fill("3");
  await preview();
  await apply();
  const deleted = await saved();
  assert.equal(deleted.sequence, "AACCCCGGGGTTTA");
  await page.locator("#undo-button").click();
  checks++;
  // Native Open or a programmatic import can change the active document while a modal is open.
  await command("Edit", "reverse-dna");
  await preview();
  await load({ ...source, name: "Different source" });
  await page.locator("#apply-sequence-tool").click();
  assert.match(
    await page.locator("#modal-error").textContent(),
    /source document changed/,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await saved()).sequence, source.sequence);
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} DNA-tool browser checks passed, including previews, remapping, full undo/redo, persistence, and stale-preview protection.`,
  );
} finally {
  await browser.close();
}
