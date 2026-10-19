import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prepareFixtures } from "./fetch-test-fixtures.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(
  process.env.PLASMIDCRAFT_TEST_OUTPUT || path.join(root, "test-results"),
);
await fs.mkdir(output, { recursive: true });
const env = { ...process.env, PLASMIDCRAFT_TEST_OUTPUT: output };
env.PLASMIDCRAFT_REFERENCE_DIR = await prepareFixtures(
  path.resolve(
    env.PLASMIDCRAFT_REFERENCE_DIR || path.join(output, "reference"),
  ),
  Boolean(env.PLASMIDCRAFT_REFERENCE_DIR),
);
if (env.PLASMIDCRAFT_BROWSER === "webkit") delete env.PLASMIDCRAFT_CHROME;
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  cwd: root,
  env: { ...env, PLASMIDCRAFT_PORT: "0" },
  stdio: ["ignore", "pipe", "inherit"],
});
try {
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Test server did not start")),
      10000,
    );
    server.stdout.on("data", (data) => {
      const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Test server exited: ${code}`));
    });
  });
  const tests = (await fs.readdir(path.join(root, "tests")))
    .filter((name) =>
      /(?:-ui-smoke|browser-smoke|desktop-bridge-smoke)\.mjs$/.test(name),
    )
    .filter(
      (name) =>
        !env.PLASMIDCRAFT_SUITE ||
        env.PLASMIDCRAFT_SUITE.split(",").some((s) => name.includes(s)),
    );
  if (!tests.length) throw new Error("No matching UI suites");
  for (const file of tests) {
    console.log(`\n${env.PLASMIDCRAFT_BROWSER || "chromium"}: ${file}`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join("tests", file)], {
        cwd: root,
        env: { ...env, PLASMIDCRAFT_URL: url },
        stdio: "inherit",
      });
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`${file} timed out`));
      }, 180000);
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        code === 0 ? resolve() : reject(new Error(`${file} failed (${code})`));
      });
    });
  }
  console.log(`All ${tests.length} UI suites passed. Screenshots: ${output}`);
} finally {
  server.kill("SIGTERM");
}
