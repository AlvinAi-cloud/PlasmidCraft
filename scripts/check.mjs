import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let count = 0,
  failed = false;
for (const folder of ["viewer", "scripts"])
  for (const name of await fs.readdir(path.join(root, folder))) {
    if (!name.endsWith(".mjs")) continue;
    const result = spawnSync(
      process.execPath,
      ["--check", path.join(root, folder, name)],
      { encoding: "utf8" },
    );
    count++;
    if (result.status !== 0) {
      failed = true;
      process.stderr.write(
        result.stderr || `${folder}/${name}: syntax check failed\n`,
      );
    }
  }
if (failed) process.exitCode = 1;
else console.log(`${count} JavaScript module syntax checks passed.`);
