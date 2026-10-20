import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { HELP_GUIDES } from "../viewer/help-content.mjs";
import { HELP_CATALOG } from "../viewer/help-catalog.mjs";
import { renderHelp, guideLink } from "../viewer/help-markdown.mjs";
test("offline manual matches canonical guides and bundled local images", async () => {
  assert.equal(HELP_GUIDES.length, HELP_CATALOG.length);
  for (const guide of HELP_GUIDES) {
    assert.equal(
      guide.markdown,
      await fs.readFile(new URL("../" + guide.source, import.meta.url), "utf8"),
      `Run pnpm help:build after editing ${guide.source}`,
    );
    for (const [href, image] of Object.entries(guide.images)) {
      assert.match(image, /^data:image\/(png|jpeg|gif);base64,/);
      assert.deepEqual(
        Buffer.from(image.split(",")[1], "base64"),
        await fs.readFile(
          new URL(href, new URL("../" + guide.source, import.meta.url)),
        ),
        `Run pnpm help:build after updating a screenshot in ${guide.source}`,
      );
    }
  }
});
test("guide rendering keeps instructions, tables, headings and offline cross-links", () => {
  const guide = HELP_GUIDES[0],
    { html, headings } = renderHelp(guide, HELP_GUIDES);
  assert.match(html, /pET-21b\(\+\)/);
  assert.match(html, /<table>/);
  assert.match(html, /data-help-guide="mutagenesis"/);
  assert.ok(headings.some((h) => h.anchor === "choose-a-workflow"));
  const features = HELP_GUIDES.find((g) => g.id === "features");
  assert.deepEqual(
    guideLink(
      "FEATURE_CATALOG_AND_EXCHANGE.md#import-features-from-an-existing-snapgene-installation",
      guide,
      HELP_GUIDES,
    ),
    {
      id: features.id,
      anchor: "import-features-from-an-existing-snapgene-installation",
    },
  );
  assert.deepEqual(guideLink("../PRIVACY.md", guide, HELP_GUIDES), {
    id: "privacy",
    anchor: "",
  });
});
test("help does not execute HTML or unsafe links and keeps unique section anchors", () => {
  const guide = {
    source: "docs/test.md",
    markdown:
      "# Title\n## Repeat\n## Repeat\n<script>alert(1)</script> [bad](javascript:alert) [reference](https://example.org/) ![remote](https://example.org/x.png)\n\n```\n<img onerror=evil>\n```",
  };
  const { html, headings } = renderHelp(guide, [guide]);
  assert.doesNotMatch(html, /<script|<img|href="javascript:|src="https:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data-help-copy="https:\/\/example.org\/"/);
  assert.deepEqual(
    headings.map((h) => h.anchor),
    ["title", "repeat", "repeat-1"],
  );
});
test("every local document link in the bundled manual resolves offline", () => {
  for (const guide of HELP_GUIDES)
    for (const m of guide.markdown.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
      if (!/\.md(?:#|$)/i.test(m[1]) || /^[a-z]+:/i.test(m[1])) continue;
      assert.ok(
        guideLink(m[1], guide, HELP_GUIDES)?.id,
        `${guide.source}: ${m[1]}`,
      );
    }
});
