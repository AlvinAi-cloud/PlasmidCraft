// Integration checks with a simulated Tauri bridge, not a native-window test.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseSnapgene } from "../viewer/core.mjs";
import { parseProject } from "../viewer/project.mjs";
import { fixturePage, chromium, testOutput } from "./ui-browser.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = [
  ...(await fs.readFile(path.join(root, "tests/fixtures/synthetic-test.gb"))),
];
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
  requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => requests.push(request.url()));
const url = process.env.PLASMIDCRAFT_URL || "http://127.0.0.1:4317";
let checks = 0;
try {
  await page.addInitScript((bytes) => {
    const state = (window.__desktopMock = {
      files: { "/chosen/example.gb": bytes },
      picked: ["/chosen/example.gb"],
      savePath: null,
      saveDialogs: 0,
      openDialogs: 0,
      reads: [],
      writes: [],
      confirm: false,
      confirmations: 0,
      destroyed: 0,
      writeError: null,
    });
    const nativeWindow = {
      setTitle: async (title) => {
        state.title = title;
      },
      onCloseRequested: async (callback) => {
        state.onClose = callback;
        return () => {};
      },
      destroy: async () => {
        state.destroyed++;
      },
      close: async () => {
        let prevented = false;
        await state.onClose({
          preventDefault() {
            prevented = true;
          },
        });
        if (!prevented) await nativeWindow.destroy();
      },
    };
    window.__TAURI_INTERNALS__ = {};
    window.__TAURI__ = {
      core: {
        invoke: async (command, data, options) => {
          if (command === "take_open_documents") return state.pendingOpen?.splice(0) || [];
          if (command !== "save_file_atomic")
            throw new Error("Unexpected command: " + command);
          state.atomicSaves = (state.atomicSaves || 0) + 1;
          if (state.holdSave)
            await new Promise((resolve) => {
              state.resumeSave = resolve;
            });
          const path = new TextDecoder().decode(
            Uint8Array.from(atob(options.headers["x-plasmidcraft-path"]), (c) =>
              c.charCodeAt(0),
            ),
          );
          await window.__TAURI__.fs.writeFile(path, data);
        },
      },
      dialog: {
        open: async () => {
          state.openDialogs++;
          return state.picked;
        },
        save: async () => {
          state.saveDialogs++;
          return state.savePath;
        },
        confirm: async () => {
          state.confirmations++;
          return state.confirm;
        },
      },
      fs: {
        stat: async (file) => ({ size: state.files[file].length }),
        readFile: async (file) => {
          state.reads.push(file);
          return new Uint8Array(state.files[file]);
        },
        writeFile: async (file, data) => {
          if (state.writeError) throw new Error(state.writeError);
          state.files[file] = [...data];
          state.writes.push(file);
        },
      },
      clipboardManager: {
        writeText: async (text) => {
          state.clipboard = text;
        },
      },
      window: { getCurrentWindow: () => nativeWindow },
      event: {
        listen: async (name, callback) => {
          if (name === "plasmidcraft-open-documents") {
            state.openDocuments = callback;
            return () => {};
          }
          state.menu = (action) => callback({ payload: action });
          return () => {};
        },
      },
    };
  }, fixture);
  await page.goto(url);
  await page.waitForFunction(() => window.__desktopMock.menu);
  assert.equal(
    await page.locator("#runtime-label").textContent(),
    "Desktop app",
  );
  assert.match(
    await page.evaluate(() => window.__desktopMock.title),
    /PlasmidCraft/,
  );
  checks++;
  await page.locator("#open-file").click();
  await page.waitForFunction(
    () => document.querySelector("#doc-count").textContent === "2",
  );
  assert.equal(await page.locator(".annotation-row").count(), 8);
  assert.deepEqual(await page.evaluate(() => window.__desktopMock.reads), [
    "/chosen/example.gb",
  ]);
  checks++;

  async function editAnnotation(name) {
    await page.locator('.annotation-row[data-feature="feature-1"]').click();
    await page
      .locator("#inspector")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page.locator("#annotation-name").fill(name);
    await page
      .getByRole("button", { name: "Save annotation", exact: true })
      .click();
    assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  }
  await editAnnotation("Desktop annotation");
  await page.locator("#save-project-button").click();
  assert.equal(await page.evaluate(() => window.__desktopMock.saveDialogs), 1);
  assert.deepEqual(await page.evaluate(() => window.__desktopMock.writes), []);
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  checks++;
  await page.evaluate(() => {
    window.__desktopMock.savePath = "/chosen/example.pcraft";
    window.__desktopMock.holdSave = true;
  });
  await page.evaluate(() => window.__desktopMock.menu("save-project"));
  await page.waitForFunction(() => window.__desktopMock.resumeSave);
  await page.evaluate(() => window.__desktopMock.menu("save-project"));
  assert.equal(await page.evaluate(() => window.__desktopMock.atomicSaves), 1);
  await page.evaluate(() => {
    window.__desktopMock.holdSave = false;
    window.__desktopMock.resumeSave();
  });
  checks++;
  await page.waitForFunction(
    () => document.querySelector("#dirty-indicator").hidden,
  );
  const savedBytes = await page.evaluate(
    () => window.__desktopMock.files["/chosen/example.pcraft"],
  );
  const saved = parseProject(
    new TextDecoder().decode(new Uint8Array(savedBytes)),
  );
  assert.equal(saved.features[1].name, "Desktop annotation");
  assert.equal(saved.primers.length, 2);
  checks++;
  await editAnnotation("Second desktop annotation");
  await page.evaluate(() => {
    window.__desktopMock.writeError = "Test disk full";
    window.__desktopMock.menu("save-project");
  });
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("disk full"),
  );
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  assert.equal(await page.evaluate(() => window.__desktopMock.saveDialogs), 2);
  assert.deepEqual(
    await page.evaluate(
      () => window.__desktopMock.files["/chosen/example.pcraft"],
    ),
    savedBytes,
  );
  checks++;
  await page.evaluate(() => {
    window.__desktopMock.writeError = null;
    window.__desktopMock.savePath = "/chosen/export.gb";
    window.__desktopMock.menu("export-genbank");
  });
  await page.waitForFunction(
    () => window.__desktopMock.files["/chosen/export.gb"],
  );
  const exported = await page.evaluate(
    () => window.__desktopMock.files["/chosen/export.gb"],
  );
  assert.match(
    new TextDecoder().decode(new Uint8Array(exported)),
    /Second desktop annotation/,
  );
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  checks++;
  // Native export opens the save picker directly; cancel/error cannot mark
  // an edited source document as saved or replace an earlier export.
  const beforeExport = await page.evaluate(() => ({
    dialogs: window.__desktopMock.saveDialogs,
    writes: window.__desktopMock.writes.length,
  }));
  await page.evaluate(() => {
    window.__desktopMock.savePath = null;
    window.__desktopMock.menu("export-snapgene");
  });
  await page.waitForFunction(
    (n) => window.__desktopMock.saveDialogs === n + 1,
    beforeExport.dialogs,
  );
  assert.equal(await page.locator("#modal").evaluate((d) => d.open), false);
  assert.equal(
    await page.evaluate(() => window.__desktopMock.writes.length),
    beforeExport.writes,
  );
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  checks++;
  await page.evaluate(() => {
    window.__desktopMock.savePath = "/chosen/export.dna";
    window.__desktopMock.writeError = "Export disk full";
    window.__desktopMock.menu("export-snapgene");
  });
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("Export disk full"),
  );
  assert.equal(
    await page.evaluate(
      () => !!window.__desktopMock.files["/chosen/export.dna"],
    ),
    false,
  );
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  checks++;
  await page.evaluate(() => {
    window.__desktopMock.writeError = null;
    window.__desktopMock.menu("export-snapgene");
  });
  await page.waitForFunction(
    () => !!window.__desktopMock.files["/chosen/export.dna"],
  );
  const [dnaExport] = parseSnapgene(
    new Uint8Array(
      await page.evaluate(
        () => window.__desktopMock.files["/chosen/export.dna"],
      ),
    ),
  );
  assert.ok(
    dnaExport.features.some((f) => f.name === "Second desktop annotation"),
  );
  assert.equal(await page.locator("#dirty-indicator").isHidden(), false);
  checks++;
  await page.evaluate(() => {
    window.__desktopMock.picked = ["/chosen/example.pcraft"];
    window.__desktopMock.menu("open");
  });
  await page.waitForFunction(
    () => document.querySelector("#doc-count").textContent === "3",
  );
  assert.equal(
    await page.locator("#document-format").textContent(),
    "PlasmidCraft",
  );
  assert.match(
    await page.locator("#inspector").textContent(),
    /Desktop annotation/,
  );
  assert.doesNotMatch(
    await page.locator("#inspector").textContent(),
    /Second desktop annotation/,
  );
  checks++;
  await editAnnotation("Reopened annotation");
  const beforeSaveDialogs = await page.evaluate(
    () => window.__desktopMock.saveDialogs,
  );
  await page.evaluate(() => window.__desktopMock.menu("save-project"));
  await page.waitForFunction(
    () => document.querySelector("#dirty-indicator").hidden,
  );
  assert.equal(
    await page.evaluate(() => window.__desktopMock.saveDialogs),
    beforeSaveDialogs,
  );
  checks++;
  await page.evaluate(() => {
    window.__desktopMock.savePath = null;
    window.__desktopMock.menu("save-project-as");
  });
  await page.waitForFunction(
    (count) => window.__desktopMock.saveDialogs === count + 1,
    beforeSaveDialogs,
  );
  assert.equal(await page.locator("#dirty-indicator").isHidden(), true);
  checks++;
  await page.locator('.annotation-row[data-feature="feature-1"]').click();
  await page.evaluate(() => window.__desktopMock.menu("copy-sequence"));
  await page.locator('[data-action="copy-selected-choice"]').click();
  await page.waitForFunction(() => window.__desktopMock.clipboard?.length > 0);
  assert.match(
    await page.evaluate(() => window.__desktopMock.clipboard),
    /^[ACGTRYSWKMBDHVN]+$/,
  );
  checks++;
  await page.evaluate(() => window.__desktopMock.menu("view-translation"));
  await page.evaluate(() => window.__desktopMock.menu("paste-protein"));
  await page.locator("#protein-paste-sequence").waitFor();
  await page.locator("#protein-paste-sequence").fill("MPEPTIDE");
  await page.locator('[data-codon="paste-create"]').click();
  assert.equal(
    await page.locator("#protein-sequence").inputValue(),
    "MPEPTIDE",
  );
  await page.locator('#modal [data-action="close-modal"]').first().click();
  checks++;
  assert.equal(await page.locator(".translation-block").count(), 6);
  await page.evaluate(() => window.__desktopMock.menu("help"));
  await page.locator("#help-dialog").waitFor({ state: "visible" });
  assert.match(await page.locator("#help-article").textContent(), /\.pcraft/);
  await page.locator("#help-dialog [data-help-close]").click();
  checks++;
  // Opening from the OS adds a document through the same parsers, without a dialog.
  const beforeOSOpen = await page.locator("#doc-count").textContent();
  const dialogsBeforeOSOpen = await page.evaluate(() => window.__desktopMock.openDialogs);
  await page.evaluate(() => {
    const s = window.__desktopMock;
    s.files["/chosen/from Finder.fa"] = [...new TextEncoder().encode(">Finder sequence\nATGCGTACGTAGCTAGCTAGCATCGATCGATCGATCGATCG\n")];
    s.pendingOpen = ["/chosen/from Finder.fa"];
    s.openDocuments({});
  });
  await page.waitForFunction((count) => Number(document.querySelector("#doc-count").textContent) === Number(count) + 1, beforeOSOpen);
  assert.match(await page.locator("#document-tabs .active").textContent(), /from Finder\.fa/);
  assert.equal(await page.evaluate(() => window.__desktopMock.openDialogs), dialogsBeforeOSOpen);
  checks++;
  // An inactive document still has unsaved changes, even though the active one is saved.
  await page.evaluate(() => window.__desktopMock.menu("quit"));
  await page.waitForFunction(() => window.__desktopMock.confirmations === 1);
  assert.equal(await page.evaluate(() => window.__desktopMock.destroyed), 0);
  await page.evaluate(() => {
    window.__desktopMock.confirm = true;
    window.__desktopMock.menu("quit");
  });
  await page.waitForFunction(() => window.__desktopMock.destroyed === 1);
  checks++;
  assert.deepEqual(errors, []);
  assert.ok(requests.every((request) => request.startsWith(url)));
  checks++;
  console.log(
    `${checks} simulated desktop bridge checks passed; no page errors or external network requests.`,
  );
} finally {
  await browser.close();
}
