// Real renderer with a simulated native BLAST transport; no public search submission.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { serializeProject } from "../viewer/project.mjs";
import { chromium, testOutput } from "./ui-browser.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0;
page.setDefaultTimeout(15000);
page.on("pageerror", (e) => console.error("UI error:", e.message));
try {
  await page.addInitScript(() => {
    const state = (window.__bioMock = { calls: [], fail: false, hold: false });
    window.__TAURI_INTERNALS__ = {};
    window.__TAURI__ = {
      core: {
        invoke: async (command, args) => {
          state.calls.push({ command, args });
          if (command === "blast_submit") {
            if (state.fail)
              throw new Error(
                "Unable to reach NCBI BLAST. Check your internet connection.",
              );
            if (state.hold)
              return new Promise((resolve) => (state.resolve = resolve));
            return { rid: "SYNTHETIC123", estimatedSeconds: 20 };
          }
          if (command === "blast_open_results") return;
        },
      },
      dialog: {
        open: async () => null,
        save: async () => null,
        confirm: async () => false,
      },
      fs: {
        stat: async () => ({ size: 0 }),
        readFile: async () => new Uint8Array(),
        writeFile: async () => {},
      },
      window: {
        getCurrentWindow: () => ({
          setTitle: async () => {},
          onCloseRequested: async () => () => {},
          close: async () => {},
        }),
      },
      event: {
        listen: async (_, handler) => {
          state.menu = (command) => handler({ payload: command });
          return () => {};
        },
      },
      clipboardManager: { writeText: async (text) => (state.clipboard = text) },
    };
  });
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  await page.waitForFunction(() => window.__bioMock.menu);
  const top = await page.locator(".app-menu-trigger").allTextContents();
  assert.deepEqual(
    top.map((x) => x.trim()),
    ["File", "Edit", "View", "Tools", "AI", "Help"],
  );
  checks++;
  const coding = "ATGTGGTATTGTTGTTGTTAA",
    record = {
      name: "Synthetic protein",
      sequence: "AAAAAA" + coding + "CCCCCC",
      topology: "linear",
      features: [
        {
          id: "cds",
          name: "Test CDS",
          type: "CDS",
          strand: 1,
          segments: [{ start: 6, end: 27 }],
          qualifiers: {},
          color: "#518ac2",
        },
      ],
      primers: [],
      warnings: [],
      comments: [],
    };
  await page.locator("#file-input").setInputFiles({
    name: "protein.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(record)),
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent ===
      "Synthetic protein",
  );
  await page
    .locator('#plasmid-map [data-feature="cds"] rect')
    .first()
    .click({ button: "right" });
  await page.locator("#context-protein-analysis").click();
  assert.equal(
    await page.locator("#protein-analysis-sequence").inputValue(),
    "MWYCCC",
  );
  assert.match(
    await page.locator("#protein-analysis-results").textContent(),
    /6.*6,990.*7,115/s,
  );
  checks++;
  await page.locator('[data-bio="copy-analysis"]').click();
  await page.waitForFunction(() =>
    window.__bioMock.clipboard?.includes("Residues: 6"),
  );
  checks++;
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/protein-analysis.png",
    });
  }
  await page.locator('[data-bio="analysis-blast"]').click();
  assert.equal(await page.locator("#blast-query").inputValue(), "MWYCCC");
  assert.equal(
    await page.evaluate(
      () =>
        window.__bioMock.calls.filter((c) => c.command === "blast_submit")
          .length,
    ),
    0,
  );
  checks++;
  await page.locator("#blast-submit").click();
  await page.locator("#blast-jobs code").waitFor();
  const sent = await page.evaluate(
    () =>
      window.__bioMock.calls.find((c) => c.command === "blast_submit").args
        .query,
  );
  assert.deepEqual(sent, {
    sequence: "MWYCCC",
    program: "blastp",
    database: "nr",
    email: "",
  });
  assert.ok(!JSON.stringify(sent).includes("Test CDS"));
  checks++;
  await page.locator('[data-bio="blast-open"]').click();
  assert.equal(
    await page.evaluate(() => window.__bioMock.calls.at(-1).args.rid),
    "SYNTHETIC123",
  );
  checks++;
  await page.context().setOffline(true);
  await page.waitForFunction(
    () =>
      navigator.onLine === false &&
      document.querySelector("#blast-submit").disabled,
  );
  assert.equal(await page.locator("#blast-submit").isDisabled(), true);
  assert.match(
    await page.locator("#blast-network").textContent(),
    /No internet/,
  );
  assert.equal(await page.locator("#blast-query").inputValue(), "MWYCCC");
  checks++;
  await page.context().setOffline(false);
  await page.waitForFunction(() => navigator.onLine);
  await page.evaluate(() => (window.__bioMock.fail = true));
  await page.locator("#blast-submit").click();
  await page.waitForFunction(() =>
    document.querySelector("#blast-error").textContent.includes("internet"),
  );
  assert.equal(await page.locator("#blast-jobs code").count(), 1);
  checks++;
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.evaluate(() => window.__bioMock.menu("blast"));
  assert.equal(await page.locator("#blast-query").inputValue(), coding);
  await page.evaluate(() => {
    window.__bioMock.fail = false;
    window.__bioMock.hold = true;
  });
  await page.locator("#blast-submit").click();
  await page.waitForFunction(() => window.__bioMock.resolve);
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.evaluate(() =>
    window.__bioMock.resolve({ rid: "SYNTHETIC456", estimatedSeconds: 30 }),
  );
  await page.waitForTimeout(30);
  assert.equal(await page.locator("#modal").isVisible(), false);
  await page.evaluate(() => window.__bioMock.menu("blast"));
  assert.match(await page.locator("#blast-jobs").textContent(), /SYNTHETIC456/);
  checks++;
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.evaluate(() => window.__bioMock.menu("paste-protein"));
  await page.locator("#protein-paste-name").fill("Protein document");
  await page.locator("#protein-paste-sequence").fill("MWYCCCMPEPTIDE");
  await page.locator('[data-codon="paste-create"]').click();
  await page.locator("#protein-sequence").evaluate((el) => {
    el.focus();
    el.setSelectionRange(0, 6);
  });
  await page.locator('[data-codon="analyze-protein"]').click();
  assert.equal(
    await page.locator("#protein-analysis-sequence").inputValue(),
    "MWYCCC",
  );
  assert.match(
    await page.locator("#modal-content").textContent(),
    /residues 1–6/,
  );
  checks++;
  await page.locator('#modal [data-action="close-modal"]').first().click();
  await page.evaluate(() => window.__bioMock.menu("protein-documents"));
  await page.locator("#protein-sequence").evaluate((el) => {
    el.focus();
    el.setSelectionRange(6, 14);
  });
  await page.evaluate(() => window.__bioMock.menu("protein-analysis"));
  assert.equal(
    await page.locator("#protein-analysis-sequence").inputValue(),
    "MPEPTIDE",
  );
  checks++;
  await page.locator("#protein-analysis-sequence").evaluate((el) => {
    el.focus();
    el.setSelectionRange(0, 6);
  });
  await page.evaluate(() => window.__bioMock.menu("blast"));
  assert.equal(await page.locator("#blast-query").inputValue(), "MPEPTI");
  if (process.env.PLASMIDCRAFT_SCREENSHOTS)
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/ncbi-blast.png",
    });
  checks++;
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} protein/BLAST/menu UI checks passed: local CDS metrics, protein selection, native routing, explicit upload, offline/network errors, and late request IDs.`,
  );
} finally {
  await browser.close();
}
