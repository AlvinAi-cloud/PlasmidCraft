import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { workflowDemoRecords } from "../viewer/workflow-demo.mjs";
import { parseProject, serializeProject } from "../viewer/project.mjs";
import { chromium, testOutput } from "./ui-browser.mjs";
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
let checks = 0;
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  async function load(record) {
    await page.locator("#file-input").setInputFiles({
      name: `${record.name}.pcraft`,
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(record)),
    });
    await page.waitForFunction(
      (name) => document.querySelector("#document-name").textContent === name,
      record.name,
    );
    return page.locator("#document-tabs .active").getAttribute("data-document");
  }
  async function command(name) {
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .locator(`.app-menu-popup:not([hidden]) [data-command="${name}"]`)
      .click();
  }
  async function click(name) {
    await page.locator(`[data-wf-action="${name}"]`).click();
  }
  async function analyze() {
    await click("cloning-preview");
    await page.locator("#wf-progress").waitFor({ state: "hidden" });
    assert.equal((await page.locator("#wf-error").textContent()).trim(), "");
  }
  async function download(action) {
    const promise = page.waitForEvent("download");
    await click(action);
    return fs.readFile(await (await promise).path(), "utf8");
  }
  async function save() {
    const promise = page.waitForEvent("download");
    await page.locator("#save-project-button").click();
    return parseProject(
      await fs.readFile(await (await promise).path(), "utf8"),
    );
  }
  async function activate(id) {
    await page.locator(`#document-tabs [data-document="${id}"]`).click();
  }
  async function add(source, start, end) {
    await page.locator("#clone-source").selectOption(source);
    await page.locator("#clone-start").fill(String(start));
    await page.locator("#clone-end").fill(String(end));
    await click("cloning-add");
  }
  const examples = workflowDemoRecords(),
    a = examples[4],
    b = examples[5];
  const aId = await load(a),
    bId = await load(b),
    expected = a.sequence.slice(11, 161) + b.sequence.slice(11, 101);
  await command("design-gibson");
  await page.locator("#clone-name").fill("Designed Gibson plasmid");
  await add(aId, 12, 161);
  await add(bId, 12, 101);
  await analyze();
  assert.equal(await page.locator("#cloning-primers tbody tr").count(), 4);
  assert.equal(await page.locator("#cloning-junctions tbody tr").count(), 2);
  let gibson = JSON.parse(await download("cloning-json"));
  assert.equal(gibson.method, "gibson");
  assert.equal(gibson.record.sequence, expected);
  checks++;
  assert.equal((await save()).primers.length, 0);
  checks++;
  const csv = await download("cloning-csv");
  assert.equal(csv.trim().split("\r\n").length, 5);
  assert.ok(csv.includes(gibson.reactions[0].primers[0].sequence));
  checks++;
  await page.locator("#clone-overlap").fill("31");
  assert.equal(await page.locator("#cloning-primers").count(), 0);
  assert.equal(
    await page.locator('[data-wf-action="cloning-create"]').count(),
    0,
  );
  await analyze();
  gibson = JSON.parse(await download("cloning-json"));
  assert.equal(gibson.junctions[0].length, 31);
  checks++;
  await click("cloning-save-primers");
  assert.equal((await save()).primers.length, 2);
  await page.locator("#undo-button").click();
  assert.equal((await save()).primers.length, 0);
  assert.equal(
    await page.locator('[data-wf-action="cloning-create"]').isDisabled(),
    true,
  );
  assert.match(
    await page.locator("#wf-result").textContent(),
    /source document changed/i,
  );
  checks++;
  await analyze();
  await click("cloning-save-primers");
  assert.equal((await save()).primers.length, 2);
  await activate(aId);
  assert.equal((await save()).primers.length, 2);
  await command("design-gibson");
  checks++;
  const before = await page.locator("#document-tabs [data-document]").count();
  await click("cloning-create");
  assert.equal(
    await page.locator("#document-tabs [data-document]").count(),
    before + 3,
  );
  await page
    .locator("#document-tabs [data-document]")
    .filter({ hasText: "Designed Gibson plasmid.pcraft" })
    .first()
    .click();
  const constructed = await save();
  assert.equal(constructed.sequence, expected);
  assert.ok(constructed.comments.some((c) => c.includes("cloning design")));
  checks++;
  const firstPcr = gibson.reactions[0].pcr.name;
  await page
    .locator("#document-tabs [data-document]")
    .filter({ hasText: `${firstPcr}.pcraft` })
    .first()
    .click();
  assert.equal((await save()).sequence, gibson.reactions[0].pcr.sequence);
  checks++;
  await command("design-golden");
  await page.locator("#clone-name").fill("Designed Golden Gate plasmid");
  await analyze();
  const golden = JSON.parse(await download("cloning-json"));
  assert.equal(golden.method, "golden");
  assert.equal(golden.record.sequence, expected);
  assert.equal(golden.reactions[0].digest.sequence, a.sequence.slice(11, 161));
  assert.ok(
    golden.reactions[0].primers[0].tailSequence.startsWith("GCGCGCGGTCTC"),
  );
  checks++;
  // Reordering updates the intended product instead of silently reusing a plan.
  await page.locator('[data-wf-action="cloning-up"][data-index="1"]').click();
  assert.equal(await page.locator("#cloning-primers").count(), 0);
  await analyze();
  assert.equal(
    JSON.parse(await download("cloning-json")).record.sequence,
    b.sequence.slice(11, 101) + a.sequence.slice(11, 161),
  );
  checks++;
  await page.locator('[data-wf-action="cloning-up"][data-index="1"]').click();
  await analyze();
  await page.setViewportSize({ width: 390, height: 800 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(
    await page.locator('[data-wf-action="cloning-create"]').isVisible(),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks++;
  await page.locator("#clone-enzyme").selectOption("SapI");
  await analyze();
  assert.equal(
    JSON.parse(await download("cloning-json")).junctions[0].length,
    3,
  );
  checks++;
  await page.locator("#clone-enzyme").selectOption("BsaI");
  await analyze();
  if (process.env.PLASMIDCRAFT_DESIGN_SCREENSHOTS) {
    const dir = process.env.PLASMIDCRAFT_DESIGN_SCREENSHOTS;
    await fs.mkdir(dir, { recursive: true });
    await page
      .locator("#wf-result")
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({
      path: `${dir}/02-golden-gate-design.png`,
      fullPage: true,
    });
  }
  await click("cloning-create");
  await page
    .locator("#document-tabs [data-document]")
    .filter({ hasText: "Designed Golden Gate plasmid.pcraft" })
    .first()
    .click();
  assert.equal((await save()).sequence, expected);
  checks++;
  // Whole donor DNA includes internal recognition sites and is not silently accepted.
  await command("design-golden");
  await click("cloning-clear");
  await add(aId, 1, a.sequence.length);
  await add(bId, 1, b.sequence.length);
  await click("cloning-preview");
  await page.locator("#wf-progress").waitFor({ state: "hidden" });
  assert.match(
    await page.locator("#wf-error").textContent(),
    /internal|cut sites|junction|overhang/i,
  );
  assert.equal(await page.locator("#cloning-primers").count(), 0);
  checks++;
  // Source changes during a worker run invalidate the response via form revision.
  await command("design-gibson");
  await click("cloning-clear");
  await add(aId, 12, 161);
  await add(bId, 12, 101);
  await page.locator("#clone-name").fill("In flight");
  await page.evaluate(() => {
    document.querySelector('[data-wf-action="cloning-preview"]').click();
    const input = document.querySelector("#clone-name");
    input.value = "Changed in flight";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#wf-progress").waitFor({ state: "hidden" });
  assert.match(
    await page.locator("#wf-error").textContent(),
    /settings changed/i,
  );
  checks++;
  await analyze();
  if (process.env.PLASMIDCRAFT_DESIGN_SCREENSHOTS) {
    const dir = process.env.PLASMIDCRAFT_DESIGN_SCREENSHOTS;
    await page.locator("#main-panel").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({
      path: `${dir}/01-gibson-design.png`,
      fullPage: true,
    });
  }
  // Closing a template leaves the plan visibly stale, with exports disabled.
  await page.locator(`[data-close-document="${aId}"]`).click();
  assert.equal(
    await page.locator('[data-wf-action="cloning-json"]').isDisabled(),
    true,
  );
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} cloning-design browser checks passed: Gibson/Golden Gate primers, exact products, exports, source-preserving previews, primer undo, stale inputs, narrow layout, and Type IIS validation.`,
  );
} finally {
  await browser.close();
}
