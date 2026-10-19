import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "./ui-browser.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
import { reverseComplement } from "../viewer/core.mjs";
import { csvRows } from "../viewer/workflow-common.mjs";
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
let seed = 87234;
const dna = Array.from({ length: 600 }, () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return "ACGT"[seed >>> 30];
});
dna.splice(150, 12, ...reverseComplement("ATGAAAGGTTAA"));
const source = {
  name: "Mutagenesis template",
  sequence: dna.join(""),
  topology: "circular",
  features: [
    {
      id: "cds",
      name: "Reverse test CDS",
      type: "CDS",
      strand: -1,
      segments: [{ start: 150, end: 162 }],
      qualifiers: {},
      color: "#79a995",
    },
  ],
  primers: [],
  comments: [],
  warnings: [],
};
const action = async (name) =>
  page.locator(`[data-mutagenesis="${name}"]`).click();
async function open() {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .locator(
      '.app-menu-popup:not([hidden]) [data-command="design-mutagenesis"]',
    )
    .click();
  await page
    .getByRole("heading", { name: "Mutagenic Primer Design", exact: true })
    .waitFor();
}
async function preview(text) {
  await page.locator("#mutagenesis-edits").fill(text);
  await action("preview");
  if (await page.locator("#mutagenesis-strategy-choice").count())
    await action("choose-exact");
  await page.locator("#mutagenesis-pool").waitFor();
}
async function save() {
  const p = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  return parseProject(await fs.readFile(await (await p).path(), "utf8"));
}
let checks = 0;
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#file-input").setInputFiles({
    name: "mutagenesis.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(source)),
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent ===
      "Mutagenesis template",
  );
  await open();
  assert.equal(await page.locator("#mutagenesis-mode").inputValue(), "dna");
  checks++;
  const base = source.sequence[199] === "T" ? "A" : "T";
  await preview(`200: ${base}`);
  assert.match(
    await page.locator("#mutagenesis-result").textContent(),
    /1 oligo pair\(s\)/,
  );
  assert.match(
    await page.locator("#mutagenesis-pair").textContent(),
    /Forward/,
  );
  checks++;
  let download = page.waitForEvent("download");
  await action("csv");
  const csv = csvRows(await fs.readFile(await (await download).path(), "utf8"));
  assert.equal(csv.length, 3);
  assert.equal(csv[1][4], csv[1][9] + base);
  assert.equal(csv[1][7], "overlap");
  assert.ok(Number(csv[1][8]) >= 20);
  assert.ok(csv[1][2].startsWith(csv[1][4]));
  checks++;
  await action("create");
  assert.match(
    await page.locator("#document-name").textContent(),
    /_mutagenesis_1/,
  );
  const mutant = await save();
  assert.equal(
    mutant.sequence,
    source.sequence.slice(0, 199) + base + source.sequence.slice(200),
  );
  assert.equal(mutant.topology, "circular");
  checks++;
  await page
    .locator("[data-document]")
    .filter({ hasText: "mutagenesis.pcraft" })
    .first()
    .click();
  assert.equal((await save()).sequence, source.sequence);
  await open();
  await page.locator("#mutagenesis-mode").selectOption("amino");
  await page.locator("#mutagenesis-cds").selectOption("cds");
  await preview("2: D,E,W\n3: A,G,S");
  assert.equal(
    await page.locator("#mutagenesis-codon-coverage tbody tr").count(),
    2,
  );
  assert.ok((await page.locator("#mutagenesis-pool option").count()) > 1);
  assert.match(
    await page.locator("#mutagenesis-codon-coverage").textContent(),
    /2 · K/,
  );
  checks++;
  await page.locator("#mutagenesis-pool").selectOption("1");
  assert.equal(
    await page.locator('[data-mutagenesis="create"]').isVisible(),
    true,
  );
  download = page.waitForEvent("download");
  await action("fasta");
  const fasta = await fs.readFile(await (await download).path(), "utf8");
  assert.ok(fasta.includes(">mutagenesis_pool_2_forward"));
  checks++;
  await page.locator("#mutagenesis-edits").fill("2: D,E,W");
  await action("preview");
  await page.locator("#mutagenesis-strategy-choice").waitFor();
  assert.match(
    await page.locator("#mutagenesis-strategy-choice").textContent(),
    /Added:/,
  );
  await action("choose-expanded");
  assert.equal(await page.locator("#mutagenesis-pool option").count(), 1);
  assert.match(
    await page.locator("#mutagenesis-codon-coverage").textContent(),
    /Added:/,
  );
  assert.match(await page.locator("#mutagenesis-result").textContent(), /stop/);
  checks++;
  await page.locator("#mutagenesis-edits").fill("2: A\n2: G");
  assert.equal(await page.locator('[data-mutagenesis="create"]').count(), 0);
  await action("preview");
  assert.match(
    await page.locator("#mutagenesis-error").textContent(),
    /overlap/,
  );
  checks++;
  await page.locator("#mutagenesis-mode").selectOption("codon");
  await preview("2: NNK");
  assert.match(
    await page.locator("#mutagenesis-result").textContent(),
    /32 represented DNA variants/,
  );
  assert.match(
    await page.locator("#mutagenesis-result").textContent(),
    /stop codons/,
  );
  checks++;
  // Saving is an ordinary primer-library operation and retains a usable design.
  await action("save");
  const saved = await save();
  assert.equal(saved.primers.length, 2);
  assert.ok(saved.primers[0].tailSequence);
  checks++;
  await page
    .locator('[data-wf-action="primer-mode"][data-mode="list"]')
    .click();
  assert.match(
    await page.locator("#primer-library").textContent(),
    /Mutagenesis template_mut_1_F/,
  );
  await page
    .locator('[data-wf-action="primer-mode"][data-mode="design"]')
    .click();
  assert.ok(await page.locator("#mutagenesis-pool").isVisible());
  checks++;
  // Both indel types are available inside Primer Design, with reverse CDS coordinates.
  await page.locator("#mutagenesis-mode").selectOption("amino");
  await page.locator("#mutagenesis-operation").selectOption("insert");
  await preview("2: GS");
  assert.match(
    await page.locator("#mutagenesis-result").textContent(),
    /600 → 606 bp/,
  );
  await action("create");
  const insertion = await save();
  assert.equal(insertion.sequence.length, 606);
  checks++;
  await page
    .locator("[data-document]")
    .filter({ hasText: "mutagenesis.pcraft" })
    .first()
    .click();
  await open();
  await page.locator("#mutagenesis-mode").selectOption("amino");
  await page.locator("#mutagenesis-operation").selectOption("delete");
  await preview("2-3");
  assert.match(
    await page.locator("#mutagenesis-result").textContent(),
    /600 → 594 bp/,
  );
  await action("create");
  assert.equal((await save()).sequence.length, 594);
  checks++;
  await page
    .locator("[data-document]")
    .filter({ hasText: "mutagenesis.pcraft" })
    .first()
    .click();
  await open();
  await page.locator("#mutagenesis-operation").selectOption("insert");
  await preview("100: GGATCC");
  await page.setViewportSize({ width: 800, height: 650 });
  assert.equal(
    await page
      .locator("#mutagenesis-workspace")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
  );
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path:
        process.env.PLASMIDCRAFT_SCREENSHOTS + "/mutagenic-primer-design.png",
    });
  }
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} mutagenic primer UI checks passed: menu, base edits, reverse CDS options, exact pools, exports, mutant copies, source preservation, invalidation and explicit degeneracy.`,
  );
} finally {
  await browser.close();
}
