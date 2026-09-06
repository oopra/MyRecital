// Shared test harness: a tiny static file server + a Playwright Chromium launcher.
// No external server needed — we serve the repo root ourselves, which is all this app
// needs: it is static files and nothing else.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

export async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      // prevent path traversal
      const safe = normalize(p).replace(/^(\.\.[/\\])+/, '');
      const file = join(ROOT, safe);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  return { url: `http://localhost:${port}`, close: () => new Promise((r) => server.close(r)) };
}

export async function launchBrowser() {
  const opts = {};
  // In this dev sandbox point at the preinstalled Chromium; in CI Playwright manages it.
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opts);
}
