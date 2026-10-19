import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fixturePage, chromium } from "./ui-browser.mjs";
import { serializeProject } from "../viewer/project.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await fixturePage(browser, {
  viewport: { width: 1440, height: 1000 },
});
const errors = [],
  calls = [];
let modelResult = {
    models: [
      { id: "text-a", name: "Text A" },
      { id: "text-b", name: "Text B" },
    ],
    truncated: false,
  },
  modelError = "",
  delayed = null,
  hold = false,
  checks = 0;
page.on("pageerror", (error) => errors.push(error.message));
await page.exposeBinding("modelMock", async (_, command, args) => {
  calls.push({ command, args });
  if (command === "chatgpt_status") return { accounts: [] };
  if (command === "ai_list_models") {
    if (hold)
      return new Promise((resolve) => {
        delayed = resolve;
      });
    if (modelError) throw new Error(modelError);
    return modelResult;
  }
  if (command === "ai_connect")
    return {
      ...args.connection,
      apiKey: undefined,
      model: args.model,
      remembered: args.remember,
    };
});
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {};
  window.__TAURI__ = {
    core: { invoke: (command, args) => window.modelMock(command, args) },
    dialog: {
      open: async () => null,
      save: async () => null,
      confirm: async () => false,
    },
    fs: {
      stat: async () => ({ size: 0 }),
      readFile: async () => new Uint8Array(),
      writeFile: async () => {},
    },
    window: {
      getCurrentWindow: () => ({
        setTitle: async () => {},
        onCloseRequested: async () => () => {},
        close: async () => {},
      }),
    },
    event: {
      listen: async (_, handler) => {
        window.modelMenu = (action) => handler({ payload: action });
        return () => {};
      },
    },
    clipboardManager: { writeText: async () => {} },
  };
});
async function menu(action) {
  await page.evaluate((action) => window.modelMenu(action), action);
}
async function screenshot(name) {
  if (!process.env.PLASMIDCRAFT_SCREENSHOTS) return;
  await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/" + name + ".png",
  });
}
async function centered(position) {
  await page.waitForFunction((position) => {
    const base = document.querySelector(`[data-position="${position}"]`),
      view = document.querySelector("#sequence-editor");
    if (!base || !view) return false;
    const b = base.getBoundingClientRect(),
      v = view.getBoundingClientRect();
    return (
      Math.abs(
        b.top + b.height / 2 - (v.top + view.clientTop + view.clientHeight / 2),
      ) < 8
    );
  }, position);
}
const feature = (id, start, end) => ({
  id,
  name: id,
  type: "misc_feature",
  strand: 1,
  segments: [{ start, end }],
  color: "#79a995",
  qualifiers: {},
});
async function record(length) {
  const rec = {
    name: `Overview ${length}`,
    sequence: "ACGT".repeat(Math.ceil(length / 4)).slice(0, length),
    topology: "circular",
    features: [
      feature("Middle", Math.floor(length / 2), Math.floor(length / 2) + 150),
      feature(
        "Overlapping",
        Math.floor(length / 2) + 20,
        Math.floor(length / 2) + 100,
      ),
      {
        ...feature("Origin", length - 30, length),
        segments: [
          { start: length - 30, end: length },
          { start: 0, end: 30 },
        ],
      },
    ],
    primers: [],
  };
  await page.locator("#file-input").setInputFiles({
    name: "overview.pcraft",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(rec)),
  });
  await page
    .locator("#document-name")
    .filter({ hasText: `Overview ${length}` })
    .waitFor();
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  await menu("ai-settings");
  assert.equal(
    await page.locator("#ai-model").evaluate((el) => el.tagName),
    "SELECT",
  );
  await page.locator("#ai-key").fill("synthetic-discovery-key");
  await page
    .locator('#ai-model option[value="text-a"]')
    .waitFor({ state: "attached" });
  assert.equal(await page.locator("#ai-model option").count(), 3);
  assert.equal(calls.filter((c) => c.command === "ai_list_models").length, 1);
  assert.equal(
    calls.find((c) => c.command === "ai_list_models").args.connection.apiKey,
    "synthetic-discovery-key",
  );
  assert.equal(
    calls.some((c) => c.command === "ai_request"),
    false,
  );
  checks++;
  await page.locator("#ai-model").selectOption("text-b");
  await page.locator('[data-ai="connect"]').click();
  await page
    .locator("#ai-connection-status")
    .filter({ hasText: "Configured" })
    .waitFor();
  assert.equal(
    calls.find((c) => c.command === "ai_connect").args.model,
    "text-b",
  );
  await page.locator('[data-ai="models-refresh"]').click();
  assert.equal(
    calls.filter((c) => c.command === "ai_list_models").at(-1).args.connection,
    null,
  );
  assert.equal(await page.locator("#ai-model").inputValue(), "text-b");
  await screenshot("api-model-picker");
  checks++;
  await page.locator('[data-ai="disconnect"]').click();
  modelError = "Model-list access denied. Try manual entry.";
  await page.locator("#ai-key").fill("synthetic-other-key");
  await page.locator("#ai-settings-title").click();
  await page
    .locator("#ai-model-status")
    .filter({ hasText: "access denied" })
    .waitFor();
  await page.locator("#ai-model-manual").check();
  await page.locator("#ai-model").fill("custom-model");
  assert.equal(
    await page.locator("#ai-key").inputValue(),
    "synthetic-other-key",
  );
  checks++;
  modelError = "";
  hold = true;
  await page.locator('[data-ai="models-refresh"]').click();
  await page.waitForFunction(() =>
    document
      .querySelector("#ai-model-status")
      .textContent.includes("Loading model"),
  );
  await page.locator("#ai-provider").selectOption("compatible");
  hold = false;
  delayed({
    models: [{ id: "stale-provider-model", name: "Stale" }],
    truncated: false,
  });
  await page.waitForTimeout(100);
  assert.equal(
    await page
      .locator('#ai-model option[value="stale-provider-model"]')
      .count(),
    0,
  );
  modelResult = { models: [], truncated: false };
  await page.locator('[data-ai="models-refresh"]').click();
  await page
    .locator("#ai-model-status")
    .filter({ hasText: "No compatible models" })
    .waitFor();
  checks++;
  await page.locator('[data-ai="settings-close"]').click();
  await record(6000);
  await page.locator('#view-tabs [data-view="sequence"]').click();
  await page
    .locator('.selection-overview .mini-feature[data-feature="Middle"]')
    .waitFor();
  const overview = await page.locator(".selection-overview").boundingBox(),
    editor = await page.locator("#sequence-editor").boundingBox();
  assert.ok(overview.y >= editor.y + editor.height - 1);
  const a = await page
      .locator('.mini-feature[data-feature="Middle"]')
      .boundingBox(),
    b = await page
      .locator('.mini-feature[data-feature="Overlapping"]')
      .boundingBox();
  assert.ok(Math.abs(a.y - b.y) >= 10);
  await page.locator('.mini-feature[data-feature="Middle"]').click();
  await centered(3000);
  assert.equal(
    await page
      .locator('.mini-feature[data-feature="Middle"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page.locator(".reference-track .base.selected").count(),
    150,
  );
  checks++;
  await page.locator("#sequence-editor").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.locator('.annotation-row[data-feature="Middle"]').click();
  await centered(3000);
  await screenshot("sequence-overview-center");
  checks++;
  await page.locator('#view-tabs [data-view="map"]').click();
  await page.locator('.mini-feature[data-feature="Overlapping"]').click();
  assert.equal(
    await page
      .locator('.mini-feature[data-feature="Overlapping"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('#view-tabs [data-view="sequence"]').click();
  await centered(3020);
  assert.equal(
    await page.locator('.mini-feature[data-feature="Origin"]').count(),
    2,
  );
  checks++;
  await record(100000);
  await page.locator('#view-tabs [data-view="sequence"]').click();
  await page.locator('.mini-feature[data-feature="Middle"]').click();
  await centered(50000);
  assert.equal(
    await page.locator("#sequence-editor").getAttribute("data-virtual"),
    "true",
  );
  assert.ok((await page.locator("[data-position]").count()) < 10000);
  await page.setViewportSize({ width: 760, height: 650 });
  assert.equal(await page.locator(".selection-overview").isVisible(), true);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await screenshot("sequence-overview-narrow");
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} model/overview UI checks passed: automatic discovery, model selection, secure native refresh, manual/error fallback, stale results, shared clickable overview and centered annotation navigation in normal/virtual sequences.`,
  );
} finally {
  await browser.close();
}
