const esbuild = require('esbuild');
const { readFileSync, writeFileSync, mkdirSync, copyFileSync } = require('node:fs');
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

// PWA app icons copied alongside the standalone page so iOS "Add to Home
// Screen" and the web app manifest have real PNGs to point at.
const ICON_FILES = [
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
];

// Web app manifest enabling "Add to Home Screen" as a standalone app. Relative
// start_url/scope work under the GitHub Pages project path (/markthread/).
const WEB_MANIFEST = {
  name: 'MarkThread',
  short_name: 'MarkThread',
  description: 'Review Markdown with humans, then send feedback back to agents.',
  start_url: '.',
  scope: '.',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#ffffff',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    {
      src: 'icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};

// Copies the PWA icons + writes the manifest next to the standalone page so the
// GitHub Pages deploy can be installed to the iOS Home Screen. These are extra
// files referenced by relative URL; opening index.html from file:// still works
// (the references simply 404 there, harmlessly).
function writePwaAssets(dir) {
  const iconsDir = join(dir, 'icons');
  mkdirSync(iconsDir, { recursive: true });
  for (const name of ICON_FILES) {
    copyFileSync(join(root, 'media', 'icons', name), join(iconsDir, name));
  }
  writeFileSync(
    join(dir, 'manifest.webmanifest'),
    JSON.stringify(WEB_MANIFEST, null, 2),
    'utf8'
  );
  console.log('Wrote dist/standalone/manifest.webmanifest + icons');
}

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
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="MarkThread" />
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />
<link rel="icon" href="icons/icon-192.png" type="image/png" />
<link rel="manifest" href="manifest.webmanifest" />
<title>MarkThread</title>
<style>${baseCss}</style>
<style>${reviewCss}</style>
</head>
<body class="mdr-app">
<script>${js}</script>
</body>
</html>`;

  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  writePwaAssets(dir);
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
