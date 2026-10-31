// Publish only installer artifacts built and tested from this exact tagged commit.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
assert.equal(config.version, pkg.version);
const version = pkg.version;
const tag = `v${version}`;
const replaceAssets = process.argv.includes("--replace-assets");
const targets = [
  ["aarch64-apple-darwin", ".dmg", `PlasmidCraft-${version}-macOS-arm64.dmg`],
  ["x86_64-apple-darwin", ".dmg", `PlasmidCraft-${version}-macOS-x64.dmg`],
  [
    "x86_64-pc-windows-msvc",
    ".exe",
    `PlasmidCraft-${version}-Windows-x64-setup.exe`,
  ],
  [
    "Linux-x86_64",
    ".deb",
    `PlasmidCraft-${version}-Linux-amd64.deb`,
  ],
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (process.argv.includes("--check")) {
  assert.ok(
    fs
      .readFileSync("RELEASE_NOTES.md", "utf8")
      .includes(version.replace(/\.0$/, "")),
  );
  console.log(
    `Release configuration valid: ${tag}; ${targets.length} installer targets.`,
  );
  process.exit(0);
}
assert.equal(
  replaceAssets ? process.env.PLASMIDCRAFT_RELEASE_TAG : process.env.GITHUB_REF_NAME,
  tag,
  "Release tag must match the application version",
);
const repo = process.env.GITHUB_REPOSITORY;
assert.match(repo || "", /^[\w.-]+\/[\w.-]+$/);
assert.ok(process.env.GH_TOKEN, "GitHub release token is required");
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (replaceAssets) {
  assert.match(process.env.PLASMIDCRAFT_BUILD_SHA || "", /^[a-f0-9]{40}$/);
  assert.equal(sha, process.env.PLASMIDCRAFT_BUILD_SHA, "Checkout must match the requested verified build commit");
}
const api = process.env.GITHUB_API_URL || "https://api.github.com";
async function json(route) {
  const response = await fetch(`${api}/repos/${repo}/${route}`, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`GitHub API request failed (${response.status})`);
  return response.json();
}
const runs = new Map();
const deadline = Date.now() + 60 * 60 * 1000;
let previous = "";
while (Date.now() < deadline) {
  for (const workflow of ["desktop.yml", "linux-deb.yml"]) {
    if (runs.has(workflow)) continue;
    const result = await json(
      `actions/workflows/${workflow}/runs?head_sha=${sha}&event=push&branch=main&per_page=10`,
    );
    const run = result?.workflow_runs.find(
      (r) =>
        r.head_sha === sha && r.event === "push" && r.head_branch === "main",
    );
    if (!run) continue;
    if (run.status === "completed") {
      assert.equal(
        run.conclusion,
        "success",
        `${workflow} failed; release will not be published`,
      );
      runs.set(workflow, run);
    }
  }
  const status = [...runs.keys()].join(", ");
  if (status !== previous) {
    console.log(`Verified successful workflows: ${status}`);
    previous = status;
  }
  if (runs.size === 2) break;
  await new Promise((resolve) => setTimeout(resolve, 20000));
}
assert.equal(
  runs.size,
  2,
  "Timed out waiting for successful native/renderer builds for this commit",
);
const manifest = JSON.parse(fs.readFileSync("SOURCE_MANIFEST.json", "utf8"));
assert.equal(manifest.version, version);
for (const entry of manifest.files)
  assert.equal(
    hash(fs.readFileSync(entry.path)),
    entry.sha256,
    `Source hash mismatch: ${entry.path}`,
  );
const out = "release-assets";
fs.mkdirSync(out, { recursive: true });
const downloads = fs.mkdtempSync(
  path.join(process.env.RUNNER_TEMP || "/tmp", "pcraft-release-"),
);
const evidence = [];
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
}
for (const [target, extension, filename] of targets) {
  const workflow =
    target === "Linux-x86_64" ? "linux-deb.yml" : "desktop.yml";
  const run = runs.get(workflow);
  const data = await json(`actions/runs/${run.id}/artifacts?per_page=100`);
  const artifact = data.artifacts.find(
    (a) => a.name === `PlasmidCraft-${version}-${target}` && !a.expired,
  );
  assert.ok(artifact, `Missing installer artifact: ${target}`);
  const dest = path.join(downloads, target);
  execFileSync(
    "gh",
    [
      "run",
      "download",
      String(run.id),
      "-R",
      repo,
      "-n",
      artifact.name,
      "-D",
      dest,
    ],
    { stdio: "inherit" },
  );
  const installers = walk(dest).filter((file) => file.endsWith(extension));
  assert.equal(
    installers.length,
    1,
    `Expected one ${extension} installer for ${target}`,
  );
  const bytes = fs.readFileSync(installers[0]);
  assert.ok(bytes.length > 1_000_000, "Installer is unexpectedly small");
  if (extension === ".dmg")
    assert.equal(bytes.subarray(-512, -508).toString(), "koly");
  if (extension === ".exe") assert.equal(bytes.subarray(0, 2).toString(), "MZ");
  if (extension === ".deb") {
    assert.equal(bytes.subarray(0,8).toString(), "!<arch>\n");
    assert.equal(execFileSync("dpkg-deb", ["-f",installers[0],"Version"], {encoding:"utf8"}).trim(),version);
    assert.equal(execFileSync("dpkg-deb", ["-f",installers[0],"Architecture"], {encoding:"utf8"}).trim(),"amd64");
  }
  fs.copyFileSync(installers[0], path.join(out, filename));
  evidence.push(`${filename}: ${run.html_url} (artifact ${artifact.id})`);
}
const sourceName = `PlasmidCraft-${version}-GitHub-source.zip`;
execFileSync("git", [
  "archive",
  "--format=zip",
  `--output=${path.join(out, sourceName)}`,
  "HEAD",
]);
fs.copyFileSync("docs/INSTALLING.md", path.join(out, "INSTALLING.md"));
fs.writeFileSync(
  path.join(out, "BUILD_REPORT.txt"),
  `PlasmidCraft ${version}\nCommit: ${sha}\nTag: ${tag}\n\nAll renderer, JavaScript and native build/test workflows succeeded for this commit.\nSource inventory: ${manifest.files.length} SHA-256 hashes verified.\n\n${evidence.join("\n")}\n\nMac bundles are ad-hoc signed, not notarized. Windows is unsigned. Linux startup is checked under Xvfb; hardware/installation acceptance beyond CI remains a separate check. No experimental biological performance is implied.\n`,
);
const files = fs
  .readdirSync(out)
  .filter((name) => name !== "SHA256SUMS.txt")
  .sort();
fs.writeFileSync(
  path.join(out, "SHA256SUMS.txt"),
  files
    .map((name) => `${hash(fs.readFileSync(path.join(out, name)))}  ${name}`)
    .join("\n") + "\n",
);
const existing = await json(`releases/tags/${tag}`);
if (replaceAssets) {
  assert.ok(existing && !existing.draft, "An existing published release is required for asset refresh");
  // Keep a recoverable copy before replacing any downloadable asset.
  fs.mkdirSync("previous-release-assets", { recursive: true });
  execFileSync("gh", ["release", "download", tag, "-R", repo, "-D", "previous-release-assets"], { stdio: "inherit" });
  fs.appendFileSync(path.join(out, "BUILD_REPORT.txt"), "\nRelease assets refreshed in place. The existing version tag is preserved; these installers and the attached source ZIP correspond to the commit above.\n");
  // BUILD_REPORT changed; regenerate the complete checksum list before upload.
  fs.writeFileSync(path.join(out, "SHA256SUMS.txt"), files.map((name) => `${hash(fs.readFileSync(path.join(out, name)))}  ${name}`).join("\n") + "\n");
  execFileSync("gh", ["release", "upload", tag, "-R", repo, "--clobber", ...fs.readdirSync(out).sort().map((name) => path.join(out, name))], { stdio: "inherit" });
  const notesPath = path.join(downloads, "updated-release-notes.md");
  fs.writeFileSync(notesPath, fs.readFileSync("RELEASE_NOTES.md", "utf8") + `\nUpdated downloads include the file-icon and OS file-opening update built from commit ${sha}. The original version tag is preserved; use the attached source ZIP for the exact updated installer source.\n`);
  execFileSync("gh", ["release", "edit", tag, "-R", repo, "--notes-file", notesPath], { stdio: "inherit" });
  const published = await json(`releases/tags/${tag}`);
  for (const name of [...files, "SHA256SUMS.txt"]) {
    const asset = published.assets.find((a) => a.name === name);
    assert.ok(asset, `Missing published asset: ${name}`);
    assert.equal(asset.size, fs.statSync(path.join(out, name)).size);
    assert.equal(asset.digest, `sha256:${hash(fs.readFileSync(path.join(out, name)))}`, `Published digest mismatch: ${name}`);
  }
  console.log(`Refreshed verified release assets: https://github.com/${repo}/releases/tag/${tag}`);
  process.exit(0);
}
if (existing)
  throw new Error(
    `Release ${tag} already exists; preserve it and review before replacing assets`,
  );
// Upload everything while the release is a draft; only then make it visible.
execFileSync(
  "gh",
  [
    "release",
    "create",
    tag,
    "-R",
    repo,
    "--verify-tag",
    "--draft",
    "--prerelease",
    "--title",
    `PlasmidCraft ${version.replace(/\.0$/, "")}`,
    "--notes-file",
    "RELEASE_NOTES.md",
  ],
  { stdio: "inherit" },
);
execFileSync(
  "gh",
  [
    "release",
    "upload",
    tag,
    "-R",
    repo,
    ...fs
      .readdirSync(out)
      .sort()
      .map((name) => path.join(out, name)),
  ],
  { stdio: "inherit" },
);
execFileSync(
  "gh",
  ["release", "edit", tag, "-R", repo, "--draft=false", "--prerelease"],
  { stdio: "inherit" },
);
console.log(
  `Published verified release: https://github.com/${repo}/releases/tag/${tag}`,
);
