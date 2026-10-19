import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { serializeProject, parseProject } from "../viewer/project.mjs";
import { reverseComplement } from "../viewer/core.mjs";
import { workflowDemoRecords } from "../viewer/workflow-demo.mjs";
import { alignmentReport } from "../viewer/alignment.mjs";
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
let seed = 729;
const dna = (n) =>
  Array.from({ length: n }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return "ACGT"[seed >>> 30];
  }).join("");
const rec = (name, sequence, topology = "circular") => ({
  name,
  sequence,
  topology,
  features: [],
  primers: [],
  comments: [],
  warnings: [],
});
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  async function screenshot(name, selector) {
    if (!process.env.PLASMIDCRAFT_SCREENSHOTS) return;
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.locator("#toast").waitFor({ state: "hidden" });
    if (selector) await page.locator(selector).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${process.env.PLASMIDCRAFT_SCREENSHOTS}/${name}.png`,
    });
  }
  async function load(r) {
    await page.locator("#file-input").setInputFiles({
      name: r.name + ".pcraft",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(r)),
    });
    await page.waitForFunction(
      (name) => document.querySelector("#document-name").textContent === name,
      r.name,
    );
    return page.locator("#document-tabs .active").getAttribute("data-document");
  }
  async function activate(id) {
    await page.locator(`#document-tabs [data-document="${id}"]`).click();
  }
  async function command(c) {
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .locator(`.app-menu-popup:not([hidden]) [data-command="${c}"]`)
      .click();
  }
  async function click(c) {
    await page.locator(`[data-wf-action="${c}"]`).click();
  }
  async function run(c) {
    await click(c);
    await page.locator("#wf-progress").waitFor({ state: "hidden" });
    assert.equal((await page.locator("#wf-error").textContent()).trim(), "");
  }
  async function download(selector) {
    const p = page.waitForEvent("download");
    await page.locator(selector).click();
    return fs.readFile(await (await p).path(), "utf8");
  }
  async function save() {
    return parseProject(await download("#save-project-button"));
  }
  const sequence = dna(720),
    reference = rec("Circular reference", sequence),
    query = rec(
      "Reversed shifted query",
      reverseComplement(sequence.slice(143) + sequence.slice(0, 143)),
    );
  await load(query);
  const rid = await load(reference);
  await command("compare-plasmids");
  await page
    .locator("#whole-query")
    .selectOption({ label: "Reversed shifted query (720 bp)" });
  await run("whole-auto");
  assert.match(await page.locator("#whole-result").textContent(), /100.00%/);
  assert.match(
    await page.locator("#whole-result").textContent(),
    /Reverse complement/,
  );
  checks++;
  await screenshot("whole-plasmid-alignment", "#whole-result");
  const aligned = await save();
  assert.equal(aligned.comparisons[0].result.strand, -1);
  assert.equal(aligned.comparisons[0].result.matches, 720);
  checks++;
  await page.locator("#whole-advanced > summary").click();
  await click("whole-flip");
  assert.equal(await page.locator("#whole-strand").inputValue(), "1");
  await click("whole-settings");
  await run("whole-manual");
  assert.equal((await save()).comparisons[0].result.matches, 720);
  checks++;
  const report = JSON.parse(await download('[data-wf-action="whole-export"]'));
  assert.equal(report.query.sequence, query.sequence);
  await click("whole-copy");
  assert.equal((await save()).sequence, sequence);
  checks++;
  await activate(rid);
  await command("compare-plasmids");
  await page.setViewportSize({ width: 800, height: 900 });
  assert.ok(await page.locator("#whole-result").isVisible());
  await page.screenshot({
    path: testOutput("plasmidcraft-whole-alignment.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks++;
  const edit = rec("Editable coding DNA", "ATGAAAGGGTAA" + dna(80), "linear");
  edit.features = [
    {
      id: "cds",
      name: "Example protein",
      type: "CDS",
      strand: 1,
      segments: [{ start: 0, end: 12 }],
      color: "#79a995",
      qualifiers: { codon_start: ["1"], transl_table: ["11"] },
    },
  ];
  await load(edit);
  await page.locator('[data-view="sequence"]').click();
  await page.locator("#inline-proteins").check();
  assert.ok((await page.locator(".protein-residue").count()) > 0);
  checks++;
  await screenshot("inline-protein-tracks", "#sequence-editor");
  await page.locator("#direct-base-edit").check();
  await page.locator("#sequence-editor").focus();
  await page.keyboard.type("AC");
  let edited = await save();
  assert.equal(edited.sequence, "AC" + edit.sequence);
  assert.equal(edited.editHistory.nodes.length, 3);
  checks++;
  await page.locator("#sequence-editor").focus();
  await page.keyboard.press("Backspace");
  assert.equal((await save()).sequence, "A" + edit.sequence);
  checks++;
  await page.locator('[data-view="history"]').click();
  await page
    .locator('[data-action="history-restore"][data-history-id="0"]')
    .click();
  assert.equal((await save()).sequence, edit.sequence);
  checks++;
  await page.locator('[data-view="sequence"]').click();
  await page.locator("#sequence-editor").focus();
  await page.keyboard.type("G");
  edited = await save();
  assert.equal(edited.sequence, "G" + edit.sequence);
  assert.ok(edited.editHistory.nodes.filter((n) => n.parent === 0).length >= 2);
  checks++;
  await page.locator('[data-view="features"]').click();
  await page.locator('[data-action="bulk-select-visible"]').click();
  await page.locator('[data-action="bulk-open"]').click();
  await page.locator("#bulk-key").fill("note");
  await page.locator("#bulk-value").fill("Reviewed together");
  await page.locator('[data-action="bulk-preview"]').click();
  await page.locator("#bulk-apply").click();
  assert.deepEqual((await save()).features[0].qualifiers.note, [
    "Reviewed together",
  ]);
  checks++;
  const ref = rec("Consensus reference", dna(220), "linear");
  let q = ref.sequence.split("");
  q[100] = q[100] === "A" ? "C" : "A";
  const traceRead = (name, seq) => ({
    ...rec(name, seq, "linear"),
    trace: {
      channels: { A: [], C: [], G: [], T: [] },
      peaks: [],
      qualities: Array(seq.length).fill(35),
    },
  });
  ref.alignments = [
    alignmentReport(ref, [
      traceRead("Read A", q.join("")),
      traceRead("Read B", q.join("")),
    ]),
  ];
  await load(ref);
  await command("read-consensus");
  await run("readasm-run");
  assert.match(
    await page.locator("#consensus-differences").textContent(),
    /101/,
  );
  await screenshot("sanger-consensus", "#consensus-differences");
  await click("readasm-create");
  assert.equal((await save()).sequence, q.join(""));
  checks++;
  const chain = dna(200);
  const ids = [];
  ids.push(await load(rec("Chain one", chain.slice(0, 100), "linear")));
  ids.push(
    await load(
      rec("Chain two", reverseComplement(chain.slice(60, 160)), "linear"),
    ),
  );
  ids.push(await load(rec("Chain three", chain.slice(120), "linear")));
  await activate(rid);
  await command("read-consensus");
  await page.locator("#readasm-mode").selectOption("denovo");
  await page.locator("#readasm-trim").uncheck();
  for (const id of ids) await page.locator(`[data-readasm-id="${id}"]`).check();
  await run("readasm-run");
  assert.equal(await page.locator("#read-contigs tbody tr").count(), 1);
  await click("readasm-create");
  assert.ok(
    [chain, reverseComplement(chain)].includes((await save()).sequence),
  );
  checks++;
  const parts = [
    rec("Prepared backbone", dna(180), "linear"),
    rec("New insert", dna(120), "linear"),
  ];
  const sourceIds = [];
  for (const p of parts) sourceIds.push(await load(p));
  await command("design-gibson");
  await page.locator("#clone-source").selectOption(sourceIds[0]);
  await page.locator("#clone-preparation").selectOption("ready");
  await click("cloning-add");
  await page.locator("#clone-source").selectOption(sourceIds[1]);
  await page.locator("#clone-preparation").selectOption("pcr");
  await page.locator("#clone-start").fill("1");
  await page.locator("#clone-end").fill("120");
  await click("cloning-add");
  await page
    .getByText("Junction optimization and existing fragments", { exact: true })
    .click();
  await page.locator("#clone-optimize").check();
  await run("cloning-preview");
  assert.equal(await page.locator("#cloning-primers tbody tr").count(), 2);
  checks++;
  await page.locator('[data-wf-action="cloning-edit-primer"]').first().click();
  const annealing = await page.locator("#clone-primer-annealing").inputValue();
  await page.locator("#clone-primer-annealing").fill(annealing.slice(0, -1));
  await run("cloning-primer-apply");
  assert.equal(await page.locator("#cloning-primers tbody tr").count(), 2);
  checks++;
  await screenshot("prepared-backbone-design", "#cloning-junctions");
  const draft = await download('[data-wf-action="cloning-draft-save"]');
  assert.equal(JSON.parse(draft).parts[0].preparation, "ready");
  await click("cloning-clear");
  await page.locator("#cloning-draft-file").setInputFiles({
    name: "unfinished.pcdesign",
    mimeType: "application/json",
    buffer: Buffer.from(draft),
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#cloning-parts .wf-order-row").length === 2,
  );
  await run("cloning-preview");
  const plan = JSON.parse(await download('[data-wf-action="cloning-json"]'));
  assert.equal(plan.record.sequence, parts.map((p) => p.sequence).join(""));
  assert.equal(plan.reactions.filter((r) => r.pcr).length, 1);
  checks++;
  await command("design-golden");
  await click("cloning-clear");
  const modules = workflowDemoRecords().slice(4, 6),
    moduleIds = [];
  for (const p of modules) moduleIds.push(await load(p));
  await command("design-golden");
  for (const id of moduleIds) {
    await page.locator("#clone-source").selectOption(id);
    await page.locator("#clone-preparation").selectOption("module");
    await click("cloning-add");
  }
  await run("cloning-preview");
  assert.equal(await page.locator("#cloning-primers tbody tr").count(), 0);
  const modulePlan = JSON.parse(
    await download('[data-wf-action="cloning-json"]'),
  );
  assert.equal(modulePlan.record.sequence.length, 248);
  checks++;
  const dom = rec("Internal coding site", "ATGGGTCTCTAA", "linear");
  dom.features = [
    {
      id: "cds",
      name: "MGL protein",
      type: "CDS",
      strand: 1,
      segments: [{ start: 0, end: 12 }],
      color: "#79a995",
      qualifiers: { transl_table: ["11"] },
    },
  ];
  const domid = await load(dom);
  await command("design-golden");
  await page.locator("#clone-source").selectOption(domid);
  await page
    .getByText(
      "Preview internal-site domestication on the selected source template",
      { exact: true },
    )
    .click();
  await run("cloning-dom-preview");
  assert.ok(
    (await page.locator("#domestication-candidates tbody tr").count()) > 0,
  );
  await page.locator('[data-wf-action="cloning-dom-create"]').first().click();
  assert.notEqual((await save()).sequence, dom.sequence);
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} advanced browser checks passed: whole circular alignment, strand/origin controls, evidence export, oriented copies, direct editing, history branches, bulk annotations, proteins, consensus and de novo assembly.`,
  );
} finally {
  await browser.close();
}
