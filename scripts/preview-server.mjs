import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import markdownItGithubAlerts from 'markdown-it-github-alerts';
import frontMatter from 'markdown-it-front-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const samplesDir = join(rootDir, 'samples');
const port = Number(process.env.PORT ?? 4173);

let frontMatterRaw = '';

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
md.use(markdownItGithubAlerts);
md.use(frontMatter, (fm) => {
  frontMatterRaw = fm;
});

// Render ```mermaid fences as <pre class="mermaid"> for client-side rendering.
const defaultFence =
  md.renderer.rules.fence?.bind(md.renderer.rules) ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  if (tokens[idx].info.trim() === 'mermaid') {
    return `<pre class="mermaid">${md.utils.escapeHtml(tokens[idx].content)}</pre>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

/** Minimal YAML frontmatter parser: top-level `key: value` and `- item` lists. */
function parseFrontMatter(raw) {
  const entries = [];
  let current = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && current) {
      current.items.push(listMatch[1].trim());
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      current = { key, value: value.trim(), items: [] };
      entries.push(current);
    }
  }

  return entries;
}

function renderFrontMatter(raw) {
  const entries = parseFrontMatter(raw);
  if (entries.length === 0) {
    return '';
  }

  const rows = entries
    .map((entry) => {
      let valueHtml;
      if (entry.items.length > 0) {
        valueHtml = entry.items
          .map((item) => `<span class="fm-tag">${md.utils.escapeHtml(item)}</span>`)
          .join(' ');
      } else {
        valueHtml = `<span class="fm-value">${md.utils.escapeHtml(entry.value)}</span>`;
      }
      return `<tr><td class="fm-key">${md.utils.escapeHtml(entry.key)}</td><td>${valueHtml}</td></tr>`;
    })
    .join('\n');

  return `<table class="frontmatter-properties"><tbody>${rows}</tbody></table>`;
}

const frontMatterStyles = `
.frontmatter-properties {
  width: 100% !important;
  display: table !important;
  border-collapse: separate !important;
  border-spacing: 0 !important;
  margin: 0 0 2rem !important;
  background: #ffffff !important;
  border: 1px solid #e4e7ec !important;
  border-radius: 10px !important;
  box-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.06) !important;
  overflow: hidden !important;
  font-size: 0.9rem !important;
}
.frontmatter-properties td {
  padding: 9px 16px !important;
  border-bottom: 1px solid #eef0f3 !important;
  vertical-align: top !important;
}
.frontmatter-properties tr:last-child td { border-bottom: none !important; }
.frontmatter-properties .fm-key {
  width: 180px !important;
  color: #6b7480 !important;
  font-weight: 600 !important;
  white-space: nowrap !important;
}
.frontmatter-properties .fm-value { color: #2b3340 !important; }
.frontmatter-properties .fm-tag {
  display: inline-block !important;
  background: #eaf0fd !important;
  color: #2f5bd0 !important;
  border-radius: 999px !important;
  padding: 2px 10px !important;
  margin: 2px 2px !important;
  font-size: 0.8rem !important;
  font-weight: 500 !important;
}
.pre-properties-label {
  font-size: 0.75rem !important;
  text-transform: uppercase !important;
  letter-spacing: 0.08em !important;
  color: #9aa1ac !important;
  margin: 0 0 0.5rem !important;
}

/* markdown-it-github-alerts ships octicon SVGs whose fill defaults to black.
   Make each alert title icon inherit the title's color and align it nicely. */
.markdown-alert-title {
  display: flex !important;
  align-items: center !important;
}
.markdown-alert-title svg,
.markdown-alert-title .octicon {
  fill: currentColor !important;
  width: 16px !important;
  height: 16px !important;
  margin-right: 8px !important;
  flex: 0 0 auto !important;
}
`;

function renderPage() {
  frontMatterRaw = '';
  const sampleMarkdown = readFileSync(join(samplesDir, 'rich-sample.md'), 'utf8');
  const previewCss = readFileSync(join(rootDir, 'media', 'markdown-preview.css'), 'utf8');
  const tocScript = readFileSync(join(rootDir, 'media', 'toc.js'), 'utf8');
  const bodyHtml = md.render(sampleMarkdown);
  const propertiesHtml = frontMatterRaw
    ? `<p class="pre-properties-label">Properties</p>${renderFrontMatter(frontMatterRaw)}`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>md-ai-reviewer preview</title>
  <style>${previewCss}</style>
  <style>${frontMatterStyles}</style>
</head>
<body class="markdown-body">
${propertiesHtml}
${bodyHtml}
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'default' });
</script>
<script>${tocScript}</script>
</body>
</html>`;
}

const contentTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);

  if (pathname.startsWith('/assets/')) {
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(samplesDir, safePath);
    if (existsSync(filePath)) {
      const type = contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(readFileSync(filePath));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  if (pathname === '/panel-preview') {
    const panelPath = join(samplesDir, 'panel-preview.html');
    if (existsSync(panelPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(panelPath));
      return;
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderPage());
}).listen(port, () => {
  console.log(`Preview server running at http://localhost:${port}`);
});
