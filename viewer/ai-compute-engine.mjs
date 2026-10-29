// Guest JavaScript runs in QuickJS/WASM, without any host API bindings.
import { createRuntime } from "./vendor/quickjs.mjs";
let engine;
export async function evaluateSequenceCode(code, input, { timeoutMs = 5000 } = {}) {
  if (typeof code !== "string" || !code.trim() || code.length > 30000)
    throw new Error("Provide JavaScript function-body code up to 30,000 characters.");
  const data = JSON.stringify(input);
  if (data.length > 2000000) throw new Error("Computation input is too large.");
  const quickjs = await (engine ||= createRuntime());
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + Math.min(5000, Math.max(10, timeoutMs));
  let interrupts = 0;
  runtime.setInterruptHandler(() => Date.now() > deadline || ++interrupts > 50000);
  const context = runtime.newContext();
  let result;
  try {
    result = context.evalCode(`"use strict";
const input = JSON.parse(${JSON.stringify(data)});
const output = (function(input) { ${code}\n})(input);
if (output && typeof output.then === "function") throw Error("Return synchronous JSON results; promises are unsupported.");
const encoded = JSON.stringify(output);
if (typeof encoded !== "string" || encoded.length > 2000000) throw Error("Return a JSON object up to 2 MB.");
encoded;`, "ai-sequence-computation.js", { type: "global" });
    if (result.error) {
      const error = context.dump(result.error);
      throw new Error(`Custom computation failed: ${String(error?.message || error).slice(0, 1000)}`);
    }
    if (context.typeof(result.value) !== "string") throw new Error("Return JSON computation results.");
    const encoded = context.getString(result.value);
    if (encoded.length > 2000000) throw new Error("Computation output is too large.");
    return JSON.parse(encoded);
  } finally {
    result?.dispose();
    context.dispose();
    runtime.dispose();
  }
}
