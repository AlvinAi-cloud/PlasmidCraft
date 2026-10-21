// Saved native sessions simulated across page restarts; no real OAuth or tokens.
import assert from "node:assert/strict";
import { fixturePage, chromium, testOutput } from "./ui-browser.mjs";
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
page.on("pageerror", (e) => errors.push(e.message));
let offline = false,
  signedOut = false;
const accounts = [
  {
    id: "oaiapp_first",
    email: "synthetic@example.invalid",
    label: "First synthetic account",
    planEnabled: true,
    savedSession: true,
  },
  {
    id: "oaiapp_last",
    email: "synthetic@example.invalid",
    label: "Last synthetic account",
    planEnabled: true,
    savedSession: true,
  },
];
await page.exposeBinding("reconnectMock", async (_, command, args) => {
  calls.push({ command, args });
  if (command === "chatgpt_restore") {
    if (offline)
      throw new Error(
        "ChatGPT connection is temporarily offline. Saved session retained.",
      );
    return {
      accounts,
      activeId: signedOut ? null : "oaiapp_last",
      notice: signedOut ? "Signed out. Choose an account to sign in." : "",
    };
  }
  if (command === "chatgpt_status")
    return { accounts, activeId: signedOut ? null : "oaiapp_last", notice: "" };
  if (command === "chatgpt_models")
    return [
      { slug: "saved-model", display_name: "Saved model" },
      { slug: "other-model", display_name: "Other model" },
    ];
  if (command === "chatgpt_sign_in")
    throw new Error("Browser sign-in must not run automatically");
  if (command === "chatgpt_sign_out") {
    signedOut = true;
    accounts[1].savedSession = false;
    return { accounts, activeId: null, notice: "Signed out." };
  }
  if (command === "ai_restore_saved")
    return {
      provider: "openai",
      endpoint: "https://api.openai.com/v1",
      model: "api-model",
      remembered: true,
    };
});
await page.addInitScript(() => {
  if (!localStorage.getItem("plasmidcraft.ai.preferences"))
    localStorage.setItem(
      "plasmidcraft.ai.preferences",
      JSON.stringify({
        provider: "chatgpt",
        endpoint: "https://api.openai.com/v1",
        model: "saved-model",
        accountId: "oaiapp_last",
      }),
    );
  window.__TAURI_INTERNALS__ = {};
  window.__TAURI__ = {
    core: { invoke: (c, a) => window.reconnectMock(c, a) },
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
        window.reconnectMenu = (command) => handler({ payload: command });
        return () => {};
      },
    },
    clipboardManager: { writeText: async () => {} },
  };
});
async function start() {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  await page.waitForFunction(() => typeof window.reconnectMenu === "function");
}
async function panel() {
  await page.locator("#ai-assistant-button").click();
}
async function settings() {
  await page.evaluate(() => window.reconnectMenu("ai-settings"));
  await page.locator("#ai-settings-dialog").waitFor();
}
async function connected(model = "saved-model") {
  await page.locator("#ai-summary-detail").filter({ hasText: model }).waitFor();
  assert.equal(
    await page.locator(".ai-connection-badge").textContent(),
    "Connected",
  );
}
let checks = 0;
try {
  await start();
  await panel();
  await connected();
  assert.equal(calls.filter((c) => c.command === "chatgpt_restore").length, 1);
  assert.equal(
    calls.some((c) =>
      [
        "chatgpt_sign_in",
        "chatgpt_activate",
        "chatgpt_models",
        "ai_request",
        "ai_restore_saved",
      ].includes(c.command),
    ),
    false,
    "saved account/model reconnects without sign-in, inference, model lookup or API fallback",
  );
  await settings();
  assert.equal(
    await page.locator("#ai-chatgpt-account").inputValue(),
    "oaiapp_last",
  );
  assert.equal(await page.locator("#ai-model").inputValue(), "saved-model");
  await page.locator('#ai-settings-dialog [data-ai="settings-close"]').click();
  checks++;
  const aiIcon = await page
      .locator('#ai-assistant-button [data-icon="ai-chat"] svg')
      .innerHTML(),
    analyzeIcon = await page
      .locator('#analyze-button [data-icon="activity"] svg')
      .innerHTML();
  assert.notEqual(aiIcon, analyzeIcon);
  assert.equal(
    await page.locator('#ai-assistant-button [data-icon="ai-chat"]').count(),
    1,
  );
  await page.screenshot({ path: testOutput("chatgpt-restored.png") });
  checks++;
  await start();
  await panel();
  await connected();
  assert.equal(calls.filter((c) => c.command === "chatgpt_restore").length, 2);
  checks++;
  offline = true;
  await start();
  await panel();
  await page
    .locator("#ai-summary-detail")
    .filter({ hasText: "offline" })
    .waitFor();
  assert.equal(
    calls.some((c) => c.command === "chatgpt_sign_in"),
    false,
  );
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await connected();
  checks++;
  await settings();
  await page.locator('#ai-settings-dialog [data-ai="disconnect"]').click();
  const restored = calls.filter((c) => c.command === "chatgpt_restore").length;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  assert.equal(
    calls.filter((c) => c.command === "chatgpt_restore").length,
    restored,
    "explicit temporary disconnect is respected",
  );
  await start();
  await panel();
  await connected();
  checks++;
  await settings();
  await page.locator('#ai-settings-dialog [data-ai="chatgpt-out"]').click();
  await start();
  await panel();
  await page
    .locator("#ai-summary-detail")
    .filter({ hasText: "Signed out" })
    .waitFor();
  assert.equal(
    await page.locator(".ai-connection-badge").textContent(),
    "Not connected",
  );
  assert.equal(
    calls.some((c) => c.command === "chatgpt_sign_in"),
    false,
  );
  checks++;
  const chatRestores = calls.filter(
    (c) => c.command === "chatgpt_restore",
  ).length;
  await page.evaluate(() =>
    localStorage.setItem(
      "plasmidcraft.ai.preferences",
      JSON.stringify({
        provider: "openai",
        endpoint: "https://api.openai.com/v1",
        model: "api-model",
      }),
    ),
  );
  await start();
  await panel();
  await connected("api-model");
  assert.equal(
    calls.filter((c) => c.command === "chatgpt_restore").length,
    chatRestores,
    "explicit API choice remains authoritative",
  );
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} ChatGPT reconnect checks passed: account/model restoration, no browser login or inference at startup, distinct AI icon, offline retry, temporary disconnect, sign-out and provider isolation.`,
  );
} finally {
  await browser.close();
}
