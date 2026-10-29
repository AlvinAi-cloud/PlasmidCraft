import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PLASMIDCRAFT_PORT || 4317);
const types = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".gb": "text/plain; charset=utf-8",
  ".fasta": "text/plain; charset=utf-8",
};
const server = http.createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405);
    response.end("Method not allowed");
    return;
  }
  try {
    let pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    if (pathname.includes("\0")) throw new Error("Invalid path");
    const base = pathname.startsWith("/examples/")
      ? path.join(root, "examples")
      : path.join(root, "viewer");
    if (pathname.startsWith("/examples/"))
      pathname = pathname.slice("/examples".length);
    if (pathname === "/") pathname = "/index.html";
    const target = path.resolve(base, "." + pathname);
    if (!target.startsWith(base + path.sep)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const data = await fs.readFile(target);
    response.writeHead(200, {
      "Content-Type": types[path.extname(target)] || "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch {
    response.writeHead(404);
    response.end("File not found");
  }
});
server.on("error", (error) => {
  console.error(`Cannot start viewer: ${error.message}`);
  if (error.code === "EADDRINUSE")
    console.error("Choose another port with PLASMIDCRAFT_PORT=4318.");
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`PlasmidCraft: ${url}`);
  console.log("Files stay on this device. Press Ctrl+C to stop.");
  if (process.argv.includes("--open")) {
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "cmd"
          : "xdg-open";
    const args =
      process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => console.log(`Open ${url} in your browser.`));
    child.unref();
  }
});
