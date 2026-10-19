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
const environment = { ...process.env };
environment.PATH = [path.dirname(process.execPath), environment.PATH].join(
  path.delimiter,
);
const localCargo = path.join(root, ".tooling/cargo");
if (fs.existsSync(path.join(localCargo, "bin/cargo"))) {
  environment.CARGO_HOME = localCargo;
  environment.RUSTUP_HOME = path.join(root, ".tooling/rustup");
  environment.PATH = [path.join(localCargo, "bin"), environment.PATH].join(
    path.delimiter,
  );
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
