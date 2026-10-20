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
  async function help(command) {
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await page.locator(`#app-help-menu [data-command="${command}"]`).click();
  }
  await page.context().setOffline(true);
  await help("help");
  const dialog = page.locator("#help-dialog");
  await dialog.waitFor({ state: "visible" });
  assert.match(
    await page.locator("#help-article").textContent(),
    /pET-21b\(\+\).*5,442/s,
  );
  assert.equal(await page.locator("#help-topics button").count(), 13);
  checks++;
  await page
    .locator('#help-article [data-help-guide="mutagenesis"]')
    .first()
    .click();
  assert.match(
    await page.locator("#help-article h1").textContent(),
    /mutagen/i,
  );
  assert.match(await page.locator("#help-article").textContent(), /deletion/i);
  await page.locator("#help-search").fill("dual-host");
  assert.ok(
    await page.locator('#help-topics [data-help-guide="codons"]').count(),
  );
  await page.locator('#help-topics [data-help-guide="codons"]').click();
  assert.match(await page.locator("#help-article h1").textContent(), /codon/i);
  await page.locator("#help-search").fill("no-such-guide-xyz");
  assert.equal(await page.locator("#help-topics button").count(), 0);
  assert.match(
    await page.locator("#help-search-status").textContent(),
    /0 matching/,
  );
  await page.locator("#help-search").fill("");
  checks++;
  for (const id of [
    "alignment",
    "pcr",
    "cloning",
    "protein",
    "features",
    "ai",
  ]) {
    await page.locator(`#help-topics [data-help-guide="${id}"]`).click();
    assert.ok((await page.locator("#help-article").textContent()).length > 300);
  }
  const searchBounds = await page.locator("#help-search").boundingBox();
  const dialogBounds = await dialog.boundingBox();
  assert.ok(
    searchBounds.y >= dialogBounds.y &&
      searchBounds.y + searchBounds.height <=
        dialogBounds.y + dialogBounds.height,
    "Search stays visible while topics scroll",
  );
  const image = page.locator("#help-article img").first();
  await image.scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#help-article img")].every(
      (i) => i.complete && i.naturalWidth > 0,
    ),
  );
  checks++;
  await page.locator('#help-topics [data-help-guide="features"]').click();
  await page.locator("#help-sections summary").click();
  const importLink = page.locator(
    '#help-sections [data-help-anchor="import-features-from-an-existing-snapgene-installation"]',
  );
  await importLink.click();
  await page.waitForFunction(
    () => document.querySelector("#help-article").scrollTop > 0,
  );
  checks++;
  // Help remains available without replacing or changing an editing draft.
  await page.locator("#help-dialog [data-help-close]").click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator('#app-edit-menu [data-command="edit-dna"]').click();
  await page.locator("#dna-insert").fill("GGT");
  await help("help-guide-mutagenesis");
  assert.equal(await page.locator("#dna-insert").inputValue(), "GGT");
  assert.equal(await page.locator("#modal").evaluate((d) => d.open), true);
  assert.equal(await dialog.getAttribute("aria-modal"), "false");
  await page.locator("#help-dialog .modal-header").focus();
  await page.keyboard.press("ArrowLeft");
  checks++;
  await page.screenshot({ path: testOutput("offline-help-desktop.png") });
  await page.setViewportSize({ width: 760, height: 600 });
  await page.waitForFunction(() => {
    const r = document.querySelector("#help-dialog").getBoundingClientRect();
    return (
      r.top >= 0 &&
      r.bottom <= innerHeight &&
      r.left >= 0 &&
      r.right <= innerWidth
    );
  });
  assert.ok(
    await page.locator("#help-article").evaluate((el) => el.clientHeight > 60),
  );
  await page.locator("#help-dialog [data-help-close]").click();
  assert.equal(await dialog.evaluate((d) => d.open), false);
  assert.equal(await page.locator("#dna-insert").inputValue(), "GGT");
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} offline help UI checks passed: bundled guides/images, search, cross-links/sections, topic menus, independent movable window, draft preservation and compact layout.`,
  );
} finally {
  await browser.close();
}
