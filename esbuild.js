const esbuild = require('esbuild');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const root = __dirname;

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

// The rich showcase document is baked into the browser bundles so "Load rich
// sample" works offline (file://) and inside the packaged VSIX, with no fetch.
const richSample = readFileSync(
  join(root, 'samples', 'rich-sample.md'),
  'utf8'
);

/** Shared options for the browser bundles (preview client). */
const browserBase = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  define: {
    __RICH_SAMPLE__: JSON.stringify(richSample),
  },
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  ...browserBase,
  entryPoints: ['src/renderer/webviewMain.ts'],
  outfile: 'dist/webview/preview.js',
};

/** @type {import('esbuild').BuildOptions} */
const standaloneConfig = {
  ...browserBase,
  entryPoints: ['src/renderer/standaloneMain.ts'],
  outfile: 'dist/standalone/preview.js',
};

// Inlines the standalone bundle + shared CSS into a single, offline-capable
// HTML file the user can open directly with file://. The standalone app renders
// its own outline/properties UI, so the floating-TOC script is not included.
function writeStandaloneHtml() {
  const dir = join(root, 'dist', 'standalone');
  mkdirSync(dir, { recursive: true });
  const js = readFileSync(join(dir, 'preview.js'), 'utf8');
  const baseCss = readFileSync(
    join(root, 'media', 'markdown-preview.css'),
    'utf8'
  );
  const reviewCss = readFileSync(
    join(root, 'media', 'review-preview.css'),
    'utf8'
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="theme-color" content="#ffffff" />
<title>MarkThread</title>
<style>${baseCss}</style>
<style>${reviewCss}</style>
</head>
<body class="mdr-app">
<script>${js}</script>
</body>
</html>`;

  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  console.log('Wrote dist/standalone/index.html');
}

// esbuild plugin that regenerates the standalone HTML after each rebuild.
const standaloneHtmlPlugin = {
  name: 'standalone-html',
  setup(build) {
    build.onEnd((result) => {
      if (!result.errors.length) {
        writeStandaloneHtml();
      }
    });
  },
};
standaloneConfig.plugins = [standaloneHtmlPlugin];

async function main() {
  const configs = [extensionConfig, webviewConfig, standaloneConfig];
  if (watch) {
    const contexts = await Promise.all(
      configs.map((config) => esbuild.context(config))
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('Watching for changes...');
  } else {
    await Promise.all(configs.map((config) => esbuild.build(config)));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
