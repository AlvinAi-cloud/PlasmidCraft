import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseProject, serializeProject } from "../viewer/project.mjs";
import { chromium, testOutput } from "./ui-browser.mjs";
const source = {
  name: "Protein-tools-test",
  description: "Synthetic circular protein fixture",
  sequence: "TAAATGATGAAA",
  topology: "circular",
  warnings: [],
  comments: [],
  features: [
    {
      id: "known",
      name: "Reference enzyme",
      type: "CDS",
      strand: 1,
      color: "#518ac2",
      segments: [
        { start: 6, end: 12 },
        { start: 0, end: 3 },
      ],
      qualifiers: {
        codon_start: ["1"],
        transl_table: ["11"],
        translation: ["STALE"],
      },
    },
    {
      id: "unsupported",
      name: "Unsupported code",
      type: "CDS",
      strand: 1,
      color: "#518ac2",
      segments: [{ start: 3, end: 12 }],
      qualifiers: { transl_table: ["4"] },
    },
  ],
  primers: [
    {
      id: "tailed",
      name: "Tailed primer",
      sequence: "GGATGAAA",
      sites: [{ strand: 1, segments: [{ start: 6, end: 12 }] }],
    },
  ],
};
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
page.on("pageerror", (error) => errors.push(error.message));
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
  async function command(action) {
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .locator(`.app-menu-popup:not([hidden]) [data-command="${action}"]`)
      .click();
  }
  async function download(button) {
    const promise = page.waitForEvent("download");
    await button.click();
    const result = await promise;
    return {
      text: await fs.readFile(await result.path(), "utf8"),
      name: result.suggestedFilename(),
    };
  }
  const find = () => page.locator('#orf-form button[type="submit"]').click();
  await load();
  await command("find-orfs");
  await page.locator("#orf-min-aa").fill("2");
  await page.locator("#orf-code").selectOption("11");
  await page.locator("#orf-starts").selectOption("code");
  await find();
  assert.equal(await page.locator("#orf-results tbody tr").count(), 1);
  assert.match(
    await page.locator("#orf-results").textContent(),
    /Crosses origin/,
  );
  assert.equal(await page.locator("#dirty-indicator").isHidden(), true);
  checks++;
  const orfExport = await download(
    page.locator('[data-orf-action="export"]').first(),
  );
  assert.match(orfExport.text, /transl_table=11/);
  assert.ok(orfExport.text.endsWith("\nMMK\n"));
  assert.ok(orfExport.name.endsWith(".faa"));
  assert.equal(await page.locator("#dirty-indicator").isHidden(), true);
  checks++;
  await page.locator('[data-orf-action="annotate"]').first().click();
  assert.equal(
    await page.locator('[data-orf-action="annotate"]').first().isDisabled(),
    true,
  );
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  const saved = parseProject(
    (await download(page.locator("#save-project-button"))).text,
  );
  assert.equal(saved.features.length, 3);
  assert.equal(saved.features[2].qualifiers.transl_table[0], "11");
  assert.match(saved.features[2].qualifiers.note[0], /not a confirmed gene/);
  assert.equal(saved.primers[0].sequence, "GGATGAAA");
  checks++;
  await page.locator("#undo-button").click();
  assert.equal(
    await page.locator('[data-orf-action="annotate"]').first().isDisabled(),
    false,
  );
  assert.equal(await page.locator("#feature-count").textContent(), "2");
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  await page.locator("#redo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "3");
  assert.equal(await page.locator("#dirty-indicator").isHidden(), true);
  checks++;
  await command("coding-proteins");
  assert.equal(await page.locator(".coding-protein-card").count(), 3);
  assert.equal(
    await page
      .locator('[data-cds-card="known"] .protein-sequence')
      .textContent(),
    "MK",
  );
  assert.match(
    await page.locator(".coding-protein-card").nth(1).textContent(),
    /Genetic code 4 is not supported/,
  );
  assert.equal(
    await page
      .locator(".coding-protein-card")
      .nth(1)
      .locator("[data-protein-export]")
      .count(),
    0,
  );
  const knownExport = await download(
    page.locator('[data-protein-export="known"]'),
  );
  assert.ok(knownExport.text.endsWith("\nMK\n"));
  assert.ok(!knownExport.text.includes("STALE"));
  checks++;
  await command("view-translation");
  assert.equal(await page.locator(".translation-block").count(), 6);
  checks++;
  await command("find-orfs");
  await page.locator("#orf-nested").check();
  assert.equal(await page.locator("#orf-results").count(), 0);
  await find();
  assert.equal(await page.locator("#orf-results tbody tr").count(), 2);
  assert.equal(
    await page.locator('[data-orf-action="annotate"]:disabled').count(),
    2,
  );
  checks++;
  await page.locator("#orf-strands").selectOption("reverse");
  await find();
  assert.equal(await page.locator("#orf-results tbody tr").count(), 0);
  await page.locator("#orf-strands").selectOption("forward");
  await find();
  assert.equal(await page.locator("#orf-results tbody tr").count(), 2);
  checks++;
  await page.setViewportSize({ width: 390, height: 800 });
  assert.ok(await page.locator('#orf-form button[type="submit"]').isVisible());
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks++;
  await page.locator('[data-orf-action="show"]').first().click();
  assert.equal(
    await page.locator(".reference-track .base.selected").count(),
    12,
  );
  checks++;
  await page.locator('.commandbar [data-command="edit-dna"]').click();
  await page.locator("#dna-edit-mode").selectOption("replace");
  await page.locator("#dna-start").fill("1");
  await page.locator("#dna-end").fill("1");
  await page.locator("#dna-insert").fill("C");
  await page
    .getByRole("button", { name: "Preview changes", exact: true })
    .click();
  await page.locator("#apply-sequence-tool").click();
  await command("find-orfs");
  assert.equal(await page.locator("#orf-results").count(), 0);
  await find();
  assert.equal(await page.locator("#orf-results tbody tr").count(), 0);
  await page.locator("#undo-button").click();
  await find();
  assert.equal(await page.locator("#orf-results tbody tr").count(), 2);
  checks++;
  await load({ ...source, name: "Different document" });
  await command("find-orfs");
  assert.equal(await page.locator("#orf-results").count(), 0);
  checks++;
  await load({ ...saved, editHistory: undefined, name: "Reopened proteins" });
  await command("coding-proteins");
  assert.equal(
    await page
      .locator("[data-cds-card] .protein-sequence")
      .allTextContents()
      .then((values) => values.join(",")),
    "MK,MMK",
  );
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} protein-tool browser checks passed: ORFs, annotation undo/redo, genetic codes, protein exports, source invalidation, project persistence and narrow layout.`,
  );
} finally {
  await browser.close();
}
