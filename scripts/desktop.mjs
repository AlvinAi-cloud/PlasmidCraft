import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "dev";
if (!["dev", "build", "info", "icon"].includes(command)) {
  throw new Error("Use desktop.mjs dev, build, info, or icon.");
}
const cli = path.join(root, "node_modules/@tauri-apps/cli/tauri.js");
if (process.platform === "darwin" && ["dev", "build"].includes(command)) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "clang"], {
    encoding: "utf8",
  });
  if (compiler.status !== 0) {
    console.error(
      compiler.stderr?.trim() || "Apple compiler tools are unavailable.",
    );
    console.error(
      "Complete Xcode setup before building. If its license is pending, review it in Terminal with: sudo xcodebuild -license",
    );
    console.error(
      "Complete the native desktop prerequisites before launching PlasmidCraft.",
    );
    process.exit(1);
  }
}
if (!fs.existsSync(cli)) {
  console.error("Desktop dependencies are missing. Run npm install first.");
  process.exit(1);
}
if (["dev", "build"].includes(command)) {
  const help = spawnSync(process.execPath, ["scripts/build-help.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  if (help.status !== 0) process.exit(help.status ?? 1);
}
const environment = { ...process.env };
// Windows environment keys are case-insensitive, but this copied object is not.
// Reuse Path/PATH so spawning Node does not discard Cargo's inherited search path.
const pathKey =
  process.platform === "win32"
    ? Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ||
      "Path"
    : "PATH";
environment[pathKey] = [path.dirname(process.execPath), environment[pathKey]]
  .filter(Boolean)
  .join(path.delimiter);
const localCargo = path.join(root, ".tooling/cargo");
const cargoExecutable = process.platform === "win32" ? "cargo.exe" : "cargo";
if (fs.existsSync(path.join(localCargo, "bin", cargoExecutable))) {
  environment.CARGO_HOME = localCargo;
  environment.RUSTUP_HOME = path.join(root, ".tooling/rustup");
  environment[pathKey] = [
    path.join(localCargo, "bin"),
    environment[pathKey],
  ].join(path.delimiter);
}
const args = [cli, command, ...process.argv.slice(3)];
const child = spawn(process.execPath, args, {
  cwd: root,
  env: environment,
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
