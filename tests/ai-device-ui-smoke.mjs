// Native vault simulation across renderer restarts; no real credentials or inference.
import assert from "node:assert/strict";
import { fixturePage, chromium } from "./ui-browser.mjs";
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
let saved = null,
  failSave = false,
  failRestore = false,
  checks = 0;
page.on("pageerror", (error) => errors.push(error.message));
await page.exposeBinding("nativeDeviceMock", async (_, command, args) => {
  calls.push({ command, args });
  if (command === "ai_restore_saved") {
    if (failRestore) throw new Error("Synthetic local settings read failure");
    return saved;
  }
  if (command === "ai_connect") {
    if (args.remember && failSave)
      throw new Error("Synthetic local settings save failure");
    const status = {
      provider: args.connection.provider,
      endpoint: args.connection.endpoint,
      model: args.model,
      remembered: args.remember,
    };
    if (args.remember) saved = status;
    return status;
  }
  if (command === "ai_forget_saved") {
    saved = null;
    failRestore = false;
  }
  if (command === "chatgpt_status") return { accounts: [] };
});
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {};
  window.__TAURI__ = {
    core: { invoke: (command, args) => command === "take_open_documents" ? [] : window.nativeDeviceMock(command, args) },
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
      listen: async (name, handler) => {
          if (name !== "plasmidcraft-menu") return () => {};
        window.deviceMenu = (action) => handler({ payload: action });
        return () => {};
      },
    },
    clipboardManager: { writeText: async () => {} },
  };
});
async function start() {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  await page.waitForFunction(() => typeof window.deviceMenu === "function");
}
async function settings() {
  await page.evaluate(() => window.deviceMenu("ai-settings"));
  await page.locator("#ai-settings-dialog").waitFor();
}
async function action(name) {
  await page.locator(`#ai-settings-dialog [data-ai="${name}"]`).click();
}
try {
  await start();
  await settings();
  assert.equal(await page.locator("#ai-panel").isVisible(), false);
  assert.equal(await page.locator("#ai-remember").isChecked(), true);
  await page.locator("#ai-model-manual").check();
  await page.locator("#ai-model").fill("device-model");
  await page.locator("#ai-key").fill("synthetic-device-key");
  await action("connect");
  await page
    .locator("#ai-connection-status")
    .filter({ hasText: "Saved on this computer" })
    .waitFor();
  assert.equal(
    calls.find((c) => c.command === "ai_connect").args.remember,
    true,
  );
  assert.equal(await page.locator("#ai-key").count(), 0);
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(localStorage).includes("synthetic-device-key"),
    ),
    false,
  );
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(sessionStorage).includes("synthetic-device-key"),
    ),
    false,
  );
  checks++;
  await action("settings-close");
  await start();
  await page.locator("#ai-assistant-button").click();
  await page
    .locator("#ai-summary-detail")
    .filter({ hasText: "device-model" })
    .waitFor();
  assert.match(
    await page.locator("#ai-summary-detail").textContent(),
    /Saved on this device/,
  );
  assert.equal(
    calls.some((c) => c.command === "ai_request"),
    false,
  );
  assert.equal(calls.filter((c) => c.command === "ai_connect").length, 1);
  checks++;
  await settings();
  await action("disconnect");
  await page
    .locator("#ai-connection-status")
    .filter({ hasText: "Disconnected for now" })
    .waitFor();
  assert.ok(saved);
  await action("settings-close");
  await start();
  await settings();
  await page
    .locator("#ai-connection-status")
    .filter({ hasText: "Configured" })
    .waitFor();
  checks++;
  await action("forget");
  await page.locator("#ai-key").waitFor();
  assert.equal(saved, null);
  await action("settings-close");
  await start();
  await settings();
  assert.equal(await page.locator('[data-ai="forget"]').count(), 0);
  assert.equal(await page.locator("#ai-key").inputValue(), "");
  checks++;
  failSave = true;
  await page.locator("#ai-key").fill("synthetic-failed-key");
  await action("connect");
  await page
    .locator("#ai-settings-dialog .modal-error")
    .filter({ hasText: "save failure" })
    .waitFor();
  assert.equal(saved, null);
  assert.equal(await page.locator("#ai-key").inputValue(), "");
  checks++;
  await page.locator("#ai-remember").uncheck();
  await page.locator("#ai-key").fill("synthetic-session-key");
  await action("connect");
  await page
    .locator("#ai-connection-status")
    .filter({ hasText: "Session only" })
    .waitFor();
  assert.equal(saved, null);
  await action("settings-close");
  await start();
  await settings();
  assert.equal(await page.locator("#ai-key").isVisible(), true);
  checks++;
  await action("settings-close");
  failRestore = true;
  await start();
  await settings();
  await page
    .locator("#ai-settings-dialog")
    .filter({ hasText: "read failure" })
    .waitFor();
  await action("forget");
  assert.equal(failRestore, false);
  assert.equal(await page.locator('[data-ai="forget"]').count(), 0);
  checks++;
  await page.locator("#ai-provider").selectOption("compatible");
  await page
    .locator("#ai-endpoint")
    .fill(
      "https://user:synthetic-url-secret@example.invalid/v1?key=synthetic-query-secret",
    );
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(localStorage).includes("synthetic-url-secret"),
    ),
    false,
  );
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(localStorage).includes("synthetic-query-secret"),
    ),
    false,
  );
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} API device credential UI checks passed: device-save handoff, automatic reconnect, no inference at startup, temporary disconnect, forget, save/read failures and explicit session-only fallback.`,
  );
} finally {
  await browser.close();
}
