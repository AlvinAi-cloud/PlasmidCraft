import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { TOOL_MENUS } from "../viewer/tool-menus.mjs";
test("focused toolbar commands remain available in the unchanged native and renderer Tools menus", async () => {
  const native = await fs.readFile(
    new URL("../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  const html = await fs.readFile(
    new URL("../viewer/index.html", import.meta.url),
    "utf8",
  );
  const block = native
    .slice(native.indexOf("let tools ="))
    .split(".build()?;")[0];
  const nativeCommands = [
    ...block.matchAll(/\.text\("([^"]+)", "([^"]+)"\)/g),
  ].map((m) => m.slice(1));
  const toolsHTML = html.slice(
    html.indexOf('id="app-tools-menu"'),
    html.indexOf('id="app-ai-menu"'),
  );
  const commands = Object.values(TOOL_MENUS)
    .flat(2)
    .map((row) => row[0]);
  assert.equal(
    new Set(commands).size,
    commands.length,
    "each toolbar command has one primary category",
  );
  for (const item of Object.values(TOOL_MENUS).flat(2)) {
    assert.ok(
      nativeCommands.some(
        ([command, label]) => command === item[0] && label === item[1],
      ),
    );
    assert.ok(toolsHTML.includes(`data-command="${item[0]}"`));
  }
  assert.equal(TOOL_MENUS.analyze[0][0][0], "auto-annotation");
  assert.ok(!commands.includes("feature-libraries"));
  assert.equal(nativeCommands[0][0], "feature-libraries");
  assert.ok(!native.includes('SubmenuBuilder::new(app, "Analyze")'));
  assert.ok(!native.includes('SubmenuBuilder::new(app, "Design")'));
});
