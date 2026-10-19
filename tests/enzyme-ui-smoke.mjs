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
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  assert.equal(await page.locator("#map-selected-enzymes").isChecked(), false);
  assert.ok((await page.locator(".enzyme-map-label").count()) <= 10);
  await page.locator("#tools-button").click();
  await page.locator('[data-view="enzymes"]').click();
  assert.equal(await page.locator("[data-digest]").count(), 407);
  checks++;
  await page.locator("#enzyme-class").selectOption("common");
  assert.deepEqual(
    await page
      .locator("[data-digest]")
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.digest)),
    [
      "EcoRI",
      "BamHI",
      "HindIII",
      "XhoI",
      "XbaI",
      "SpeI",
      "NheI",
      "PstI",
      "SalI",
      "KpnI",
      "SacI",
      "NotI",
      "EcoRV",
      "SmaI",
      "SphI",
      "NcoI",
      "NdeI",
      "BglII",
      "MluI",
      "BsaI",
      "BsmBI",
      "BbsI",
      "SapI",
    ],
  );
  assert.equal(await page.locator("[data-map-enzyme]:checked").count(), 0);
  assert.equal(await page.locator("[data-digest]:checked").count(), 0);
  assert.equal(await page.locator('[data-digest="AclI"]').count(), 0);
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path:
        process.env.PLASMIDCRAFT_SCREENSHOTS + "/common-enzyme-selection.png",
      fullPage: true,
    });
  }
  checks++;
  await page.locator('[data-map-enzyme="EcoRI"]').check();
  await page.locator("#enzyme-vendor").selectOption("NEB");
  await page.locator("#enzyme-filter").fill("EcoRI-HF");
  assert.equal(await page.locator("[data-digest]").count(), 1);
  assert.equal(
    await page.locator('[data-map-enzyme="EcoRI"]').isChecked(),
    true,
  );
  await page.locator("#enzyme-filter").fill("");
  await page.locator("#enzyme-class").selectOption("");
  checks++;
  await page.locator("#enzyme-vendor").selectOption("Thermo Fisher");
  assert.equal(await page.locator('[data-digest="AclI"]').count(), 0);
  assert.equal(await page.locator('[data-digest="Eco31I"]').count(), 1);
  checks++;
  await page.locator("#enzyme-filter").fill("FastDigest Eco31I");
  assert.equal(await page.locator("[data-digest]").count(), 1);
  checks++;
  await page.locator("#enzyme-filter").fill("");
  await page.locator("#enzyme-vendor").selectOption("");
  await page.locator("#enzyme-filter").fill("BsaI-HFv2");
  assert.equal(await page.locator('[data-digest="BsaI"]').count(), 1);
  checks++;
  await page.locator("#enzyme-filter").fill("");
  await page.locator("#enzyme-class").selectOption("golden");
  assert.equal(await page.locator("[data-digest]").count(), 18);
  assert.equal(await page.locator('[data-digest="PaqCI"]').count(), 1);
  await page.locator('[data-digest="PaqCI"]').check();
  assert.match(await page.locator(".digest-card").textContent(), /PaqCI/);
  checks++;
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/enzyme-catalog.png",
      fullPage: true,
    });
  }
  await page.locator("#enzyme-class").selectOption("special");
  assert.equal(await page.locator('[data-digest="DpnI"]').isDisabled(), true);
  assert.equal(
    await page.locator('[data-digest="Nt.Bpu10I"]').isDisabled(),
    true,
  );
  assert.equal(await page.locator('[data-digest="PspFI"]').isDisabled(), true);
  checks++;
  assert.equal(await page.getByText("NEW TOOL", { exact: true }).count(), 0);
  checks++;
  await page.locator("#file-input").setInputFiles({
    name: "Selected enzymes.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(
      serializeProject({
        name: "Selected enzymes",
        sequence:
          "AC".repeat(30) +
          "GAATTC" +
          "AC".repeat(40) +
          "GAATTC" +
          "AC".repeat(30),
        topology: "circular",
        features: [],
        primers: [],
      }),
    ),
  });
  await page.locator("#tools-button").click();
  await page.locator('[data-view="enzymes"]').click();
  await page.locator("#enzyme-class").selectOption("common");
  await page.locator('[data-action="map-clear-enzymes"]').click();
  await page.locator('[data-map-enzyme="EcoRI"]').check();
  await page.locator("#unique-only").check();
  assert.equal(await page.locator('[data-digest="EcoRI"]').count(), 0);
  await page.locator("#unique-only").uncheck();
  assert.equal(
    await page.locator('[data-map-enzyme="EcoRI"]').isChecked(),
    true,
  );
  await page.locator('#view-tabs [data-view="map"]').click();
  await page.locator("#map-selected-enzymes").check();
  assert.equal(await page.locator(".enzyme-map-label").count(), 2);
  assert.equal(
    await page.locator('.enzyme-map-label[data-enzyme="EcoRI"]').count(),
    2,
  );
  assert.match(
    await page.locator(".map-enzyme-notice").textContent(),
    /2 selected cut sites/,
  );
  checks++;
  await page.locator('[data-layout="linear"]').click();
  assert.equal(
    await page.locator('.enzyme-map-label[data-enzyme="EcoRI"]').count(),
    2,
  );
  checks++;
  await page.locator('[data-layout="circular"]').click();
  await page.locator("#map-tight").check();
  assert.equal(
    await page.locator('[data-layer="showEnzymes"]').isChecked(),
    false,
  );
  assert.equal(
    await page.locator(".enzyme-map-label,.compact-enzyme-tick").count(),
    0,
  );
  checks++;
  await page.locator('[data-layer="showEnzymes"]').check();
  assert.equal(
    await page.locator('.compact-enzyme-tick[data-enzyme="EcoRI"]').count(),
    2,
  );
  checks++;
  await page.locator("#tools-button").click();
  await page.locator('[data-view="enzymes"]').click();
  await page.locator('[data-map-enzyme="EcoRI"]').uncheck();
  await page.locator('[data-map-enzyme="BamHI"]').check();
  await page.locator('#view-tabs [data-view="map"]').click();
  assert.equal(await page.locator(".compact-enzyme-tick").count(), 0);
  assert.match(
    await page.locator(".map-enzyme-notice").textContent(),
    /No selected cut sites/,
  );
  checks++;
  await page.locator("#tools-button").click();
  await page.locator('[data-view="enzymes"]').click();
  await page.locator('[data-action="map-common-enzymes"]').click();
  assert.equal(await page.locator("[data-map-enzyme]:checked").count(), 23);
  assert.equal(await page.locator("[data-digest]:checked").count(), 0);
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await page.screenshot({
      path:
        process.env.PLASMIDCRAFT_SCREENSHOTS + "/common-enzyme-selected.png",
      fullPage: true,
    });
  }
  checks++;
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator("#enzyme-vendor").isVisible(), true);
  assert.deepEqual(errors, []);
  checks++;
  console.log(`${checks} enzyme catalog UI checks passed.`);
} finally {
  await browser.close();
}
