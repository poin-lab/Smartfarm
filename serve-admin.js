// Tiny local-only static server for admin.html. Exists so the dev console
// has a real http://localhost origin instead of file:// — Chrome's Private
// Network Access policy blocks file:// pages from fetching localhost APIs
// even when the server's CORS headers are correct. Serves nothing else, and
// only binds to 127.0.0.1 (never reachable from outside this machine).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, "admin.html");
const port = Number(process.env.ADMIN_CONSOLE_PORT) || 4101;

// When someone opens this console through its own public tunnel, their
// browser's "localhost" is their own machine, not ours — so the default API
// base has to point at the app's public URL instead, when we know it.
const appPublicUrl = process.env.APP_PUBLIC_URL;

createServer(async (_req, res) => {
  try {
    let html = await readFile(file, "utf8");
    if (appPublicUrl)
      html = html.replace(
        'value="http://localhost:4100"',
        `value="${appPublicUrl}"`,
      );
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(String(error));
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`admin console: http://localhost:${port}/`);
});
