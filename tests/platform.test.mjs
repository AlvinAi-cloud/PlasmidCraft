import test from "node:test";
import assert from "node:assert/strict";
import { createPlatform, FILE_LIMIT } from "../viewer/platform.mjs";

function nativeHost() {
  const calls = {
    reads: [],
    writes: [],
    saves: 0,
    destroyed: 0,
    prevented: 0,
    confirmations: 0,
  };
  const state = {
    picked: ["/chosen/test.gb"],
    savePath: "/chosen/output.pcraft",
    confirm: false,
    size: 4,
    bytes: new Uint8Array([65, 67, 71, 84]),
  };
  const window = {
    setTitle: async (title) => {
      calls.title = title;
    },
    onCloseRequested: async (handler) => {
      calls.closeHandler = handler;
      return () => {
        calls.closeUnlistened = true;
      };
    },
    destroy: async () => {
      calls.destroyed++;
    },
    close: async () => {
      calls.closed = true;
    },
  };
  const host = {
    __TAURI_INTERNALS__: {},
    __TAURI__: {
      core: {
        invoke: async (command, data, options) => {
          assert.equal(command, "save_file_atomic");
          const file = new TextDecoder().decode(
            Uint8Array.from(atob(options.headers["x-plasmidcraft-path"]), (c) =>
              c.charCodeAt(0),
            ),
          );
          calls.atomic = true;
          await host.__TAURI__.fs.writeFile(file, data);
        },
      },
      dialog: {
        open: async (options) => {
          calls.openOptions = options;
          return state.picked;
        },
        save: async (options) => {
          calls.saves++;
          calls.saveOptions = options;
          return state.savePath;
        },
        confirm: async () => {
          calls.confirmations++;
          return state.confirm;
        },
      },
      fs: {
        stat: async () => ({ size: state.size }),
        readFile: async (file) => {
          calls.reads.push(file);
          return state.bytes;
        },
        writeFile: async (file, bytes) => {
          calls.writes.push({ file, bytes });
        },
      },
      clipboardManager: {
        writeText: async (text) => {
          calls.copied = text;
        },
      },
      window: { getCurrentWindow: () => window },
      event: {
        listen: async (name, handler) => {
          calls.menuName = name;
          calls.menuHandler = handler;
          return () => {
            calls.menuUnlistened = true;
          };
        },
      },
    },
  };
  return { host, calls, state };
}
test("native Open reads only user-selected files and returns parser-compatible data", async () => {
  const { host, calls } = nativeHost(),
    platform = createPlatform(host);
  const [file] = await platform.pickFiles();
  assert.equal(platform.desktop, true);
  assert.equal(file.name, "test.gb");
  assert.deepEqual(calls.reads, ["/chosen/test.gb"]);
  assert.equal(new TextDecoder().decode(await file.arrayBuffer()), "ACGT");
  assert.ok(calls.openOptions.filters[0].extensions.includes("pcraft"));
});
test("native open cancellation never reads a file", async () => {
  const { host, calls, state } = nativeHost();
  state.picked = null;
  assert.deepEqual(await createPlatform(host).pickFiles(), []);
  assert.equal(calls.reads.length, 0);
});
test("native library import uses its own filters without expanding file access", async () => {
  const { host, calls, state } = nativeHost();
  state.picked = "/chosen/my-library.pclib";
  const filters = [
    { name: "Feature library", extensions: ["pclib", "csv", "json"] },
  ];
  const files = await createPlatform(host).pickFiles({
    filters,
    multiple: false,
  });
  assert.equal(calls.openOptions.multiple, false);
  assert.deepEqual(calls.openOptions.filters, filters);
  assert.deepEqual(calls.reads, ["/chosen/my-library.pclib"]);
  assert.equal(files[0].name, "my-library.pclib");
});
test("large native files are rejected before reading their contents", async () => {
  const { host, calls, state } = nativeHost();
  state.size = FILE_LIMIT + 1;
  const [file] = await createPlatform(host).pickFiles();
  assert.match(file.error, /50 MB/);
  assert.equal(calls.reads.length, 0);
});
test("native reads respect Uint8Array byte offsets", async () => {
  const { host, state } = nativeHost();
  state.bytes = new Uint8Array([0, 65, 67, 0]).subarray(1, 3);
  const [file] = await createPlatform(host).pickFiles();
  assert.equal(new TextDecoder().decode(await file.arrayBuffer()), "AC");
});
test("native Save waits for user selection and cancellation never writes", async () => {
  const { host, calls, state } = nativeHost(),
    platform = createPlatform(host);
  state.savePath = null;
  assert.equal(
    (await platform.saveFile("test.pcraft", "content")).saved,
    false,
  );
  assert.equal(calls.writes.length, 0);
  state.savePath = "/chosen/test.pcraft";
  const result = await platform.saveFile("test.pcraft", "content");
  assert.equal(result.path, state.savePath);
  assert.equal(new TextDecoder().decode(calls.writes[0].bytes), "content");
});
test("saving an existing chosen project uses its path; failures propagate", async () => {
  const { host, calls } = nativeHost(),
    platform = createPlatform(host);
  await platform.saveFile("test.pcraft", "text", {
    currentPath: "/chosen/existing.pcraft",
  });
  assert.equal(calls.saves, 0);
  assert.equal(calls.writes[0].file, "/chosen/existing.pcraft");
  host.__TAURI__.fs.writeFile = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(platform.saveFile("test.pcraft", "text"), /disk full/);
});
test("native clipboard and title use the Tauri bridge", async () => {
  const { host, calls } = nativeHost(),
    platform = createPlatform(host);
  await platform.copyText("ACGTN");
  await platform.setTitle("Example — PlasmidCraft");
  assert.equal(calls.copied, "ACGTN");
  assert.match(calls.title, /PlasmidCraft/);
});
test("unsaved native close is prevented until the user explicitly discards changes", async () => {
  const { host, calls, state } = nativeHost(),
    platform = createPlatform(host);
  let dirty = true,
    menu;
  const unlisten = await platform.install({
    hasUnsavedChanges: () => dirty,
    onMenu: (action) => {
      menu = action;
    },
  });
  const event = {
    preventDefault: () => {
      calls.prevented++;
    },
  };
  await calls.closeHandler(event);
  assert.equal(calls.prevented, 1);
  assert.equal(calls.destroyed, 0);
  state.confirm = true;
  await calls.closeHandler(event);
  assert.equal(calls.destroyed, 1);
  dirty = false;
  await calls.closeHandler(event);
  assert.equal(calls.prevented, 2);
  calls.menuHandler({ payload: "open" });
  assert.equal(menu, "open");
  unlisten();
  assert.equal(calls.closeUnlistened, true);
  assert.equal(calls.menuUnlistened, true);
});
test("a broken native bridge does not silently fall back to browser downloads", async () => {
  const platform = createPlatform({ __TAURI_INTERNALS__: {} });
  await assert.rejects(platform.pickFiles(), /desktop bridge is unavailable/);
});
test("a failed close confirmation keeps changes open and reports the error", async () => {
  const { host, calls } = nativeHost();
  const errors = [];
  host.__TAURI__.dialog.confirm = async () => {
    throw new Error("dialog unavailable");
  };
  await createPlatform(host).install({
    hasUnsavedChanges: () => true,
    onMenu: () => {},
    onError: (error) => errors.push(error.message),
  });
  await calls.closeHandler({
    preventDefault: () => {
      calls.prevented++;
    },
  });
  assert.equal(calls.prevented, 1);
  assert.equal(calls.destroyed, 0);
  assert.deepEqual(errors, ["dialog unavailable"]);
});
test("browser export keeps a local download workflow without any native APIs", async () => {
  let clicked = false,
    revoked;
  const link = {};
  const host = {
    Blob,
    URL: {
      createObjectURL: () => "blob:local",
      revokeObjectURL: (value) => {
        revoked = value;
      },
    },
    document: {
      createElement: () => ({
        ...link,
        click() {
          clicked = this.download;
        },
      }),
    },
    setTimeout: (fn) => fn(),
    confirm: () => true,
  };
  const platform = createPlatform(host);
  assert.equal(platform.desktop, false);
  assert.equal(
    (await platform.saveFile("example.gb", "local sequence")).saved,
    true,
  );
  assert.equal(clicked, "example.gb");
  assert.equal(revoked, "blob:local");
  assert.equal(await platform.confirmDiscard("Continue?"), true);
});

test("native binary exports preserve bytes and subarray offsets", async () => {
  const { host, calls } = nativeHost();
  const bytes = new Uint8Array([77, 0, 9, 255, 11]).subarray(1, 4);
  await createPlatform(host).saveFile("test.dna", bytes, {
    extensions: ["dna"],
  });
  assert.deepEqual([...calls.writes[0].bytes], [0, 9, 255]);
});

test("AI credentials go only to the explicit native connection; request transport carries no key", async () => {
  const { host } = nativeHost(),
    calls = [];
  host.__TAURI__.core = {
    invoke: async (command, args) => {
      calls.push({ command, args });
      return { provider: "openai", endpoint: "https://api.openai.com/v1" };
    },
  };
  const platform = createPlatform(host);
  await platform.aiConnect(
    {
      provider: "openai",
      endpoint: "https://api.openai.com/v1",
      apiKey: "synthetic-key",
    },
    { remember: true, model: "chosen-model" },
  );
  await platform.aiRequest({
    model: "chosen-model",
    system: "system",
    prompt: "user-approved context",
  });
  await platform.aiDisconnect();
  assert.equal(calls[0].command, "ai_connect");
  assert.equal(calls[0].args.connection.apiKey, "synthetic-key");
  assert.equal(calls[0].args.remember, true);
  assert.equal(calls[0].args.model, "chosen-model");
  assert.equal(calls[1].args.apiKey, undefined);
  assert.equal(calls[2].command, "ai_disconnect");
  await platform.aiRestoreSaved();
  await platform.aiForgetSaved();
  assert.equal(calls[3].command, "ai_restore_saved");
  assert.equal(calls[4].command, "ai_forget_saved");
  await platform.aiListModels({
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    apiKey: "synthetic-list-key",
  });
  await platform.aiListModels();
  assert.equal(calls[5].command, "ai_list_models");
  assert.equal(calls[5].args.connection.apiKey, "synthetic-list-key");
  assert.equal(calls[6].args.connection, null);
});

test("API bridge remembers connections by default, with an explicit session-only option", async () => {
  const calls = [];
  const platform = createPlatform({
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push({ command, args });
          return {};
        },
      },
    },
  });
  await platform.aiConnect(
    {
      provider: "compatible",
      endpoint: "http://localhost:1234/v1",
      apiKey: "synthetic-key",
    },
    { model: "local-model" },
  );
  await platform.aiConnect(
    {
      provider: "compatible",
      endpoint: "http://localhost:1234/v1",
      apiKey: "synthetic-key",
    },
    { remember: false, model: "local-model" },
  );
  assert.equal(calls[0].args.remember, true);
  assert.equal(calls[1].args.remember, false);
});

test("ChatGPT restore uses the native session without credentials in the renderer", async () => {
  const calls = [];
  const platform = createPlatform({
    __TAURI__: {
      core: {
        invoke: async (command, args) => {
          calls.push({ command, args });
          return { accounts: [], activeId: null };
        },
      },
    },
  });
  await platform.chatGPTRestore();
  assert.equal(calls[0].command, "chatgpt_restore");
  assert.deepEqual(calls[0].args, {});
});

test("OS-opened documents drain after listening, then import subsequent events", async () => {
  const { host, calls } = nativeHost();
  const handlers = {}, queue = [["/chosen/from Finder.pcraft"], ["/chosen/another.GB"], []];
  const order = [], imports = [];
  host.__TAURI__.event.listen = async (name, handler) => {
    order.push(name);
    handlers[name] = handler;
    return () => { delete handlers[name]; };
  };
  host.__TAURI__.core.invoke = async (command) => {
    assert.equal(command, "take_open_documents");
    order.push("drain");
    return queue.shift();
  };
  const cleanup = await createPlatform(host).install({
    hasUnsavedChanges: () => false, onMenu: () => {},
    onFiles: async (files) => imports.push(...files),
  });
  assert.ok(order.indexOf("plasmidcraft-open-documents") < order.indexOf("drain"));
  assert.equal(imports[0].name, "from Finder.pcraft");
  assert.equal(imports[0].sourcePath, "/chosen/from Finder.pcraft");
  assert.equal(new TextDecoder().decode(await imports[0].arrayBuffer()), "ACGT");
  await Promise.all([handlers["plasmidcraft-open-documents"](), handlers["plasmidcraft-open-documents"]()]);
  assert.equal(imports.length, 2);
  assert.equal(imports[1].name, "another.GB");
  assert.deepEqual(calls.reads, ["/chosen/from Finder.pcraft", "/chosen/another.GB"]);
  cleanup();
  assert.equal(handlers["plasmidcraft-open-documents"], undefined);
});

test("an unreadable OS-opened file reports its name and does not block later opens", async () => {
  const { host } = nativeHost();
  const handlers = {}, received = [], errors = [];
  const queue = [["/missing/file.gb"], ["/chosen/large.dna"], ["/chosen/ok.fa"]];
  let size = 4;
  host.__TAURI__.fs.stat = async () => ({ size });
  host.__TAURI__.fs.readFile = async (path) => {
    if (path.startsWith("/missing")) throw Error("File not found");
    return new Uint8Array([65, 67]);
  };
  host.__TAURI__.core.invoke = async () => queue.shift();
  host.__TAURI__.event.listen = async (name, handler) => {
    handlers[name] = handler;
    return () => {};
  };
  await createPlatform(host).install({
    hasUnsavedChanges: () => true, onMenu: () => {},
    onFiles: async (files) => received.push(...files), onError: (e) => errors.push(e),
  });
  assert.match(received[0].error, /File not found/);
  size = FILE_LIMIT + 1;
  await handlers["plasmidcraft-open-documents"]();
  assert.match(received[1].error, /50 MB/);
  size = 4;
  await handlers["plasmidcraft-open-documents"]();
  assert.equal(received[2].name, "ok.fa");
  assert.equal(received[2].error, undefined);
  assert.deepEqual(errors, []);
});

test("native document registrations cover sequence types without taking text-file defaults", async () => {
  const { readFile } = await import("node:fs/promises");
  const { types } = await import("../scripts/build-file-associations.mjs");
  const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url)));
  const windows = JSON.parse(await readFile(new URL("../src-tauri/tauri.windows.conf.json", import.meta.url)));
  const plist = await readFile(new URL("../src-tauri/file-associations/Info.plist", import.meta.url), "utf8");
  const nsis = await readFile(new URL("../src-tauri/file-associations/windows.nsh", import.meta.url), "utf8");
  const mime = await readFile(new URL("../src-tauri/file-associations/mime.xml", import.meta.url), "utf8");
  assert.deepEqual(windows.bundle.fileAssociations, []);
  assert.equal(config.version, "0.4.0");
  assert.equal(config.bundle.macOS.infoPlist, "file-associations/Info.plist");
  assert.equal(config.bundle.resources["icons/document.icns"], "document.icns");
  assert.equal(config.bundle.resources["icons/document.ico"], "document.ico");
  for (const t of types) {
    assert.ok(plist.includes(`<string>${t.name}</string>`));
    assert.ok(nsis.includes(`PlasmidCraft.${t.id}\\DefaultIcon`));
    assert.ok(config.bundle.linux.deb.files[`/usr/share/icons/hicolor/512x512/mimetypes/${t.mime.replaceAll("/", "-")}.png`]);
    for (const ext of t.ext) {
      assert.ok(plist.includes(`<string>${ext}</string>`));
      assert.ok(mime.includes(`pattern="*.${ext}"`));
      assert.ok(nsis.includes(`.${ext}\\OpenWithProgids`));
      assert.notEqual(ext, "txt");
    }
  }
  assert.equal((plist.match(/<key>CFBundleTypeIconFile<\/key>/g) || []).length, types.length);
  assert.equal((plist.match(/<key>LSItemContentTypes<\/key>/g) || []).length, 2);
  assert.ok(!plist.includes("UTImportedTypeDeclarations"));
  assert.ok(!nsis.includes("UserChoice"));
  assert.ok(!nsis.includes('WriteRegStr SHCTX "Software\\Classes\\.pcraft" ""'));
});
