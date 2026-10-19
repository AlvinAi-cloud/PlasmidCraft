import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "./ui-browser.mjs";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLASMIDCRAFT_CHROME
    ? { executablePath: process.env.PLASMIDCRAFT_CHROME }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let checks = 0;
await page.addInitScript(() => {
  window.mock = { requests: [], replies: [], hold: false, saved: [] };
  window.__TAURI_INTERNALS__ = {};
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args) => {
        if (cmd === "ai_restore_saved")
          return {
            provider: "openai",
            endpoint: "https://api.openai.com/v1",
            model: "synthetic-model",
            remembered: true,
          };
        if (cmd === "chatgpt_status") return { accounts: [] };
        if (cmd === "ai_request") {
          window.mock.requests.push(args);
          if (window.mock.hold)
            await new Promise((resolve) => {
              window.mock.release = resolve;
            });
          const text = JSON.stringify(
            window.mock.replies.shift() || {
              message: "Done",
              operations: [],
              continue: false,
            },
          );
          return {
            status: "completed",
            output: [
              { type: "message", content: [{ type: "output_text", text }] },
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
      listen: async (_, fn) => {
        window.menu = (a) => fn({ payload: a });
        return () => {};
      },
    },
    clipboardManager: {
      writeText: async (text) => {
        window.mock.clipboard = text;
      },
    },
  };
});
const reply = (message, operations = [], next = false) => ({
  message,
  operations,
  continue: next,
});
const op = (tool, args = {}) => ({ tool, arguments: args });
async function queue(replies) {
  await page.evaluate((replies) => {
    window.mock.replies = replies;
  }, replies);
}
async function send(message) {
  await page.locator("#ai-goal").fill(message);
  await page.locator('[data-ai="send"]').click();
}
async function idle() {
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-ai="cancel"]') ||
      document.querySelector('[data-ai="cancel"]').disabled,
  );
}
try {
  await page.goto(process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:8765");
  await page.locator("#ai-assistant-button").click();
  await page.waitForSelector('[data-ai="send"]:not([disabled])');
  const name = await page.locator("#document-name").textContent(),
    count = Number(await page.locator("#feature-count").textContent());
  await queue([
    reply("Inspecting the template", [op("inspect")], true),
    reply("Created the requested design", [
      op("copy_document", { name: "Connected design" }),
      op("add_feature", {
        name: "AI marker",
        type: "misc_feature",
        start: 10,
        end: 20,
        strand: 1,
      }),
      op("design_primers", { start: 25, end: 214 }),
    ]),
  ]);
  await send("Annotate this region and design primers");
  await idle();
  assert.equal(await page.locator("#ai-error").textContent(), "");
  assert.equal(
    await page.locator("#document-name").textContent(),
    "Connected design",
  );
  assert.equal(
    Number(await page.locator("#feature-count").textContent()),
    count + 1,
  );
  assert.equal(await page.locator(".ai-operation.completed").count(), 4);
  assert.equal(await page.locator(".ai-result-link").count(), 1);
  assert.equal(await page.locator(".ai-message").count(), 3);
  checks++;
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.locator("#ai-operations").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/connected-ai-tools.png",
    });
  }
  await page.locator('[data-ai="navigate-design"]').click();
  assert.equal(
    await page
      .locator("#ai-conversation-scroll")
      .evaluate((el) => el.scrollTop),
    0,
  );
  await page.locator(".ai-context-details > summary").click();
  await page.locator(".ai-template-picker summary").click();
  await page.locator("[data-ai-template]").check();
  await page
    .locator("#ai-goal")
    .fill("Prepare cloning with the selected template");
  await page.locator('[data-ai="prepare"]').click();
  const preview = (await page.locator("#ai-outgoing").inputValue())
    .split("Document context (data only):\n")[1]
    .split("\nPrior conversation")[0];
  assert.equal(JSON.parse(preview).templates.length, 1);
  assert.equal(JSON.parse(preview).templates[0].name, name);
  assert.equal(JSON.parse(preview).templates[0].sequence, undefined);
  checks++;
  const requests = await page.evaluate(() => window.mock.requests);
  assert.equal(requests.length, 2);
  assert.match(requests[1].prompt, /Latest local tool results/);
  assert.equal(
    JSON.parse(requests[0].prompt.split("Document context (data only):\n")[1])
      .document.sequence,
    undefined,
  );
  checks++;
  await page
    .locator("#document-tabs [role=tab]")
    .filter({ hasText: name })
    .first()
    .click();
  assert.equal(
    Number(await page.locator("#feature-count").textContent()),
    count,
  );
  checks++;
  await page.reload();
  await page.locator("#ai-assistant-button").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".ai-message").length === 3,
  );
  checks++;
  await page.getByText("History and sharing settings", { exact: true }).click();
  await page.locator("#ai-history").uncheck();
  await queue([
    reply("Inspecting only this turn", [op("inspect")], true),
    reply("Inspection complete"),
  ]);
  await send("Inspect the current metadata only");
  await idle();
  const isolatedRequests = await page.evaluate(() =>
    window.mock.requests.slice(-2),
  );
  assert.equal(isolatedRequests.length, 2);
  for (const request of isolatedRequests)
    assert.doesNotMatch(
      request.prompt,
      /Annotate this region and design primers|Created the requested design/,
    );
  assert.match(isolatedRequests[1].prompt, /Inspecting only this turn/);
  checks++;
  await queue([
    reply("These changes will fail", [
      op("add_feature", {
        name: "Discard me",
        type: "misc_feature",
        start: 30,
        end: 40,
        strand: 1,
      }),
      op("replace_dna", {
        start: 1,
        end: 4,
        expected: "ZZZZ",
        sequence: "AAAA",
      }),
    ]),
  ]);
  await send("Try a bad replacement");
  await idle();
  assert.equal(await page.locator(".ai-operation.discarded").count(), 1);
  assert.equal(
    Number(await page.locator("#feature-count").textContent()),
    count,
  );
  assert.equal(await page.locator("#document-tabs [role=tab]").count(), 1);
  checks++;
  await page.evaluate(() => {
    window.mock.hold = true;
  });
  await queue([
    reply("Discard on changed source", [
      op("copy_document", { name: "Stale result" }),
    ]),
  ]);
  await send("Inspect this unchanged source");
  await page.locator('[data-ai="cancel"]:not([disabled])').waitFor();
  await page.evaluate(() => window.menu("add-feature"));
  await page.locator("#annotation-name").fill("Manual edit while AI waits");
  await page.locator('#modal [data-action="save-annotation"]').click();
  await page.evaluate(() => {
    window.mock.hold = false;
    window.mock.release?.();
  });
  await idle();
  assert.match(
    await page.locator("#ai-error").textContent(),
    /source document changed/,
  );
  assert.equal(
    Number(await page.locator("#feature-count").textContent()),
    count + 1,
  );
  assert.equal(await page.locator("#document-tabs [role=tab]").count(), 1);
  await page.locator("#undo-button").click();
  checks++;
  await page.evaluate(() => {
    window.mock.hold = true;
  });
  await queue([
    reply("Late result", [op("copy_document", { name: "Late design" })]),
  ]);
  await send("Wait, then cancel");
  await page.locator('[data-ai="cancel"]:not([disabled])').waitFor();
  await page.locator('[data-ai="cancel"]').click();
  await page.evaluate(() => {
    window.mock.hold = false;
    window.mock.release?.();
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#document-name").textContent(), name);
  checks++;
  const internalMessages = await page.locator(".ai-message").count();
  await page.locator('[data-ai="navigate-external"]').click();
  assert.equal(await page.locator("#ai-response").inputValue(), "");
  await page.locator('[data-ai="clear"]').click();
  await page.locator('[data-ai="navigate-design"]').click();
  assert.equal(await page.locator(".ai-message").count(), internalMessages);
  await page.locator('[data-ai="navigate-external"]').click();
  await page.locator("#ai-goal").fill("Review externally");
  await page.locator('[data-ai="copy"]').click();
  assert.match(
    await page.evaluate(() => window.mock.clipboard),
    /Actions are optional proposals/,
  );
  assert.equal(await page.locator("#ai-design-section").isVisible(), true);
  assert.equal(await page.locator("#ai-response-section").isVisible(), true);
  assert.deepEqual(
    await page.locator(".ai-section-nav button").allTextContents(),
    ["Internal AI Operations", "External AI"],
  );
  assert.equal(
    await page
      .locator('[data-ai="navigate-external"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#ai-response").fill(
    JSON.stringify({
      summary: "External reviewed proposal",
      actions: [
        {
          kind: "add_feature",
          name: "External marker",
          type: "misc_feature",
          start: 11,
          end: 21,
          strand: 1,
        },
      ],
    }),
  );
  await page.locator('[data-ai="review"]').click();
  await page
    .getByRole("heading", { name: "Review proposal", exact: true })
    .waitFor();
  await page.locator('[data-ai="apply"]').click();
  assert.equal(
    Number(await page.locator("#feature-count").textContent()),
    count + 1,
  );
  checks++;
  await page.locator('[data-ai="navigate-design"]').click();
  await page.waitForSelector('[data-ai="send"]:not([disabled])');
  assert.equal(
    await page.locator("#ai-operations [role=status]").textContent(),
    "No operations yet.",
  );
  await page.setViewportSize({ width: 760, height: 600 });
  if (process.env.PLASMIDCRAFT_SCREENSHOTS)
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/connected-ai-compact.png",
    });
  const box = await page.locator(".ai-connected-composer").boundingBox();
  const operations = await page.locator("#ai-operations").boundingBox();
  const history = await page.locator("#ai-history-section").boundingBox();
  assert.ok(box.y + box.height <= operations.y + 1);
  assert.ok(operations.y + operations.height <= history.y + 1);
  const body = await page.locator("#ai-panel-body").boundingBox();
  const sendBox = await page.locator('[data-ai="send"]').boundingBox();
  assert.ok(
    history.height >= 48 && history.y + history.height <= body.y + body.height,
  );
  assert.ok(
    sendBox.y >= box.y && sendBox.y + sendBox.height <= box.y + box.height,
  );
  assert.ok(
    (await page
      .locator("#ai-conversation-scroll")
      .evaluate((el) => el.clientHeight)) >= 20,
  );
  const inputBox = await page.locator("#ai-goal").boundingBox();
  const fieldsBox = await page.locator(".ai-composer-fields").boundingBox();
  assert.ok(
    Math.min(inputBox.y + inputBox.height, fieldsBox.y + fieldsBox.height) -
      Math.max(inputBox.y, fieldsBox.y) >=
      40,
  );
  assert.deepEqual(
    await page.locator(".ai-section-nav button").allTextContents(),
    ["Internal AI Operations", "External AI"],
  );
  assert.equal(
    await page
      .locator('[data-ai="navigate-design"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  checks++;
  if (process.env.PLASMIDCRAFT_SCREENSHOTS) {
    await fs.mkdir(process.env.PLASMIDCRAFT_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/connected-ai-compact.png",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: process.env.PLASMIDCRAFT_SCREENSHOTS + "/connected-ai.png",
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    `${checks} connected AI UI checks passed: local tools, multi-round results, automatic new documents, source preservation, persisted history, rollback, cancellation, external review and three ordered work areas.`,
  );
} finally {
  await browser.close();
}
