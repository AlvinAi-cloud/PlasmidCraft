import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium, testOutput } from "./ui-browser.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
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
const editor = page.locator("#sequence-editor");
async function go(start, end = start) {
  await page.locator("#go-to").click();
  await page.locator("#range-start").fill(String(start));
  await page.locator("#range-end").fill(String(end));
  await page
    .getByRole("button", { name: "Show sequence", exact: true })
    .click();
}
async function visible(position) {
  await page.waitForFunction((position) => {
    const el = document.querySelector(`[data-position="${position}"]`),
      view = document.querySelector("#sequence-editor");
    if (!el || !view) return false;
    const r = el.getBoundingClientRect(),
      v = view.getBoundingClientRect();
    return r.top >= v.top && r.bottom <= v.bottom;
  }, position);
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator('#view-tabs [data-view="sequence"]').click();
  assert.equal(
    await page
      .locator('[data-action="page-next"],[data-action="page-prev"]')
      .count(),
    0,
  );
  assert.equal(await page.locator("[data-position]").count(), 4826);
  assert.equal(
    await editor.evaluate((el) => el.scrollHeight > el.clientHeight),
    true,
  );
  checks++;
  await editor.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await visible(4825);
  assert.equal(await page.locator('[data-position="0"]').count(), 1);
  checks++;
  await go(600, 605);
  await visible(599);
  assert.equal(await page.locator("[data-position].selected").count(), 6);
  await page.locator("#direct-base-edit").check();
  await editor.focus();
  await page.keyboard.type("N");
  const download = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  const small = parseProject(
    await fs.readFile(await (await download).path(), "utf8"),
  );
  assert.equal(small.sequence[599], "N");
  assert.equal(small.sequence.length, 4827);
  checks++;
  const record = {
    name: "Long sequence",
    description: "Synthetic scrolling regression",
    topology: "linear",
    sequence: "ACGT".repeat(25000),
    features: [
      {
        id: "long-cds",
        name: "Far coding feature",
        type: "CDS",
        strand: 1,
        segments: [{ start: 90000, end: 90120 }],
        qualifiers: { codon_start: ["1"], transl_table: ["11"] },
        color: "#79a995",
      },
    ],
    primers: [],
    warnings: [],
    comments: [],
  };
  await page.locator("#file-input").setInputFiles({
    name: "long.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(record)),
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent === "Long sequence",
  );
  await page.locator('#view-tabs [data-view="sequence"]').click();
  assert.equal(await editor.getAttribute("data-virtual"), "true");
  assert.ok((await page.locator("[data-position]").count()) < 10000);
  await editor.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await visible(99999);
  assert.ok((await page.locator("[data-position]").count()) < 10000);
  checks++;
  await go(90001, 90060);
  await visible(90000);
  assert.equal(await page.locator("[data-position].selected").count(), 60);
  await page.locator("#inline-proteins").check();
  await go(90001, 90060);
  await visible(90000);
  assert.ok((await page.locator(".protein-residue").count()) > 0);
  // Each rendered row must fit its allocated space, including annotation/protein tracks.
  assert.equal(
    await page
      .locator(".sequence-window .sequence-row")
      .evaluateAll((rows) =>
        rows.every((row) => row.scrollHeight <= row.clientHeight + 1),
      ),
    true,
  );
  checks++;
  await page.locator("#direct-base-edit").check();
  await editor.focus();
  await page.keyboard.press("End");
  await visible(99999);
  await page.keyboard.type("N");
  await visible(100000);
  const finalDownload = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  const long = parseProject(
    await fs.readFile(await (await finalDownload).path(), "utf8"),
  );
  assert.equal(long.sequence.length, 100001);
  assert.ok(long.sequence.endsWith("N"));
  checks++;
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await go(89941, 90060);
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/sequence-scroll.png",
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    `${checks} continuous Sequence checks passed: full scroll, no pages, cross-boundary edits, 100 kb virtualization, far coordinates, protein tracks and end insertion.`,
  );
} finally {
  await browser.close();
}
