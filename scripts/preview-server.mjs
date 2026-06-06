import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import markdownItGithubAlerts from 'markdown-it-github-alerts';
import frontMatter from 'markdown-it-front-matter';
import hljs from 'highlight.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const samplesDir = join(rootDir, 'samples');
const port = Number(process.env.PORT ?? 4173);

let frontMatterRaw = '';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  // Mirror the VS Code built-in Markdown preview, which highlights with
  // highlight.js and emits `hljs-*` token classes (styled in markdown-preview.css).
  highlight: (str, lang) => {
    const escaped = md.utils.escapeHtml(str);
    if (lang && hljs.getLanguage(lang)) {
      try {
        const out = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="hljs"><code class="hljs language-${lang}">${out}</code></pre>`;
      } catch {
        /* fall through to plain escaped output */
      }
    }
    return `<pre class="hljs"><code class="hljs">${escaped}</code></pre>`;
  },
});
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

/*
 * Frontmatter rendering deliberately mirrors VS Code's built-in preview
 * (extensions/markdown-language-features yamlPreamble): YAML is parsed with the
 * `yaml` package and rendered as `<table class="frontmatter">` with `<th>`/`<td>`
 * rows, arrays as `<ul><li>`, and nested objects as a `<code>` YAML block. The
 * shared styling/URL-linkifying lives in media/markdown-preview.css + media/toc.js,
 * so the local preview faithfully reflects what ships in the extension.
 */
function formatScalar(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function formatValueHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return '';
    }
    return `<ul>${value.map((v) => `<li>${formatValueHtml(v)}</li>`).join('')}</ul>`;
  }
  if (typeof value === 'object') {
    return `<code>${md.utils.escapeHtml(stringifyYaml(value).trimEnd())}</code>`;
  }
  return md.utils.escapeHtml(formatScalar(value));
}

function renderFrontMatter(raw) {
  let parsed;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<div class="frontmatter-error" role="alert"><strong>Failed to parse frontmatter</strong><pre>${md.utils.escapeHtml(message)}</pre></div>`;
  }

  if (parsed === null || parsed === undefined) {
    return '';
  }

  const entries =
    typeof parsed !== 'object' || Array.isArray(parsed)
      ? [['', parsed]]
      : Object.entries(parsed);

  if (!entries.length) {
    return '';
  }

  const rows = entries
    .map(([key, value]) => `<tr><th>${md.utils.escapeHtml(key)}</th><td>${formatValueHtml(value)}</td></tr>`)
    .join('');

  return `<table class="frontmatter" title="Frontmatter"><tbody>${rows}</tbody></table>`;
}

const frontMatterStyles = `
/* Frontmatter "Properties" table styling lives in media/markdown-preview.css
   (it targets VS Code's native table.frontmatter markup, which this server now
   mirrors). Only standalone-preview tweaks remain here. */

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
  const propertiesHtml = frontMatterRaw ? renderFrontMatter(frontMatterRaw) : '';

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
