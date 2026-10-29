import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium } from "./ui-browser.mjs";
import { serializeProject } from "../viewer/project.mjs";
import { reverseComplement } from "../viewer/core.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await fixturePage(browser, {
  viewport: { width: 1440, height: 1050 },
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const coding = "ATG" + "GCTGGTTACGAAGGCAAG".repeat(3) + "TAA";
const sequence = coding + reverseComplement(coding) + "ACGT".repeat(60);
const arm = sequence.slice(12, 36),
  changed = arm.slice(0, 6) + (arm[6] === "A" ? "C" : "A") + arm.slice(7);
const rec = {
  name: "Sequence track preview",
  sequence,
  topology: "circular",
  features: [
    {
      id: "f",
      name: "Reporter CDS",
      type: "CDS",
      strand: 1,
      segments: [{ start: 0, end: 60 }],
      color: "#58a783",
      qualifiers: {},
    },
    {
      id: "r",
      name: "Reverse CDS",
      type: "CDS",
      strand: -1,
      segments: [{ start: 60, end: 120 }],
      color: "#9c86bb",
      qualifiers: {},
    },
  ],
  primers: [
    {
      id: "pf",
      name: "Reporter forward + substitution",
      sequence: "GGATCC" + changed,
      annealingSequence: changed,
      tailSequence: "GGATCC",
      sites: [{ strand: 1, segments: [{ start: 12, end: 36 }] }],
    },
    {
      id: "pr",
      name: "Reverse primer + 5′ tail",
      sequence: "GGTCTC" + reverseComplement(sequence.slice(24, 48)),
      annealingSequence: reverseComplement(sequence.slice(24, 48)),
      tailSequence: "GGTCTC",
      sites: [{ strand: -1, segments: [{ start: 24, end: 48 }] }],
    },
  ],
  comments: [],
  warnings: [],
};
let checks = 0;
async function screenshot(name) {
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/" + name + ".png",
    });
  }
}
async function aligned() {
  const positions = await page
    .locator(".sequence-primer-track [data-primer-position]")
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const base = document.querySelector(
          `[data-position="${n.dataset.primerPosition}"]`,
        );
        return Math.abs(
          n.getBoundingClientRect().x - base.getBoundingClientRect().x,
        );
      }),
    );
  assert.ok(
    positions.every((x) => x < 1),
    "every primer letter aligns with its DNA column",
  );
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#file-input").setInputFiles({
    name: "tracks.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(rec)),
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent ===
      "Sequence track preview",
  );
  await page.locator('#view-tabs [data-view="sequence"]').click();
  assert.equal(await page.locator(".primer-aligned-base.mismatch").count(), 1);
  assert.equal(await page.locator(".primer-tail-duplex").count(), 2);
  await aligned();
  checks++;
  const reference = await page
    .locator(".reference-track")
    .first()
    .boundingBox();
  const f = await page.locator('[data-primer="pf"]').first().boundingBox();
  const r = await page.locator('[data-primer="pr"]').first().boundingBox();
  assert.ok(f.y + f.height <= reference.y + 1);
  assert.ok(r.y >= reference.y + reference.height);
  checks++;
  const reverseLetters = await page
    .locator('[data-primer="pr"] .primer-aligned-base')
    .evaluateAll((nodes) =>
      nodes
        .sort((a, b) => +a.dataset.primerPosition - +b.dataset.primerPosition)
        .map((n) => n.textContent)
        .join(""),
    );
  assert.equal(
    reverseLetters,
    [...rec.primers[1].annealingSequence].reverse().join(""),
  );
  checks++;
  await page.locator("#protein-letter-format").selectOption("three");
  assert.equal(
    await page.locator(".protein-residue").first().textContent(),
    "Met",
  );
  await page.locator("#sequence-group").selectOption("3");
  await aligned();
  checks++;
  for (const name of ["Reporter CDS", "Reverse CDS"]) {
    const tracks = page.locator(`[aria-label="Inline CDS ${name}"]`);
    const numbers = await tracks
      .locator("[data-residue-number]")
      .evaluateAll((nodes) => nodes.map((n) => +n.dataset.residueNumber));
    assert.deepEqual(
      numbers.sort((a, b) => a - b),
      [1, 6, 11, 16],
    );
    const alignedNumbers = await tracks.evaluateAll((nodes) =>
      nodes.flatMap((track) =>
        [...track.querySelectorAll("[data-residue-number]")].map((number) => {
          const letter = track.querySelector(
            `[data-residue="${number.dataset.residueNumber}"]`,
          );
          const a = number.getBoundingClientRect(),
            b = letter.getBoundingClientRect();
          return (
            Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 1 &&
            a.y >= b.bottom
          );
        }),
      ),
    );
    assert.ok(
      alignedNumbers.every(Boolean),
      "CDS numbers align below their amino acids on both strands",
    );
  }
  const proteinAlignment = await page
    .locator(".sequence-protein-track .protein-residue")
    .evaluateAll((nodes) =>
      nodes.map((letter) => {
        const middle = letter.dataset.codonBases.split(",")[1];
        const base = document.querySelector(`[data-position="${middle}"]`);
        const a = letter.getBoundingClientRect(),
          b = base.getBoundingClientRect();
        return {
          residue: letter.dataset.residue,
          delta: Math.abs(a.x + a.width / 2 - b.x - b.width / 2),
        };
      }),
    );
  assert.ok(
    proteinAlignment.every((p) => p.delta < 1),
    JSON.stringify(proteinAlignment),
  );
  checks++;
  await screenshot("sequence-primers-codons");
  await page.locator("#sequence-frames").selectOption("six");
  assert.equal(
    await page.locator('[data-sequence-row="0"] [data-frame]').count(),
    6,
  );
  const forward = await page
    .locator('[data-sequence-row="0"] [data-frame="1"] .protein-residue')
    .first();
  assert.equal(await forward.textContent(), "Met");
  assert.ok((await page.locator('[data-frame="-1"]').count()) > 0);
  checks++;
  assert.equal(
    await page
      .locator(".sequence-row")
      .evaluateAll((rows) =>
        rows.every((row) => row.scrollHeight <= row.clientHeight + 1),
      ),
    true,
  );
  checks++;
  await page.locator("#sequence-frame-code").selectOption("2");
  assert.match(
    await page.locator('[data-frame="1"]').first().textContent(),
    /NCBI 2/,
  );
  await screenshot("sequence-six-frames");
  checks++;
  await page.locator("#inline-proteins").uncheck();
  assert.equal(await page.locator(".sequence-protein-track").count(), 0);
  assert.ok((await page.locator(".sequence-frame-track").count()) > 0);
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} aligned sequence UI checks passed: primer direction, tails, mismatches, base alignment, codon grouping, three-letter residues, six frames and genetic code controls.`,
  );
} finally {
  await browser.close();
}
