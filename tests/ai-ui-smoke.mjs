// Runs the real UI with a simulated native transport; no paid API calls or real credentials.
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
      response: JSON.stringify({
        summary: "Synthetic AI response. Review before use.",
        actions: [
          {
            kind: "add_feature",
            name: "AI test annotation",
            type: "misc_feature",
            start: 10,
            end: 20,
            strand: 1,
          },
          { kind: "workflow", tool: "gibson" },
        ],
      }),
      hold: false,
    });
    window.__TAURI_INTERNALS__ = {};
    window.__TAURI__ = {
      core: {
        invoke: async (command, args) => {
          state.calls.push({ command, args });
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
                  content: [{ type: "output_text", text: state.response }],
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
        listen: async (_, handler) => {
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
  const originalCount = Number(
      await page.locator("#feature-count").textContent(),
    ),
    originalName = await page.locator("#document-name").textContent();
  async function click(action) {
    if (action === "navigate-connection") {
      await page.evaluate(() => window.__aiMock.menu("ai-settings"));
      await page.locator("#ai-settings-dialog").waitFor();
      return;
    }
    const settingsAction = [
      "connect",
      "disconnect",
      "test",
      "settings-close",
    ].includes(action);
    if (
      settingsAction &&
      action !== "settings-close" &&
      !(await page.locator("#ai-settings-dialog").isVisible())
    )
      await click("navigate-connection");
    if (
      !settingsAction &&
      (await page.locator("#ai-settings-dialog").isVisible())
    )
      await page.locator('[data-ai="settings-close"]').click();
    const target = page.locator(`[data-ai="${action}"]`);
    if (!(await target.isVisible()) && !action.startsWith("navigate-")) {
      const section = ["review", "clear", "export", "apply"].includes(action)
        ? "external"
        : "design";
      await page.locator(`[data-ai="navigate-${section}"]`).click();
    }
    await target.click();
  }
  await page.locator("#ai-assistant-button").click();
  assert.equal(await page.locator("#ai-workspace #ai-key").count(), 0);
  assert.equal(await page.locator("#ai-dna").isChecked(), true);
  assert.equal(await page.locator("#ai-key").isVisible(), false);
  await click("navigate-connection");
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
  assert.match(
    await page.locator("#ai-summary-detail").textContent(),
    /No provider connected/,
  );
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/ai-connections.png",
    });
  }
  assert.equal(await page.locator("#ai-key").getAttribute("type"), "password");
  await page.locator("#ai-model-manual").check();
  await page.locator("#ai-model").fill("remembered-model");
  await page.locator("#ai-key").fill("temporary-field-value");
  await click("navigate-design");
  await click("navigate-connection");
  assert.equal(await page.locator("#ai-key").inputValue(), "");
  assert.equal(
    await page.locator("#ai-model").inputValue(),
    "remembered-model",
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("plasmidcraft.ai.preferences")).model,
    ),
    "remembered-model",
  );
  checks++;
  await page.locator("#ai-model").fill("chosen-model");
  await page.locator("#ai-key").fill("synthetic-test-key");
  await click("connect");
  await page.waitForFunction(() =>
    document
      .querySelector("#ai-connection-status")
      .textContent.includes("Configured"),
  );
  assert.equal(await page.locator("#ai-key").count(), 0);
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(localStorage).includes("synthetic-test-key"),
    ),
    false,
  );
  checks++;
  await page.evaluate(() => window.__aiMock.menu("ai-workflow"));
  await click("navigate-external");
  await page.locator("#ai-task").selectOption("golden");
  assert.match(await page.locator("#ai-goal").inputValue(), /Golden Gate/);
  checks++;
  await click("prepare");
  assert.ok(
    !(await page.locator("#ai-outgoing").inputValue()).includes(
      "synthetic-test-key",
    ),
  );
  await page.locator("#ai-dna").check();
  await click("prepare");
  assert.match(await page.locator("#ai-outgoing").inputValue(), /"sequence"/);
  checks++;
  await click("navigate-design");
  await page.evaluate(() => {
    window.__aiMock.response = JSON.stringify({
      message: "Created by local tools",
      operations: [
        { tool: "copy_document", arguments: { name: "Connected result" } },
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
      continue: false,
    });
  });
  await click("send");
  await page.waitForFunction(
    () => document.querySelectorAll(".ai-operation.completed").length === 2,
  );
  assert.equal(
    await page.locator("#document-name").textContent(),
    "Connected result",
  );
  assert.equal(
    Number(await page.locator("#feature-count").textContent()),
    originalCount + 1,
  );
  checks++;
  await page
    .locator("#document-tabs [role=tab]")
    .filter({ hasText: originalName })
    .first()
    .click();
  assert.equal(
    Number(await page.locator("#feature-count").textContent()),
    originalCount,
  );
  checks++;
  await click("navigate-external");
  await page.locator("#ai-goal").fill("Review externally");
  await click("copy");
  await page.locator("#ai-response").fill(
    JSON.stringify({
      summary: "External proposal",
      actions: [
        {
          kind: "add_feature",
          name: "External annotation",
          type: "misc_feature",
          start: 10,
          end: 20,
          strand: 1,
        },
        { kind: "workflow", tool: "gibson" },
      ],
    }),
  );
  await click("review");
  await page.getByRole("heading", { name: "Review proposal" }).waitFor();
  checks++;
  await click("workflow-gibson");
  await page
    .getByRole("heading", { name: "Gibson / HiFi cloning design", exact: true })
    .waitFor();
  checks++;
  await click("apply");
  assert.equal(
    Number(await page.locator("#feature-count").textContent()),
    originalCount + 1,
  );
  checks++;
  await click("navigate-external");
  await page.locator("#ai-response").fill(
    JSON.stringify({
      summary: "Unsupported",
      actions: [{ kind: "shell", command: "no" }],
    }),
  );
  await click("review");
  assert.match(await page.locator("#ai-error").textContent(), /Unsupported/);
  checks++;
  await click("navigate-design");
  await page.locator("#ai-goal").fill("Review without edits");
  await page.evaluate(() => (window.__aiMock.hold = true));
  await click("send");
  await page.locator('[data-ai="cancel"]:not([disabled])').waitFor();
  await click("cancel");
  assert.match(await page.locator("#ai-error").textContent(), /canceled/);
  checks++;
  await page.evaluate(() => (window.__aiMock.hold = false));
  await page.setViewportSize({ width: 760, height: 600 });
  assert.ok(
    await page
      .locator("#ai-workspace")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
  );
  checks++;
  await click("navigate-connection");
  await click("disconnect");
  assert.equal(await page.locator("#ai-key").inputValue(), "");
  await click("settings-close");
  await page.locator('[data-ai="close"]').click();
  await page.evaluate(() => window.__aiMock.menu("ai-settings"));
  assert.equal(await page.locator("#ai-panel").isVisible(), false);
  checks++;
  assert.deepEqual(errors, []);
  console.log(
    `${checks} AI desktop-bridge UI checks passed: account setup, key privacy, connected copies, external review, workflow launch, rejection, cancellation and compact layout.`,
  );
} finally {
  await browser.close();
}
