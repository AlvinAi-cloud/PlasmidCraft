import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "./ui-browser.mjs";
import { serializeProject } from "../viewer/project.mjs";
import { reverseComplement } from "../viewer/core.mjs";

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const bases = Array(300).fill("C");
const put = (start, text) => bases.splice(start, text.length, ...text);
const features = [];
function cds(id, start, dna, { strand = 1, qualifiers = {} } = {}) {
  put(start, strand === -1 ? reverseComplement(dna) : dna);
  features.push({
    id,
    name: id,
    type: "CDS",
    strand,
    segments: [{ start, end: start + dna.length }],
    qualifiers,
    color: "#79a995",
  });
}
cds("Forward CDS", 0, "ATGAAATAA");
cds("Reverse CDS", 30, "ATGGGTTAA", { strand: -1 });
cds("Phase CDS", 60, "AATGTTTTAA", { qualifiers: { codon_start: ["2"] } });
cds("Code 2 CDS", 90, "ATATGATAA", { qualifiers: { transl_table: ["2"] } });
put(120, "ATGA");
put(140, "AATAA");
features.push({
  id: "Joined CDS",
  name: "Joined CDS",
  type: "CDS",
  strand: 1,
  segments: [
    { start: 120, end: 124 },
    { start: 140, end: 145 },
  ],
  qualifiers: {},
  color: "#79a995",
});
cds("Exception CDS", 180, "ATGAAATAA", {
  qualifiers: { transl_except: ["(pos:4..6,aa:Sec)"] },
});
const record = {
  name: "CDS translation notation",
  sequence: bases.join(""),
  topology: "linear",
  features,
  primers: [],
  warnings: [],
  comments: [],
};
const residues = (name) =>
  page
    .getByLabel(`Inline CDS ${name}`, { exact: true })
    .locator(".protein-residue");
let checks = 0;
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page
    .locator("#file-input")
    .setInputFiles({
      name: "cds.pcraft",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(record)),
    });
  await page.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent ===
      "CDS translation notation",
  );
  await page.locator('#view-tabs [data-view="sequence"]').click();
  assert.equal(await page.locator("#inline-proteins").isChecked(), true);
  assert.deepEqual(await residues("Forward CDS").allTextContents(), [
    "M",
    "K",
    "*",
  ]);
  assert.deepEqual(await residues("Reverse CDS").allTextContents(), [
    "M",
    "G",
    "*",
  ]);
  assert.match(
    await page
      .getByLabel("Inline CDS Reverse CDS", { exact: true })
      .textContent(),
    /←/,
  );
  checks++;
  assert.deepEqual(await residues("Phase CDS").allTextContents(), [
    "M",
    "F",
    "*",
  ]);
  assert.deepEqual(await residues("Code 2 CDS").allTextContents(), [
    "M",
    "W",
    "*",
  ]);
  assert.deepEqual(await residues("Joined CDS").allTextContents(), [
    "M",
    "K",
    "*",
  ]);
  assert.equal(
    await page.getByLabel("Inline CDS Exception CDS", { exact: true }).count(),
    0,
  );
  assert.match(
    await page.locator("#sequence-inline-warnings").textContent(),
    /Exception CDS/,
  );
  checks++;
  await page.locator("#protein-letter-format").selectOption("three");
  assert.deepEqual(await residues("Forward CDS").allTextContents(), [
    "Met",
    "Lys",
    "Ter",
  ]);
  assert.deepEqual(await residues("Reverse CDS").allTextContents(), [
    "Met",
    "Gly",
    "Ter",
  ]);
  assert.deepEqual(await residues("Phase CDS").allTextContents(), [
    "Met",
    "Phe",
    "Ter",
  ]);
  assert.deepEqual(await residues("Code 2 CDS").allTextContents(), [
    "Met",
    "Trp",
    "Ter",
  ]);
  assert.match(
    await residues("Joined CDS").nth(1).getAttribute("title"),
    /codon bases 124, 141, 142/,
  );
  assert.equal(
    await residues("Forward CDS").first().getAttribute("data-amino-acid"),
    "M",
  );
  checks++;
  await page.locator("#inline-proteins").uncheck();
  assert.equal(await page.locator(".protein-residue").count(), 0);
  assert.equal(await page.locator("#protein-letter-format").isDisabled(), true);
  await page.locator("#inline-proteins").check();
  assert.deepEqual(await residues("Forward CDS").allTextContents(), [
    "Met",
    "Lys",
    "Ter",
  ]);
  checks++;
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/cds-three-letter.png",
    });
  }
  await page.locator("#protein-letter-format").selectOption("one");
  assert.deepEqual(await residues("Joined CDS").allTextContents(), [
    "M",
    "K",
    "*",
  ]);
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} CDS translation checks passed: default proteins, reverse strand, phase, genetic code, joined codon, notation switching and visibility.`,
  );
} finally {
  await browser.close();
}
