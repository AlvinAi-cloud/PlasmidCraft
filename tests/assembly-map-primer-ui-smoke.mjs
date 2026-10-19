import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium } from "./ui-browser.mjs";
import { serializeProject, parseProject } from "../viewer/project.mjs";
import { reverseComplement } from "../viewer/core.mjs";
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
async function command(id) {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .locator(`.app-menu-popup:not([hidden]) [data-command="${id}"]`)
    .click();
}
async function save() {
  const p = page.waitForEvent("download");
  await page.locator("#save-project-button").click();
  return parseProject(await fs.readFile(await (await p).path(), "utf8"));
}
async function screenshot(name) {
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/" + name + ".png",
    });
  }
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#map-tight").check();
  assert.equal(
    await page.locator(".compact-feature-label textPath").count(),
    6,
  );
  assert.equal(await page.locator(".feature-label").count(), 0);
  const labels = await page
    .locator(".compact-feature-label textPath")
    .allTextContents();
  assert.ok(labels.includes("Regulatory region"));
  checks++;
  await screenshot("tight-plasmid-map");
  await page.locator("#export-button").click();
  const pending = page.waitForEvent("download");
  await page.locator('[data-export="svg"]').click();
  const svg = await fs.readFile(await (await pending).path(), "utf8");
  assert.match(svg, /data-map-style="tight"/);
  assert.equal((svg.match(/<textPath /g) || []).length, 6);
  assert.equal(
    await page.evaluate(
      (svg) =>
        new DOMParser()
          .parseFromString(svg, "image/svg+xml")
          .querySelector("parsererror") === null,
      svg,
    ),
    true,
  );
  checks++;
  // Curved SVG text has an empty center in its rectangular bounds. Click a
  // visible character cell rather than the center of the entire curved label.
  const glyph = await page
    .locator('.compact-feature-label[data-feature="feature-1"]')
    .evaluate((el) => {
      const box = el.getExtentOfChar(0),
        p = el.ownerSVGElement.createSVGPoint();
      p.x = box.x + box.width / 2;
      p.y = box.y + box.height / 2;
      const v = p.matrixTransform(el.getScreenCTM());
      return { x: v.x, y: v.y };
    });
  await page.mouse.click(glyph.x, glyph.y);
  assert.match(await page.locator("#selection-status").textContent(), /750 bp/);
  checks++;
  await page.locator("#ai-assistant-button").click();
  assert.equal(await page.locator("#modal").evaluate((d) => d.open), false);
  assert.equal(await page.locator("#ai-panel").isVisible(), true);
  const box = await page.locator("#ai-panel").boundingBox(),
    inspector = await page.locator("#inspector").boundingBox(),
    editor = await page.locator("#main-panel").boundingBox();
  assert.ok(
    editor.x + editor.width <= inspector.x + 1 &&
      inspector.x + inspector.width <= box.x + 1,
  );
  await page
    .locator('.compact-feature path[data-feature="feature-0"]')
    .first()
    .click();
  assert.match(
    await page.locator("#ai-live-context").textContent(),
    /selected bases 211–390/,
  );
  await page.locator('[data-ai="navigate-design"]').click();
  await page
    .locator("#ai-goal")
    .fill("Review the selected promoter and suggest checks.");
  await screenshot("docked-ai-map");
  checks++;
  await page.locator('#view-tabs [data-view="sequence"]').click();
  await page.locator('[data-position="100"]').click();
  await page.locator('[data-position="119"]').click({ modifiers: ["Shift"] });
  assert.match(
    await page.locator("#ai-live-context").textContent(),
    /selected bases 101–120/,
  );
  assert.equal(
    await page.locator("#ai-goal").inputValue(),
    "Review the selected promoter and suggest checks.",
  );
  checks++;
  await page.locator("#go-to").click();
  await page.locator('#modal [data-action="close-modal"]').first().click();
  assert.equal(await page.locator("#ai-panel").isVisible(), true);
  checks++;
  await page.setViewportSize({ width: 600, height: 900 });
  const smallEditor = await page.locator("#main-panel").boundingBox(),
    smallAi = await page.locator("#ai-panel").boundingBox();
  assert.ok(smallEditor.y + smallEditor.height <= smallAi.y + 1);
  assert.ok(smallEditor.height >= 130);
  checks++;
  await page.locator('[data-ai="close"]').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await command("assembly-workbench");
  await page.locator("#asm-method").selectOption("golden");
  await page
    .getByRole("heading", { name: "Golden Gate cloning design", exact: true })
    .waitFor();
  assert.equal(await page.locator("#clone-enzyme").count(), 1);
  assert.equal(await page.locator("#clone-overlap").count(), 0);
  assert.equal(await page.locator("#asm-source").count(), 0);
  await screenshot("golden-gate-workspace");
  checks++;
  await page.locator("#asm-method").selectOption("gibson");
  await page
    .getByRole("heading", { name: "Gibson / HiFi cloning design", exact: true })
    .waitFor();
  assert.equal(await page.locator("#clone-overlap").count(), 1);
  assert.equal(await page.locator("#clone-enzyme").count(), 0);
  checks++;
  await page.locator("#asm-method").selectOption("ligation");
  assert.equal(await page.locator("#asm-enzyme1").count(), 1);
  await page.locator("#asm-method").selectOption("golden-fragments");
  assert.equal(await page.locator("#asm-typeiis").count(), 1);
  checks++;
  let seed = 7198;
  const sequence = Array.from({ length: 600 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return "ACGT"[seed >>> 30];
  }).join("");
  const f = sequence.slice(40, 80),
    r = reverseComplement(sequence.slice(400, 440));
  const rec = {
    name: "Gapped PCR preview",
    sequence,
    topology: "linear",
    features: [],
    primers: [
      {
        id: "f",
        name: "Forward",
        sequence: f,
        annealingSequence: f,
        tailSequence: "",
        sites: [{ strand: 1, segments: [{ start: 40, end: 80 }] }],
      },
      {
        id: "r",
        name: "Reverse",
        sequence: r,
        annealingSequence: r,
        tailSequence: "",
        sites: [{ strand: -1, segments: [{ start: 400, end: 440 }] }],
      },
    ],
    comments: [],
    warnings: [],
  };
  await page.locator("#file-input").setInputFiles({
    name: "gap.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(rec)),
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent ===
      "Gapped PCR preview",
  );
  await page.locator('#view-tabs [data-view="primers"]').click();
  await page
    .locator('#primer-library [data-wf-action="primer-edit"]')
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Edit Selected Primer", exact: true })
    .waitFor();
  const inserted = f.slice(0, 5) + "TTG" + f.slice(5);
  await page.locator("#selected-primer-sequence").fill(inserted);
  assert.match(
    await page.locator("#selected-primer-preview").textContent(),
    /3 inserted base\(s\)/,
  );
  assert.equal(await page.locator("#selected-primer-save").isEnabled(), true);
  await screenshot("edit-primer-insertion");
  await page.locator("#selected-primer-save").click();
  assert.equal((await save()).primers[0].sequence, inserted);
  checks++;
  await page.locator('#view-tabs [data-view="sequence"]').click();
  assert.equal(await page.locator(".primer-insertion-marker").count(), 1);
  checks++;
  await page.locator('#view-tabs [data-view="primers"]').click();
  await page
    .locator('#primer-library [data-wf-action="primer-edit"]')
    .nth(1)
    .click();
  const deleted = r.slice(0, 4) + r.slice(7);
  await page.locator("#selected-primer-sequence").fill(deleted);
  assert.match(
    await page.locator("#selected-primer-preview").textContent(),
    /3 deleted base\(s\)/,
  );
  await page.locator("#selected-primer-save").click();
  checks++;
  await page.locator('[data-wf-action="primer-mode"][data-mode="pcr"]').click();
  assert.equal(await page.locator("#pcr-binding-mode").inputValue(), "anchor");
  assert.equal(await page.locator("#pcr-anchor").inputValue(), "15");
  await page.locator("#pcr-forward").selectOption("f");
  await page.locator("#pcr-reverse").selectOption("r");
  await page.locator('[data-wf-action="pcr-preview"]').click();
  await page.locator("#pcr-products tbody tr").waitFor();
  assert.equal(await page.locator("#pcr-products tbody tr").count(), 1);
  await screenshot("pcr-anchor-preview");
  checks++;
  await page.locator('[data-wf-action="pcr-create"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector("#document-name").textContent === "PCR product",
  );
  const product = await save();
  assert.equal(
    product.sequence,
    inserted + sequence.slice(80, 400) + reverseComplement(deleted),
  );
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} assembly, tight-map and gapped-primer UI checks passed: direct workflow switching, curved labels, SVG export, editable indels and 3′-anchored PCR products.`,
  );
} finally {
  await browser.close();
}
