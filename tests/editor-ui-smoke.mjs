// Interaction checks for the compact desktop editor. Requires the browser preview.
import assert from "node:assert/strict";
import { chromium, testOutput } from "./ui-browser.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let checks = 0;
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  const map = await page.locator(".map-canvas").boundingBox();
  const views = await page.locator("#view-tabs").boundingBox();
  assert.ok(map.height > 400, "map uses the available desktop height");
  assert.ok(
    views.y > map.y + map.height,
    "view tabs sit below the document canvas",
  );
  checks++;
  const fileMenu = page.getByRole("button", { name: "File", exact: true });
  await fileMenu.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page
      .getByRole("menuitem", { name: "Open…", exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page
      .getByRole("menuitem", { name: "New from Pasted DNA…" })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(await fileMenu.getAttribute("aria-expanded"), "false");
  assert.equal(
    await fileMenu.evaluate((element) => element === document.activeElement),
    true,
  );
  checks++;
  await page.locator("#toggle-files").click();
  assert.equal(await page.locator("#file-sidebar").isVisible(), true);
  assert.equal(await page.locator("#documents .doc-link").count(), 1);
  await page.locator("#paste-sequence").click();
  await page.locator("#paste-input").waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Hide open documents panel" }).click();
  assert.equal(await page.locator("#file-sidebar").isHidden(), true);
  assert.equal(
    await page.locator("#toggle-files").getAttribute("aria-expanded"),
    "false",
  );
  checks++;
  const inspector = page.getByRole("button", {
    name: "Toggle selection inspector",
  });
  await inspector.click();
  assert.equal(await page.locator("#inspector").isHidden(), true);
  await inspector.click();
  assert.equal(await page.locator("#inspector").isVisible(), true);
  checks++;
  await page
    .getByRole("button", { name: "Show features", exact: true })
    .click();
  assert.equal(await page.locator(".map-canvas [data-feature]").count(), 0);
  assert.equal(await page.locator("#feature-count").textContent(), "6");
  await page.getByRole("button", { name: "View", exact: true }).click();
  const showFeatures = page.getByRole("menuitemcheckbox", {
    name: "Show Features",
    exact: true,
  });
  assert.equal(await showFeatures.getAttribute("aria-checked"), "false");
  await showFeatures.click();
  assert.equal(
    await page.locator(".map-canvas .feature-arc[data-feature]").count(),
    6,
  );
  checks++;
  await page
    .getByRole("button", { name: "Show unique restriction sites", exact: true })
    .click();
  assert.doesNotMatch(
    await page.locator("#plasmid-map").textContent(),
    /EcoRI/,
  );
  await page
    .getByRole("button", { name: "Show unique restriction sites", exact: true })
    .click();
  assert.match(await page.locator("#plasmid-map").textContent(), /EcoRI/);
  checks++;
  await page.getByRole("button", { name: "Linear map", exact: true }).click();
  assert.match(
    await page.locator("#plasmid-map").getAttribute("aria-label"),
    /Linear/,
  );
  assert.equal(
    await page.locator('[data-layout="linear"]').getAttribute("class"),
    "active",
  );
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Circular Map", exact: true })
    .click();
  assert.match(
    await page.locator("#plasmid-map").getAttribute("aria-label"),
    /Circular/,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Circular map", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  checks++;
  await page.locator('#view-tabs [data-view="sequence"]').click();
  await page.locator(".sequence-card").waitFor();
  assert.equal(await page.locator("[data-position]").count(), 4826);
  const promoterTracks = page.locator(
    '.sequence-annotation[data-feature="feature-0"]',
  );
  assert.equal(await promoterTracks.count(), 4);
  const firstTrack = await promoterTracks.first().boundingBox();
  const firstBase = await page.locator('[data-position="210"]').boundingBox();
  const lastTrack = await promoterTracks.last().boundingBox();
  const lastBase = await page.locator('[data-position="389"]').boundingBox();
  assert.ok(
    Math.abs(firstTrack.x - firstBase.x) < 1,
    "feature starts at its first base column",
  );
  assert.ok(
    Math.abs(lastTrack.x + lastTrack.width - lastBase.x - lastBase.width) < 1,
    "feature ends at its inclusive final base column",
  );
  await promoterTracks.first().click();
  assert.match(
    await page.locator("#selection-status").textContent(),
    /180 bp selected/,
  );
  checks++;
  await page
    .getByRole("button", { name: "Show features", exact: true })
    .click();
  assert.equal(
    await page.locator(".sequence-annotation[data-feature]").count(),
    0,
  );
  assert.ok(
    (await page.locator(".sequence-primer-track[data-primer]").count()) > 0,
  );
  await page
    .getByRole("button", { name: "Show features", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show primer binding sites", exact: true })
    .click();
  assert.equal(
    await page.locator(".sequence-primer-track[data-primer]").count(),
    0,
  );
  assert.ok(
    (await page.locator(".sequence-annotation[data-feature]").count()) > 0,
  );
  await page
    .getByRole("button", { name: "Show primer binding sites", exact: true })
    .click();
  checks++;
  await page
    .getByRole("button", { name: "Show sequence complement", exact: true })
    .click();
  assert.equal(await page.locator(".complement-track").count(), 0);
  await page
    .getByRole("button", { name: "Show sequence complement", exact: true })
    .click();
  assert.equal(await page.locator(".complement-track").count(), 81);
  checks++;
  await page.locator('[aria-controls="app-edit-menu"]').click();
  await page
    .getByRole("menuitem", { name: "Add Feature…", exact: true })
    .click();
  await page.locator("#annotation-name").fill("Feature from menu");
  await page
    .getByRole("button", { name: "Add annotation", exact: true })
    .last()
    .click();
  assert.equal(await page.locator("#feature-count").textContent(), "7");
  await page.locator('[aria-controls="app-edit-menu"]').first().click();
  await page
    .getByRole("menuitem", { name: "Undo Last Change", exact: true })
    .click();
  assert.equal(await page.locator("#feature-count").textContent(), "6");
  checks++;
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Six-frame Translation…" }).click();
  assert.equal(await page.locator(".translation-block").count(), 6);
  checks++;
  await page.locator('#view-tabs [data-view="features"]').click();
  assert.equal(await page.locator(".data-table tbody tr").count(), 6);
  await page.locator('#view-tabs [data-view="primers"]').click();
  assert.equal(await page.locator(".data-table tbody tr").count(), 2);
  checks++;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#view-tabs [data-view="map"]').click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "View", exact: true }).click();
  const popup = await page.locator("#app-view-menu").boundingBox();
  assert.ok(
    popup.x >= 0 && popup.x + popup.width <= 390,
    "menus remain inside a narrow viewport",
  );
  await page.keyboard.press("Escape");
  await inspector.click();
  assert.equal(await page.locator("#inspector").isVisible(), true);
  await inspector.click();
  assert.equal(await page.locator("#inspector").isHidden(), true);
  await page.screenshot({
    path: testOutput("plasmidcraft-compact-mobile.png"),
    fullPage: true,
  });
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `${checks} desktop editor interaction checks passed, including keyboard menus, display controls, panels, and phone layout.`,
  );
} finally {
  await browser.close();
}
