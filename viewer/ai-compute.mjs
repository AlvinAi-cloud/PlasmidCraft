export function runSequenceCode(code, input, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Computation stopped."));
    const worker = new Worker(new URL("./ai-compute-worker.mjs", import.meta.url), { type: "module" });
    let timer;
    const finish = (error, result) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new Error("Computation stopped."));
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(new Error("Custom computation exceeded its time limit.")), 12000);
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.result);
    worker.onerror = () => finish(new Error("The custom computation runtime could not start."));
    worker.postMessage({ code, input });
  });
}
