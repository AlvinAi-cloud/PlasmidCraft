// Shared engine selection: WebKit exercises the macOS renderer family;
// Chromium exercises the Windows WebView2 renderer family.
import { syntheticTestRecord } from "./fixtures/synthetic-plasmid.mjs";
import os from "node:os";
import path from "node:path";
const engines = await import(
  process.env.PLASMIDCRAFT_PLAYWRIGHT_PATH || "playwright"
);
const engine = process.env.PLASMIDCRAFT_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(engine))
  throw new Error(`Unknown UI engine: ${engine}`);
export const chromium = engines[engine];
export const testOutput = (name) =>
  path.join(process.env.PLASMIDCRAFT_TEST_OUTPUT || os.tmpdir(), name);

// Regression suites explicitly use artificial test data, independent of the
// shipped biological example. default-example-ui-smoke uses an unmodified page.
export async function fixturePage(browser, options) {
  const page = await browser.newPage(options);
  await page.route("**/default-example.mjs", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export function defaultExampleRecord() { return ${JSON.stringify(syntheticTestRecord())}; }`,
    }),
  );
  return page;
}
