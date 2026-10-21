import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, testOutput } from "./ui-browser.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
});
const errors = [],
  external = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (request.url().includes("never-load.invalid"))
    external.push(request.url());
});
let checks = 0;
const frame = () =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
async function load(record) {
  await page.locator("#file-input").setInputFiles({
    name: "scroll.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(record)),
  });
  await page.waitForFunction(
    (name) => document.querySelector("#document-name").textContent === name,
    record.name,
  );
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  const html =
    '<html><body><p>gene: <b>bla</b></p><p>Confers resistance to ampicillin &amp; encodes &beta;-lactamase.<br>Keep this note.</p><script>window.badNote=true</script><img src="https://never-load.invalid/pixel" onerror="window.badNote=true"></body></html>';
  const record = {
    name: "Readable imported notes",
    description: "<html><body><p>Expression vector.</p></body></html>",
    sequence: "ATGGCTGAT".repeat(650),
    topology: "linear",
    features: [
      {
        id: "cds",
        name: "bla",
        type: "CDS",
        strand: 1,
        segments: [{ start: 0, end: 5850 }],
        qualifiers: { note: [html] },
        color: "#79a995",
      },
    ],
    primers: [],
    warnings: [],
    comments: [],
  };
  await load(record);
  assert.equal(
    await page.locator("#inspector > .inspector-note").textContent(),
    "Expression vector.",
  );
  await page.locator('#inspector [data-feature="cds"]').click();
  const note = await page.locator(".annotation-qualifier").textContent();
  assert.match(
    note,
    /gene: bla\nConfers resistance to ampicillin & encodes β-lactamase/,
  );
  assert.doesNotMatch(note, /<html>|<body>|badNote|never-load/);
  assert.equal(await page.evaluate(() => window.badNote), undefined);
  assert.deepEqual(external, []);
  const download = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  const saved = parseProject(
    await fs.readFile(await (await download).path(), "utf8"),
  );
  assert.equal(saved.features[0].qualifiers.note[0], html);
  assert.equal(saved.description, record.description);
  checks++;
  await page.screenshot({ path: testOutput("readable-notes.png") });
  await page.locator('#view-tabs [data-view="sequence"]').click();
  await page.locator("#sequence-frames").selectOption("six");
  await page.locator("#sequence-editor").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await frame();
  assert.equal(await page.locator('[data-position="5849"]').isVisible(), true);
  const size = await page.locator("#sequence-editor").evaluate((el) => ({
    height: el.scrollHeight,
    rows: el.querySelectorAll(".sequence-row").length,
  }));
  await page.locator("#sequence-editor").evaluate((el) => {
    el.scrollTop = 0;
  });
  await frame();
  assert.equal(
    await page.locator("#sequence-editor").evaluate((el) => el.scrollHeight),
    size.height,
    "offscreen rows keep stable scroll geometry",
  );
  checks++;
  const long = {
    ...record,
    name: "Incremental long sequence",
    sequence: "ATGGCTGAT".repeat(12000),
    features: [
      {
        ...record.features[0],
        segments: [{ start: 0, end: 108000 }],
        qualifiers: {},
      },
    ],
  };
  await load(long);
  await page.locator('#view-tabs [data-view="sequence"]').click();
  await frame();
  assert.equal(
    await page.locator("#sequence-editor").getAttribute("data-virtual"),
    "true",
  );
  const retention = await page.evaluate(async () => {
    const editor = document.querySelector("#sequence-editor"),
      frame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
    editor.scrollTop = 3500;
    await frame();
    const old = new Map(
      [...editor.querySelectorAll(".sequence-row")].map((row) => [
        row.dataset.sequenceRow,
        row,
      ]),
    );
    editor.scrollTop += 900;
    await frame();
    const current = [...editor.querySelectorAll(".sequence-row")],
      shared = current.filter((row) => old.has(row.dataset.sequenceRow));
    const result = {
      shared: shared.length,
      allRetained: shared.every(
        (row) => old.get(row.dataset.sequenceRow) === row,
      ),
    };
    editor.scrollTop = 3500;
    await frame();
    result.cached = [...editor.querySelectorAll(".sequence-row")].every(
      (row) => old.get(row.dataset.sequenceRow) === row,
    );
    return result;
  });
  assert.ok(retention.shared > 0);
  assert.equal(retention.allRetained, true);
  assert.equal(retention.cached, true);
  checks++;
  for (const fraction of [0.7, 0.2, 1, 0]) {
    await page.locator("#sequence-editor").evaluate((el, f) => {
      el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
    }, fraction);
    await frame();
    assert.equal(
      await page
        .locator(".sequence-window .sequence-row")
        .evaluateAll((rows) =>
          rows.every(
            (row, i) =>
              !i ||
              Number(row.dataset.sequenceRow) ===
                Number(rows[i - 1].dataset.sequenceRow) + 1,
          ),
        ),
      true,
      "no missing/duplicated rows after jumps",
    );
    assert.ok(
      (await page.locator(".sequence-window .sequence-row").count()) < 80,
    );
    assert.equal(
      await page
        .locator(".sequence-window .sequence-row")
        .evaluateAll((rows) =>
          rows.every((row) => row.scrollHeight <= row.clientHeight + 1),
        ),
      true,
    );
  }
  checks++;
  await page.screenshot({ path: testOutput("sequence-performance.png") });
  assert.deepEqual(errors, []);
  console.log(
    `${checks} sequence performance/note checks passed: inert rich notes and source preservation, stable short-sequence geometry, retained/cached DOM rows and gap-free long-sequence scrolling.`,
  );
} finally {
  await browser.close();
}
