import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

async function launch(
  t,
  { key = "PATH", windows = false, localCargo = false, exitCode = 0 } = {},
) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "plasmidcraft-launcher-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "scripts"));
  const launcher = path.join(root, "scripts/desktop.mjs");
  await fs.copyFile(
    new URL("../scripts/desktop.mjs", import.meta.url),
    launcher,
  );
  const cli = path.join(root, "node_modules/@tauri-apps/cli");
  await fs.mkdir(cli, { recursive: true });
  await fs.writeFile(
    path.join(cli, "tauri.js"),
    `
    const keys = Object.keys(process.env).filter(k => k.toUpperCase() === "PATH");
    console.log(JSON.stringify({
      keys,
      searchPath: process.env[keys[0]],
      cargoHome: process.env.CARGO_HOME,
      rustupHome: process.env.RUSTUP_HOME,
      inherited: process.env.PLASMIDCRAFT_TEST_INHERITED,
      args: process.argv.slice(2)
    }));
    process.exit(Number(process.env.PLASMIDCRAFT_TEST_EXIT));
  `,
  );
  if (localCargo) {
    const bin = path.join(root, ".tooling/cargo/bin");
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(
      path.join(bin, windows ? "cargo.exe" : "cargo"),
      "fixture",
    );
  }
  const sentinel = path.join(root, "inherited cargo bin");
  // Run the real launcher in isolation. Only its platform lookup is simulated
  // on non-Windows hosts; CI also exercises these cases on actual Windows.
  const bootstrap = `
    import "node:child_process";
    import path from "node:path";
    import { pathToFileURL } from "node:url";
    const config = JSON.parse(process.argv[1]);
    const env = { ...process.env };
    const oldKey = Object.keys(env).find(k => k.toUpperCase() === "PATH");
    const original = oldKey ? env[oldKey] : "";
    for (const key of Object.keys(env))
      if (key.toUpperCase() === "PATH") delete env[key];
    env[config.key] = [config.sentinel, original].filter(Boolean).join(path.delimiter);
    env.PLASMIDCRAFT_TEST_INHERITED = "preserved";
    env.PLASMIDCRAFT_TEST_EXIT = String(config.exitCode);
    process.env = env;
    if (config.windows) Object.defineProperty(process, "platform", { value: "win32" });
    process.argv = [process.execPath, config.launcher, "info", "--ci"];
    await import(pathToFileURL(config.launcher));
  `;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      bootstrap,
      JSON.stringify({ launcher, key, windows, sentinel, exitCode }),
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, exitCode, result.stderr);
  return { ...JSON.parse(result.stdout.trim()), root, sentinel };
}

test("desktop launcher preserves the native inherited executable search path", async (t) => {
  const key = process.platform === "win32" ? "Path" : "PATH";
  const result = await launch(t, { key });
  assert.equal(result.keys.length, 1);
  assert.ok(result.searchPath.includes(result.sentinel));
  assert.equal(result.inherited, "preserved");
  assert.deepEqual(result.args, ["info", "--ci"]);
});

for (const key of ["Path", "PATH"]) {
  test(`Windows desktop launcher keeps Cargo's inherited ${key} without duplicate keys`, async (t) => {
    const result = await launch(t, { key, windows: true });
    assert.equal(result.keys.length, 1);
    assert.ok(result.searchPath.includes(result.sentinel));
    assert.ok(result.searchPath.includes(path.dirname(process.execPath)));
    assert.equal(result.inherited, "preserved");
  });
}

test("Windows desktop launcher recognizes local cargo.exe and retains inherited tools", async (t) => {
  const result = await launch(t, {
    key: "Path",
    windows: true,
    localCargo: true,
  });
  assert.equal(result.keys.length, 1);
  assert.ok(
    result.searchPath.startsWith(
      path.join(result.root, ".tooling/cargo/bin") + path.delimiter,
    ),
  );
  assert.ok(result.searchPath.includes(result.sentinel));
  assert.equal(result.cargoHome, path.join(result.root, ".tooling/cargo"));
  assert.equal(result.rustupHome, path.join(result.root, ".tooling/rustup"));
});

test("desktop launcher propagates a failing CLI exit code", async (t) => {
  await launch(t, { exitCode: 7 });
});
