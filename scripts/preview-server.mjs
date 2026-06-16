// Local preview/dev server. Serves the self-contained standalone review page
// (dist/standalone/index.html), which renders Markdown client-side using the
// same shared renderer the VS Code webview uses. Run `npm run preview` (which
// builds first) and open http://localhost:4173.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const samplesDir = join(rootDir, 'samples');
const standaloneHtml = join(rootDir, 'dist', 'standalone', 'index.html');
const port = Number(process.env.PORT ?? 4173);

const contentTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function serveStandalone(res) {
  if (!existsSync(standaloneHtml)) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dist/standalone/index.html not found. Run `node esbuild.js` first.');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(standaloneHtml));
}

createServer((req, res) => {
  const pathname = decodeURIComponent(
    new URL(req.url, `http://localhost:${port}`).pathname
  );

  if (pathname.startsWith('/assets/')) {
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(samplesDir, safePath);
    if (existsSync(filePath)) {
      const type =
        contentTypes[extname(filePath).toLowerCase()] ??
        'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(readFileSync(filePath));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  serveStandalone(res);
}).listen(port, () => {
  console.log(`Preview server running at http://localhost:${port}`);
});
