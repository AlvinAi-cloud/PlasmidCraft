import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "./ui-browser.mjs";
import { serializeProject } from "../viewer/project.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));
let checks = 0;
const entry = (id, name, type = "CDS", sequence = "ATGAAATAA") => ({
  id,
  name,
  type,
  sequence,
  directional: true,
  color: "#79a995",
  qualifiers: {},
});
await page.addInitScript(
  (libraries) => {
    localStorage.setItem(
      "plasmidcraft.feature-libraries.v1",
      JSON.stringify({ version: 1, libraries }),
    );
  },
  [
    { id: "first", name: "First library", features: [entry("a", "My gene")] },
    {
      id: "second",
      name: "Second library",
      features: [
        entry("b", "MY GENE", "gene"),
        entry("c", "Other motif", "promoter", "CCCCATG"),
      ],
    },
  ],
);
const rec = {
  name: "Auto annotation test",
  sequence: "CCCCATGAAATAAGGGGATGAAATAACCC",
  topology: "linear",
  features: [
    {
      id: "manual",
      name: "my GENE",
      type: "gene",
      strand: 1,
      segments: [{ start: 4, end: 13 }],
      color: "#79a995",
      qualifiers: { note: ["Keep this note"] },
    },
  ],
  primers: [],
};
async function featureCount(n) {
  await page.locator('#view-tabs [data-view="features"]').click();
  assert.equal(await page.locator(".data-table tbody tr").count(), n);
}
async function preview(scope) {
  await page.locator("#auto-annotation-library").selectOption(scope);
  await page.locator('[data-command="auto-annotation-preview"]').click();
  await page.waitForSelector("#library-matches tbody tr");
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:8765");
  await page.locator("#file-input").setInputFiles({
    name: "auto.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(rec)),
  });
  await featureCount(1);
  await page.locator('#main-panel [data-action="annotate"]').click();
  await page.locator('#modal [data-command="auto-annotation"]').click();
  assert.equal(
    await page.locator("#auto-annotation-library option").count(),
    4,
  );
  checks++;
  await preview("first");
  assert.equal(await page.locator("#library-matches tbody tr").count(), 2);
  assert.equal(await page.locator("[data-library-match]:disabled").count(), 1);
  assert.equal(await page.locator("[data-library-match]:checked").count(), 1);
  checks++;
  await page.locator('[data-wf-action="library-apply"]').click();
  await featureCount(2);
  await page.locator("#undo-button").click();
  await featureCount(1);
  checks++;
  await page.locator('#main-panel [data-command="auto-annotation"]').click();
  await preview("all");
  assert.equal(await page.locator("#library-matches tbody tr").count(), 3);
  assert.match(
    await page.locator("#wf-result").textContent(),
    /2 duplicate identifications merged/,
  );
  assert.equal(await page.locator("[data-library-match]:checked").count(), 2);
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await page.locator("#toast").waitFor({ state: "hidden" });
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.locator("#wf-result").screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/auto-annotation.png",
    });
  }
  checks++;
  await page.locator('[data-wf-action="library-apply"]').click();
  await featureCount(3);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .locator('#app-tools-menu [data-command="auto-annotation"]')
    .click();
  await preview("all");
  assert.equal(await page.locator("[data-library-match]:checked").count(), 0);
  assert.equal(await page.locator("[data-library-match]:disabled").count(), 3);
  checks++;
  await page.locator("#library-file-input").setInputFiles({
    name: "Large.pclib",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "PlasmidCraftFeatureLibrary",
        version: 1,
        name: "Large library",
        features: Array.from({ length: 1334 }, (_, i) =>
          entry(`large-${i}`, `Feature ${i}`),
        ),
      }),
    ),
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#library-entry-count")
      ?.textContent.includes("1334 of 1334"),
  );
  assert.equal(await page.locator("#library-select option").count(), 4);
  checks++;
  await page.locator("#ai-assistant-button").click();
  await page.locator("#ai-task").selectOption({ label: "Design plasmid" });
  assert.match(await page.locator("#ai-goal").inputValue(), /host organism/);
  await page.locator("#ai-task").selectOption({ label: "Other tasks" });
  assert.match(await page.locator("#ai-goal").inputValue(), /another task/);
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} auto-annotation UI checks passed: feature/dialog/menu entry points, library scope, case-insensitive duplicate merging, existing annotations, apply/undo, 1334-entry import and AI starting points.`,
  );
} finally {
  await browser.close();
}
