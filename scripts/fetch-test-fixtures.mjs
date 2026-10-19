// Public development fixtures only; never included in the application bundle.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function prepareFixtures(destination, offline = false) {
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(root, "tests/fixtures/reference-downloads.json"),
      "utf8",
    ),
  );
  await fs.mkdir(destination, { recursive: true });
  for (const entry of manifest.files) {
    const target = path.join(destination, path.basename(entry.path));
    const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
    let bytes = await fs.readFile(target).catch(() => null);
    if (bytes && hash(bytes) === entry.sha256) continue;
    if (offline)
      throw new Error(`Missing or changed reference fixture: ${target}`);
    const url = `https://raw.githubusercontent.com/biopython/biopython/${manifest.ref}/Tests/${entry.path}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok)
      throw new Error(
        `Fixture download failed (${response.status}): ${entry.path}`,
      );
    bytes = new Uint8Array(await response.arrayBuffer());
    if (hash(bytes) !== entry.sha256)
      throw new Error(`Fixture checksum mismatch: ${entry.path}`);
    await fs.writeFile(target, bytes);
  }
  return destination;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const destination = path.resolve(
    process.argv[2] || path.join(root, "test-results/reference"),
  );
  await prepareFixtures(destination);
  console.log(`Verified reference fixtures: ${destination}`);
}
