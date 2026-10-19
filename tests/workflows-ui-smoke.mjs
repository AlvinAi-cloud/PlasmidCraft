import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseProject, serializeProject } from "../viewer/project.mjs";
import { parseLibrary } from "../viewer/library.mjs";
import { reverseComplement } from "../viewer/core.mjs";
import { fixturePage, chromium, testOutput } from "./ui-browser.mjs";
const rec = (name, sequence, topology = "linear") => ({
  name,
  description: "Synthetic workflow UI fixture",
  sequence,
  topology,
  features: [],
  primers: [],
  warnings: [],
  comments: [],
});
const f = "ACGTCAGTACGATCGTACGA",
  r = "TCGATACCGTGAACGTTGCA",
  middle = "GGGCCCAAATTTGAGCTAGCATCGTA",
  amplicon = f + middle + reverseComplement(r),
  template = rec("Workflow template", "CCCC" + amplicon + "GGGG");
template.primers = [
  {
    id: "original-f",
    name: "Existing forward",
    sequence: "GGATCC" + f,
    annealingSequence: f,
    tailSequence: "GGATCC",
    sites: [{ strand: 1, segments: [{ start: 4, end: 4 + f.length }] }],
  },
  {
    id: "original-r",
    name: "Existing reverse",
    sequence: "GGTCTC" + r,
    annealingSequence: r,
    tailSequence: "GGTCTC",
    sites: [
      {
        strand: -1,
        segments: [
          { start: 4 + f.length + middle.length, end: 4 + amplicon.length },
        ],
      },
    ],
  },
];
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
page.on("pageerror", (error) => errors.push(error.message));
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
  async function command(action) {
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .locator(`.app-menu-popup:not([hidden]) [data-command="${action}"]`)
      .click();
  }
  async function click(action, scope = page) {
    await scope.locator(`[data-wf-action="${action}"]`).click();
  }
  async function analyze(action) {
    await click(action);
    await page.locator("#wf-progress").waitFor({ state: "hidden" });
    assert.equal((await page.locator("#wf-error").textContent()).trim(), "");
  }
  async function saved() {
    const promise = page.waitForEvent("download");
    await page.locator("#save-project-button").click();
    return parseProject(
      await fs.readFile(await (await promise).path(), "utf8"),
    );
  }
  async function download(action) {
    const promise = page.waitForEvent("download");
    await click(action);
    return fs.readFile(await (await promise).path(), "utf8");
  }
  async function activate(id) {
    await page.locator(`#document-tabs [data-document="${id}"]`).click();
  }
  const templateId = await load(template);
  await command("feature-libraries");
  await page
    .locator("#library-select")
    .selectOption({ label: "My feature library (0)" });
  await page.locator("#lib-entry-name").fill("My insert motif");
  await page.locator("#lib-entry-sequence").fill(middle.slice(0, 12));
  await page.locator("#lib-entry-type").fill("promoter");
  await click("library-add");
  assert.equal(await page.locator("#library-entries tbody tr").count(), 1);
  const exportedLibrary = parseLibrary(await download("library-export"));
  assert.equal(exportedLibrary.features[0].sequence, middle.slice(0, 12));
  checks++;
  await analyze("library-match");
  assert.equal(await page.locator("#library-matches tbody tr").count(), 1);
  assert.equal(await page.locator("#dirty-indicator").isHidden(), true);
  await click("library-apply");
  let stored = await saved();
  assert.equal(stored.features.length, 1);
  assert.equal(stored.primers[0].tailSequence, "GGATCC");
  checks++;
  await page.locator("#undo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "0");
  await page.locator("#redo-button").click();
  assert.equal(await page.locator("#feature-count").textContent(), "1");
  checks++;
  await page.reload();
  await page.locator("#plasmid-map").waitFor();
  await load(stored);
  await command("feature-libraries");
  assert.equal(await page.locator("#library-entries tbody tr").count(), 1);
  await analyze("library-match");
  assert.equal(await page.locator("[data-library-match]:disabled").count(), 1);
  checks++;
  const sourceId = await page
    .locator("#document-tabs .active")
    .getAttribute("data-document");
  await page.locator("#library-file-input").setInputFiles({
    name: "Imported motifs.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'Name,Feature,Type,Color\n"CSV marker",GGGCCCAAATTT,misc_feature,#123456\n',
    ),
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#library-select")
      .selectedOptions[0].textContent.includes("Imported motifs"),
  );
  assert.match(
    await page.locator("#library-entries").textContent(),
    /CSV marker/,
  );
  checks++;
  await command("design-primers");
  await page.locator("#design-start").fill("5");
  await page.locator("#design-end").fill(String(4 + amplicon.length));
  await page.locator("#design-min").fill("18");
  await page.locator("#design-max").fill("21");
  await page.locator("#design-forward-tail").fill("TTAA");
  await page.locator("#design-reverse-tail").fill("CCGG");
  await page.locator("#design-prefix").fill("Designed");
  await analyze("design-preview");
  assert.match(
    await page.locator("#wf-result").textContent(),
    /Forward primer/,
  );
  await click("design-save");
  stored = await saved();
  assert.equal(stored.primers.length, 4);
  assert.equal(stored.primers[2].tailSequence, "TTAA");
  checks++;
  await analyze("pcr-preview");
  assert.equal(await page.locator("#pcr-products tbody tr").count(), 1);
  await page.locator("#pcr-name").fill("Workflow PCR");
  assert.equal(
    await page.locator('[data-wf-action="pcr-create"]').isDisabled(),
    true,
  );
  await analyze("pcr-preview");
  await click("pcr-create");
  await page.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent === "Workflow PCR",
  );
  const pcr = await saved();
  assert.equal(pcr.sequence, "TTAA" + amplicon + reverseComplement("CCGG"));
  assert.equal(pcr.dnaEnds.left.kind, "blunt");
  assert.equal(pcr.dnaEnds.left.phosphorylated, false);
  checks++;
  await activate(sourceId);
  await command("simulate-pcr");
  await page.locator("#pcr-forward").selectOption("original-f");
  await page.locator("#pcr-reverse").selectOption("original-r");
  await page.locator("#pcr-name").fill("Workflow tailed PCR");
  await analyze("pcr-preview");
  await click("pcr-create");
  await page.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent ===
      "Workflow tailed PCR",
  );
  assert.equal(
    (await saved()).sequence,
    "GGATCC" + amplicon + reverseComplement("GGTCTC"),
  );
  checks++;
  await page.locator('.commandbar [data-command="edit-dna"]').click();
  await page.locator("#dna-edit-mode").selectOption("replace");
  await page.locator("#dna-start").fill("30");
  await page.locator("#dna-end").fill("30");
  await page.locator("#dna-insert").fill("N");
  await page
    .getByRole("button", { name: "Preview changes", exact: true })
    .click();
  await page.locator("#apply-sequence-tool").click();
  assert.equal((await saved()).dnaEnds, undefined);
  await page.locator("#undo-button").click();
  assert.equal((await saved()).dnaEnds.left.kind, "blunt");
  checks++;
  const readSequence = reverseComplement(template.sequence.slice(5, 55));
  const mutated =
    readSequence.slice(0, 12) +
    (readSequence[12] === "A" ? "C" : "A") +
    readSequence.slice(13);
  const read = rec("Reverse Sanger read", mutated);
  read.trace = {
    channels: Object.fromEntries(
      [..."ACGT"].map((base) => [
        base,
        Array.from({ length: mutated.length * 10 + 10 }, (_, i) => {
          const index = Math.floor(i / 10),
            distance = Math.abs((i % 10) - 5);
          return mutated[index] === base ? Math.max(0, 100 - distance * 25) : 0;
        }),
      ]),
    ),
    peaks: Array.from({ length: mutated.length }, (_, i) => i * 10 + 5),
    qualities: Array(mutated.length).fill(35),
  };
  const readId = await load(read);
  await activate(sourceId);
  await command("align-reads");
  await page.locator(`[data-alignment-read="${readId}"]`).check();
  await page.locator("#align-trim").uncheck();
  await analyze("alignment-run");
  assert.match(
    await page.locator("#alignment-read-results").textContent(),
    /Reverse/,
  );
  assert.equal(
    await page.locator("#alignment-differences tbody tr").count(),
    1,
  );
  checks++;
  const aligned = await saved();
  assert.equal(aligned.alignments.length, 1);
  assert.equal(aligned.alignments[0].results[0].alignment.strand, -1);
  assert.equal(aligned.alignments[0].results[0].trace.qualities[12], 35);
  checks++;
  await page
    .locator('[data-wf-action="alignment-trace"][data-original-index="12"]')
    .click();
  assert.equal(await page.locator("#document-name").textContent(), read.name);
  assert.match(await page.locator("#selection-status").textContent(), /13–13/);
  assert.equal(await page.locator(".trace-card svg").count(), 1);
  checks++;
  const reopenedId = await load({
    ...aligned,
    editHistory: undefined,
    name: "Reopened reference",
  });
  await command("align-reads");
  assert.equal(
    await page.locator("#alignment-differences tbody tr").count(),
    1,
  );
  await page
    .locator('[data-wf-action="alignment-trace"][data-original-index="12"]')
    .click();
  assert.match(await page.locator("#selection-status").textContent(), /13–13/);
  checks++;
  await activate(reopenedId);
  await command("align-reads");
  const exportedReport = JSON.parse(await download("alignment-export"));
  assert.equal(exportedReport.results[0].alignment.columns.length, 50);
  checks++;
  await page.locator('.commandbar [data-command="edit-dna"]').click();
  await page.locator("#dna-edit-mode").selectOption("replace");
  await page.locator("#dna-start").fill("1");
  await page.locator("#dna-end").fill("1");
  await page.locator("#dna-insert").fill("A");
  await page
    .getByRole("button", { name: "Preview changes", exact: true })
    .click();
  await page.locator("#apply-sequence-tool").click();
  await command("align-reads");
  assert.match(
    await page.locator("#wf-result").textContent(),
    /earlier reference/,
  );
  await page.locator("#undo-button").click();
  checks++;
  const ovA = "ACGTCAGTACGATCGA",
    ovB = "TGGCATACCTAGGCTA",
    coreA = "AAAAAACCCCCGGGGTTTT",
    coreB = "CAGAGAGATCTCTCTCAC";
  const aId = await load(rec("Overlap A", coreA + ovA)),
    bId = await load(rec("Overlap B", ovA + coreB));
  await command("assembly-workbench");
  await page.locator("#asm-source").selectOption(aId);
  await analyze("assembly-prepare");
  await click(
    "assembly-add",
    page.locator("#assembly-prepared tbody tr").nth(0),
  );
  await page.locator("#asm-source").selectOption(bId);
  await analyze("assembly-prepare");
  await click(
    "assembly-add",
    page.locator("#assembly-prepared tbody tr").nth(1),
  );
  await page.locator("#asm-circular").uncheck();
  await page.locator("#asm-min-overlap").fill("16");
  await page.locator("#asm-max-overlap").fill("16");
  await page.locator("#asm-name").fill("Workflow overlap product");
  await analyze("assembly-preview");
  assert.match(
    await page.locator("#wf-result").textContent(),
    /16 bp exact overlap/,
  );
  await click("assembly-create");
  assert.equal((await saved()).sequence, coreA + ovA + coreB);
  checks++;
  const ggSource = (name, left, payload, right) =>
    rec(name, "GGTCTCA" + left + payload + right + "T" + "GAGACC");
  const gaId = await load(ggSource("Golden A", "AATG", coreA, "CAGT")),
    gbId = await load(ggSource("Golden B", "CAGT", coreB, "AATG"));
  await command("assembly-workbench");
  await page.locator("#asm-method").selectOption("golden-fragments");
  await page.locator("#asm-circular").check();
  await page.locator("#asm-source").selectOption(gaId);
  await analyze("assembly-prepare");
  await click(
    "assembly-add",
    page.locator("#assembly-prepared tbody tr").nth(0),
  );
  await page.locator("#asm-source").selectOption(gbId);
  await analyze("assembly-prepare");
  await click(
    "assembly-add",
    page.locator("#assembly-prepared tbody tr").nth(1),
  );
  await analyze("assembly-auto");
  await page.locator("#asm-name").fill("Workflow Golden Gate");
  await analyze("assembly-preview");
  await click("assembly-create");
  const gg = await saved();
  assert.equal(gg.sequence, "AATG" + coreA + "CAGT" + coreB);
  assert.equal(gg.topology, "circular");
  checks++;
  await command("assembly-workbench");
  await page.locator("#asm-method").selectOption("ligation");
  await page.locator("#asm-source").selectOption(gaId);
  await page.locator("#asm-enzyme1").selectOption("BsaI");
  await analyze("assembly-prepare");
  assert.equal(await page.locator("#assembly-prepared tbody tr").count(), 3);
  checks++;
  await page.setViewportSize({ width: 390, height: 800 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks++;
  await activate(sourceId);
  await page.locator('#view-tabs [data-view="primers"]').click();
  await page
    .locator('[data-wf-action="primer-mode"][data-mode="list"]')
    .click();
  await page.locator("#primer-name").fill("Stale preview test");
  await page.locator("#primer-annealing").fill(f);
  await page.route("**/workflow-worker.mjs", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await click("primer-preview");
  await page.locator("#primer-tail").fill("AA");
  await page.locator("#wf-progress").waitFor({ state: "hidden" });
  assert.match(
    await page.locator("#wf-error").textContent(),
    /settings changed/,
  );
  assert.equal(
    await page.locator('[data-wf-action="primer-save"]').isDisabled(),
    true,
  );
  await page.unroute("**/workflow-worker.mjs");
  checks++;
  const storagePage = await fixturePage(browser, {
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  await storagePage.goto(
    process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317",
  );
  await storagePage.locator("#plasmid-map").waitFor();
  await storagePage.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "plasmidcraft.feature-libraries.v1")
        throw new DOMException("Synthetic quota failure", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await storagePage.getByRole("button", { name: "Tools", exact: true }).click();
  await storagePage
    .locator('.app-menu-popup:not([hidden]) [data-command="feature-libraries"]')
    .click();
  await storagePage
    .locator("#library-select")
    .selectOption({ label: "My feature library (0)" });
  await storagePage.locator("#lib-entry-name").fill("Unsaved library marker");
  await storagePage.locator("#lib-entry-sequence").fill("ACGTCAGTACGA");
  await storagePage.locator('[data-wf-action="library-add"]').click();
  assert.match(
    await storagePage.locator(".wf-pane .notice:not([hidden])").textContent(),
    /could not be saved locally/,
  );
  assert.equal(
    await storagePage.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      dispatchEvent(event);
      return event.defaultPrevented;
    }),
    true,
  );
  const backupPromise = storagePage.waitForEvent("download");
  await storagePage.locator('[data-wf-action="library-export"]').click();
  assert.equal(
    parseLibrary(await fs.readFile(await (await backupPromise).path(), "utf8"))
      .features[0].name,
    "Unsaved library marker",
  );
  await storagePage.close({ runBeforeUnload: false });
  checks++;
  const beforeExamples = Number(await page.locator("#doc-count").textContent());
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page
    .locator('.app-menu-popup:not([hidden]) [data-command="workflow-examples"]')
    .click();
  assert.equal(
    await page.locator("#document-name").textContent(),
    "Tutorial template",
  );
  assert.equal(
    Number(await page.locator("#doc-count").textContent()),
    beforeExamples + 6,
  );
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page
    .locator('.app-menu-popup:not([hidden]) [data-command="workflow-examples"]')
    .click();
  assert.equal(
    Number(await page.locator("#doc-count").textContent()),
    beforeExamples + 6,
  );
  checks++;
  for (const action of [
    "feature-libraries",
    "design-primers",
    "align-reads",
    "assembly-workbench",
  ]) {
    await command(action);
    await page.setViewportSize({ width: 390, height: 800 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `${action} fits a phone-width viewport`,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  checks++;
  await command("align-reads");
  await page.locator("#alignment-file-input").setInputFiles({
    name: "saved-alignment.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exportedReport)),
  });
  await page.waitForFunction(
    (name) => document.querySelector("#document-name").textContent === name,
    `${exportedReport.referenceName}_recorded_reference`,
  );
  assert.equal((await saved()).alignments[0].results[0].alignment.strand, -1);
  checks++;
  await command("align-reads");
  await click("alignment-remove");
  assert.equal((await saved()).alignments.length, 0);
  await page.locator("#undo-button").click();
  assert.equal((await saved()).alignments.length, 1);
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} full-workflow browser checks passed: persistent feature libraries, preview/undo, primer design/tails, PCR, saved reverse-read alignment/trace evidence, exact-overlap and Golden Gate assembly.`,
  );
} finally {
  await browser.close();
}
