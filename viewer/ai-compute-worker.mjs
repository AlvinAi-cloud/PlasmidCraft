import { evaluateSequenceCode } from "./ai-compute-engine.mjs";
self.onmessage = async ({ data }) => {
  try {
    const result = await evaluateSequenceCode(data.code, data.input);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: String(error.message || error).slice(0, 1200) });
  }
};
