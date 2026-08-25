import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv; charset=utf-8"
};

async function tryListen(server, port, attemptsLeft) {
  return new Promise((res, rej) => {
    server.once("error", (e) => {
      if (e.code === "EADDRINUSE" && attemptsLeft > 0) res(tryListen(server, port + 1, attemptsLeft - 1).then((p) => p));
      else rej(e);
    });
    server.listen(port, () => res(port));
  });
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(normalize(ROOT))) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    const st = await stat(file);
    const target = st.isDirectory() ? join(file, "index.html") : file;
    const body = await readFile(target);
    res.writeHead(200, { "Content-Type": MIME[extname(target).toLowerCase()] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("Not Found");
  }
});

const port = await tryListen(server, Number(process.argv[2]) || 5173, 10);
console.log("");
console.log("  ZISWAF Demo Converter berjalan.");
console.log(`  Buka di browser:  http://localhost:${port}`);
console.log("  Tekan Ctrl+C untuk berhenti.");
console.log("");