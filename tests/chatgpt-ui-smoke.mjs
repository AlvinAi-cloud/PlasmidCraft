// Simulated native OAuth UI: no real account, credential or inference request.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0;
try {
  await page.addInitScript(() => {
    const state = (window.__aiMock = {
      calls: [],
      accounts: [],
      activeId: null,
      planAllowed: true,
      holdAuth: false,
      authError: null,
      requestError: null,
      response: JSON.stringify({
        message: "Synthetic AI response. Review before use.",
        continue: false,
        operations: [
          {
            tool: "add_feature",
            arguments: {
              name: "AI test annotation",
              type: "misc_feature",
              start: 10,
              end: 20,
              strand: 1,
            },
          },
        ],
      }),
      hold: false,
    });
    window.__TAURI_INTERNALS__ = {};
    window.__TAURI__ = {
      core: {
        invoke: async (command, args) => {
          if (command === "take_open_documents") return [];
          state.calls.push({ command, args });
          if (command === "chatgpt_status")
            return {
              accounts: state.accounts,
              activeId: state.activeId,
              notice: "",
            };
          if (command === "chatgpt_sign_in") {
            if (state.authError) throw new Error(state.authError);
            if (state.holdAuth)
              return new Promise((resolve, reject) => {
                state.authReject = reject;
              });
            const id = args.registrationId || "oaiapp_first";
            if (!state.accounts.some((a) => a.id === id))
              state.accounts.push({
                id,
                email: "same@example.invalid",
                label: "same@example.invalid · " + id,
                planEnabled: state.planAllowed,
                savedSession: true,
              });
            state.accounts.find((a) => a.id === id).planEnabled =
              state.planAllowed;
            state.activeId = id;
            return {
              accounts: state.accounts,
              activeId: id,
              notice: state.planAllowed
                ? ""
                : "Plan permission not granted. Reauthorize.",
            };
          }
          if (command === "chatgpt_cancel") {
            state.authReject?.(new Error("Sign-in canceled"));
            state.authReject = null;
            return;
          }
          if (command === "chatgpt_activate") {
            state.activeId = args.registrationId;
            return {
              accounts: state.accounts,
              activeId: state.activeId,
              notice: "",
            };
          }
          if (command === "chatgpt_models")
            return [
              {
                slug: "model-" + args.registrationId,
                display_name: "First account model",
              },
              {
                slug: "second-" + args.registrationId,
                display_name: "Second account model",
              },
            ];
          if (command === "chatgpt_sign_out") {
            state.accounts.find(
              (a) => a.id === args.registrationId,
            ).savedSession = false;
            if (state.activeId === args.registrationId) state.activeId = null;
            return {
              accounts: state.accounts,
              activeId: state.activeId,
              notice:
                "Signed out locally. Remote revocation was not confirmed.",
            };
          }
          if (command === "ai_request" && state.requestError)
            throw new Error(state.requestError);

          if (command === "ai_connect")
            return {
              provider: args.connection.provider,
              endpoint: args.connection.endpoint,
            };
          if (command === "ai_cancel") {
            state.reject?.(new Error("Canceled"));
            state.reject = null;
            return;
          }
          if (command === "ai_request") {
            if (state.hold)
              return new Promise((resolve, reject) => {
                state.reject = reject;
              });
            return {
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: args.prompt.includes("Latest local tool results") ? JSON.stringify({message:"Synthetic AI response. Verified completed operations.",operations:[],continue:false}) : state.response }],
                },
              ],
            };
          }
        },
      },
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
          state.menu = (action) => handler({ payload: action });
          return () => {};
        },
      },
      clipboardManager: {
        writeText: async (text) => {
          state.clipboard = text;
        },
      },
    };
  });
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317");
  await page.locator("#plasmid-map").waitFor();
  const click = async (action) => {
    const settingsAction =
      action.startsWith("chatgpt-") ||
      ["navigate-connection", "cancel", "settings-close"].includes(action);
    if (
      settingsAction &&
      !(await page.locator("#ai-settings-dialog").isVisible())
    ) {
      await page.evaluate(() => window.__aiMock.menu("ai-account"));
      await page.locator("#ai-settings-dialog").waitFor();
    }
    if (action === "navigate-connection") return;
    if (
      !settingsAction &&
      (await page.locator("#ai-settings-dialog").isVisible())
    )
      await page.locator('[data-ai="settings-close"]').click();
    if (!settingsAction && !(await page.locator("#ai-panel").isVisible()))
      await page.locator("#ai-assistant-button").click();
    const scope = settingsAction
      ? page.locator("#ai-settings-dialog")
      : page.locator("#ai-workspace");
    const target = scope.locator(`[data-ai="${action}"]`);
    if (!(await target.isVisible()) && !action.startsWith("navigate-"))
      await page
        .locator(
          `[data-ai="navigate-${action === "review" ? "response" : "design"}"]`,
        )
        .click();
    await scope.locator(`[data-ai="${action}"]`).click();
  };
  await page.waitForFunction(() => typeof window.__aiMock.menu === "function");
  await page.evaluate(() => window.__aiMock.menu("ai-account"));
  await page.locator("#chatgpt-account-panel").waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        window.__aiMock.calls.filter(
          (c) => !["chatgpt_status", "ai_restore_saved"].includes(c.command),
        ).length,
    ),
    0,
  );
  checks++;
  await click("chatgpt-new");
  await page.waitForFunction(
    () => document.querySelector("#ai-provider").value === "chatgpt",
  );
  await page
    .locator("#ai-model option[value='model-oaiapp_first']")
    .waitFor({ state: "attached" });
  assert.equal(await page.locator("#ai-key").count(), 0);
  assert.match(
    await page.locator("#ai-connection-status").textContent(),
    /Plan permission granted/,
  );
  assert.equal(await page.locator("#ai-model").inputValue(), "");
  await page.locator("#ai-model").selectOption("model-oaiapp_first");
  checks++;
  await click("navigate-design");
  await page.locator("#ai-goal").fill("Review the current plasmid");
  await click("send");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".ai-message.assistant")
        ?.textContent.includes("Synthetic AI response") &&
      document.querySelector(".ai-operation.completed"),
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__aiMock.calls.find((c) => c.command === "ai_request").args
          .model,
    ),
    "model-oaiapp_first",
  );
  assert.equal(
    await page.evaluate(() =>
      window.__aiMock.calls.some((c) => c.command === "ai_connect"),
    ),
    false,
  );
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  checks++;
  await page.getByRole("heading", { name: "Operations and results" }).waitFor();
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/chatgpt-account.png",
    });
  }
  checks++;
  await page.evaluate(() => {
    window.__aiMock.requestError =
      "ChatGPT plan limit reached. No API-key fallback was used.";
  });
  await page.locator("#ai-goal").fill("Continue the review");
  await click("send");
  await page.waitForFunction(() =>
    document.querySelector("#ai-error").textContent.includes("limit reached"),
  );
  assert.equal(await page.locator(".ai-result-link").count(), 0);
  assert.equal(
    await page.evaluate(() =>
      window.__aiMock.calls.some((c) => c.command === "ai_connect"),
    ),
    false,
  );
  checks++;
  await page.evaluate(() => {
    window.__aiMock.requestError = null;
    window.__aiMock.accounts.push({
      id: "oaiapp_second",
      email: "same@example.invalid",
      label: "same@example.invalid · second",
      planEnabled: true,
      savedSession: true,
    });
  });
  await page.locator('[data-ai="close"]').click();
  await page.locator("#ai-assistant-button").click();
  await click("navigate-connection");
  await page
    .locator('#ai-chatgpt-account option[value="oaiapp_second"]')
    .waitFor({ state: "attached" });
  await click("navigate-connection");
  await page.locator("#ai-chatgpt-account").selectOption("oaiapp_second");
  await click("chatgpt-use");
  await page
    .locator('#ai-model option[value="model-oaiapp_second"]')
    .waitFor({ state: "attached" });
  assert.equal(
    await page.locator('#ai-model option[value="model-oaiapp_first"]').count(),
    0,
  );
  checks++;
  await page.evaluate(() => {
    window.__aiMock.planAllowed = false;
  });
  await click("chatgpt-reauth");
  await page.waitForFunction(() =>
    document
      .querySelector("#chatgpt-account-status")
      .textContent.includes("Plan permission not granted"),
  );
  assert.equal(await page.locator('[data-ai="send"]').isDisabled(), true);
  assert.equal(await page.locator("#ai-model option").count(), 1);
  checks++;
  await click("chatgpt-out");
  await page.waitForFunction(() =>
    document
      .querySelector("#chatgpt-account-status")
      .textContent.includes("Remote revocation"),
  );
  assert.equal(await page.locator('[data-ai="send"]').isDisabled(), true);
  checks++;
  await page.evaluate(() => {
    window.__aiMock.holdAuth = true;
  });
  await click("chatgpt-new");
  await page
    .locator("#chatgpt-account-status")
    .filter({ hasText: "Waiting" })
    .waitFor();
  await click("cancel");
  assert.match(
    await page.locator("#ai-settings-dialog .modal-error").textContent(),
    /canceled/,
  );
  checks++;
  await click("chatgpt-new");
  await page
    .locator("#chatgpt-account-status")
    .filter({ hasText: "Waiting" })
    .waitFor();
  await click("settings-close");
  await page.waitForTimeout(150);
  assert.equal(await page.locator("#ai-settings-dialog").isVisible(), false);
  checks++;
  await page.evaluate(() => {
    window.__aiMock.holdAuth = false;
    window.__aiMock.authError =
      "Selected account is not eligible for plan usage.";
  });
  if (!(await page.locator("#ai-panel").isVisible()))
    await page.locator("#ai-assistant-button").click();
  await click("chatgpt-new");
  await page.waitForFunction(() =>
    document
      .querySelector("#ai-settings-dialog .modal-error")
      .textContent.includes("not eligible"),
  );
  assert.equal(await page.locator('[data-ai="send"]').isDisabled(), true);
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} ChatGPT account UI checks passed: sign-in, models, plan consent, account switching, no billing fallback, sign-out, cancellation and late-result suppression.`,
  );
} finally {
  await browser.close();
}
