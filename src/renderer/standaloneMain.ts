// Standalone web-page entry. A reading-first review workspace: the rendered
// document is the default surface, the raw Markdown lives behind a Source tab,
// and comments persist in localStorage bucketed by a content fingerprint so
// switching documents starts fresh (and reopening a known document restores its
// comments). Works fully offline from a file:// URL.
import { mountPreview, PreviewController, ReviewStats } from './previewClient';
import {
  DEFAULT_QUICK_REPLIES,
  DEFAULT_QUICK_REPLIES_RICH,
  glyphForTone,
  resolveStatus,
} from './defaults';
import type { QuickReply, StatusTone } from './defaults';
import {
  describeTableCell,
  formatStructured,
  type ReviewThread as CopyThread,
} from '../core';
import type { HostAdapter, PreviewInitData, PreviewThread } from './hostAdapter';
import { t, getLang, setLang, onLangChange, LANGS, type Lang } from './i18n';

const STORE_PREFIX = 'mdr-comments:';
const LAST_DOC_KEY = 'mdr-last-doc';

// The single component showcase (samples/rich-sample.md) is baked into the
// bundle at build time (see esbuild.js) so it works offline (file:// and the
// GitHub Pages deploy), both on a first visit and from the "Load sample" menu.
declare const __RICH_SAMPLE__: string;
const SAMPLE_DOC: string =
  typeof __RICH_SAMPLE__ === 'string' ? __RICH_SAMPLE__ : '';

// Small stable hash (djb2) used as the per-document localStorage bucket key.
function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function loadThreads(key: string): PreviewThread[] {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PreviewThread[]) : [];
  } catch {
    return [];
  }
}

function saveThreads(key: string, threads: PreviewThread[]): void {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(threads));
  } catch {
    /* storage full or unavailable; ignore */
  }
}

const CURRENT_USER = 'You';
const SETTINGS_KEY = 'mdr-settings';
const TONES: StatusTone[] = ['green', 'red', 'amber', 'blue', 'neutral'];

// Web-app review settings, mirroring the VS Code extension's configurable quick
// replies + copy template. Persisted in localStorage (per browser).
type PageWidth = 'narrow' | 'medium' | 'wide' | 'full';
const PAGE_WIDTHS: PageWidth[] = ['narrow', 'medium', 'wide', 'full'];

interface WebSettings {
  quickReplies: QuickReply[];
  shareHeader: string;
  includeLineNumber: boolean;
  includeLineText: boolean;
  includeComment: boolean;
  pageWidth: PageWidth;
}

function defaultSettings(): WebSettings {
  return {
    quickReplies: DEFAULT_QUICK_REPLIES_RICH.map((q) => ({ ...q })),
    shareHeader: 'Here are my comments',
    includeLineNumber: true,
    includeLineText: true,
    includeComment: true,
    pageWidth: 'medium',
  };
}

function loadSettings(): WebSettings {
  const fallback = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<WebSettings>;
    const quickReplies = Array.isArray(parsed.quickReplies)
      ? parsed.quickReplies
          .filter((q) => q && typeof q.label === 'string' && q.label.trim())
          .map((q) => ({
            label: String(q.label).trim(),
            tone: (TONES.includes(q.tone as StatusTone)
              ? q.tone
              : 'neutral') as StatusTone,
          }))
      : fallback.quickReplies;
    return {
      quickReplies: quickReplies.length ? quickReplies : fallback.quickReplies,
      shareHeader:
        typeof parsed.shareHeader === 'string'
          ? parsed.shareHeader
          : fallback.shareHeader,
      includeLineNumber: parsed.includeLineNumber ?? fallback.includeLineNumber,
      includeLineText: parsed.includeLineText ?? fallback.includeLineText,
      includeComment: parsed.includeComment ?? fallback.includeComment,
      pageWidth: PAGE_WIDTHS.includes(parsed.pageWidth as PageWidth)
        ? (parsed.pageWidth as PageWidth)
        : fallback.pageWidth,
    };
  } catch {
    return fallback;
  }
}

function persistSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

let settings = loadSettings();

let markdown = '';
let docKey = fingerprint('');

const adapter: HostAdapter = {
  init(): PreviewInitData {
    return {
      markdown,
      threads: loadThreads(docKey),
      quickReplies: DEFAULT_QUICK_REPLIES,
      author: CURRENT_USER,
    };
  },
  saveThreads(threads: PreviewThread[]): void {
    saveThreads(docKey, threads);
  },
  revealLine(): void {
    /* no editor to reveal in standalone mode */
  },
};

// --- Toasts -----------------------------------------------------------------
const toasts = document.createElement('div');
toasts.className = 'mdr-toasts';
toasts.setAttribute('role', 'status');
toasts.setAttribute('aria-live', 'polite');
document.body.appendChild(toasts);

function showToast(message: string, kind: 'success' | 'error' | 'info' = 'info'): void {
  const toast = document.createElement('div');
  toast.className = 'mdr-toast ' + kind;
  toast.textContent = message;
  toasts.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 2800);
}

// --- App bar ----------------------------------------------------------------
const appbar = document.createElement('header');
appbar.className = 'mdr-appbar';
appbar.innerHTML =
  '<div class="mdr-brand"><span class="mdr-logo" aria-hidden="true">' +
  '<svg class="mdr-svg" viewBox="0 0 24 24" fill="none">' +
  '<path d="M4 6.4A2.4 2.4 0 0 1 6.4 4h7.7a2.4 2.4 0 0 1 2.4 2.4v3.9a2.4 2.4 0 0 1-2.4 2.4H8.6L5.1 15.6A.55.55 0 0 1 4 15.2V6.4Z"/>' +
  '<path d="M9.4 14.9h6.3l3.2 2.9a.55.55 0 0 0 1-.4v-7.2a2.4 2.4 0 0 0-1.7-2.3"/>' +
  '</svg></span>' +
  '<span class="mdr-brand-name">MarkThread</span></div>' +
  '<div class="mdr-vtabs" role="tablist" data-i18n-al="viewTabs">' +
  '<button type="button" class="mdr-vtab active" data-view="read" role="tab" aria-selected="true" data-i18n="read">Read</button>' +
  '<button type="button" class="mdr-vtab" data-view="source" role="tab" aria-selected="false" data-i18n="source">Source</button>' +
  '<button type="button" class="mdr-vtab" data-view="clip" role="tab" aria-selected="false" data-i18n="clipboardView">Clipboard</button>' +
  '</div>' +
  '<span class="mdr-spacer"></span>' +
  '<button type="button" class="mdr-appbtn" id="mdr-comments-toggle" aria-pressed="false">' +
  '<span data-i18n="comments">Comments</span><span class="mdr-appbadge" id="mdr-comments-badge">0</span></button>' +
  '<button type="button" class="mdr-appbtn primary mdr-desktop-only" id="mdr-share" data-i18n="shareReview">Share review</button>' +
  '<div class="mdr-menuwrap">' +
  '<button type="button" class="mdr-appbtn mdr-iconbtn" id="mdr-accent" aria-haspopup="true" aria-expanded="false" data-i18n-al="accentColor" data-i18n-title="accentColor">' +
  '<svg class="mdr-svg" viewBox="0 0 24 24" fill="none"><path d="M12 3a9 9 0 1 0 0 18c.95 0 1.6-.78 1.6-1.66 0-.46-.18-.86-.48-1.16-.3-.3-.49-.7-.49-1.14 0-.9.74-1.62 1.65-1.62H16a5 5 0 0 0 5-5c0-3.87-4.03-7.42-9-7.42Z"/><circle cx="7.6" cy="11.2" r="1.1"/><circle cx="11" cy="7.6" r="1.1"/><circle cx="15.6" cy="8.6" r="1.1"/></svg>' +
  '</button>' +
  '<div class="mdr-menu mdr-accent-menu" id="mdr-accent-menu" role="menu" data-i18n-al="accentColor" hidden></div>' +
  '</div>' +
  '<button type="button" class="mdr-appbtn mdr-iconbtn" id="mdr-theme" data-i18n-title="toggleTheme">' +
  '<svg class="mdr-svg mdr-theme-sun" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' +
  '<svg class="mdr-svg mdr-theme-moon" viewBox="0 0 24 24" fill="none"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.2 6.2 0 0 0 10.5 10.5Z"/></svg>' +
  '<svg class="mdr-svg mdr-theme-system" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/></svg>' +
  '</button>' +
  '<button type="button" class="mdr-appbtn mdr-iconbtn mdr-widthbtn" id="mdr-width" data-i18n-al="pageWidthLabel" data-i18n-title="pageWidthLabel">' +
  '<svg class="mdr-svg" viewBox="0 0 24 24" fill="none"><path d="M3 12h18M3 12l3.5-3.5M3 12l3.5 3.5M21 12l-3.5-3.5M21 12l-3.5 3.5"/></svg>' +
  '<span class="mdr-width-code" id="mdr-width-code">M</span>' +
  '</button>' +
  '<button type="button" class="mdr-appbtn mdr-iconbtn mdr-langbtn" id="mdr-lang" data-i18n-al="switchLanguage" data-i18n-title="switchLanguage">' +
  '<svg class="mdr-svg" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.9 5.8 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.8-3.9-9s1.4-6.4 3.9-9Z"/></svg>' +
  '<span class="mdr-lang-code" id="mdr-lang-code">EN</span>' +
  '</button>' +
  '<div class="mdr-menuwrap">' +
  '<button type="button" class="mdr-appbtn mdr-iconbtn" id="mdr-more" aria-haspopup="true" aria-expanded="false" data-i18n-al="moreActions" data-i18n-title="moreActions">' +
  '<svg class="mdr-svg" viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>' +
  '</button>' +
  '<div class="mdr-menu" id="mdr-menu" role="menu" hidden>' +
  '<button type="button" role="menuitem" data-act="sample" data-i18n="loadSample">Load sample</button>' +
  '<button type="button" role="menuitem" data-act="upload" data-i18n="uploadMarkdown">Upload Markdown…</button>' +
  '<div class="mdr-menu-sep" role="separator"></div>' +
  '<button type="button" role="menuitem" data-act="share" class="mdr-mobile-only" data-i18n="shareReview">Share review</button>' +
  '<button type="button" role="menuitem" data-act="export" data-i18n="exportComments">Export comments</button>' +
  '<button type="button" role="menuitem" data-act="import" data-i18n="importComments">Import comments</button>' +
  '<div class="mdr-menu-sep" role="separator"></div>' +
  '<button type="button" role="menuitem" data-act="clear" class="mdr-menu-danger" data-i18n="clearAllComments">Clear all comments</button>' +
  '<div class="mdr-menu-sep" role="separator"></div>' +
  '<button type="button" role="menuitem" data-act="settings" data-i18n="settingsMenu">Settings…</button>' +
  '</div></div>' +
  '<input type="file" id="mdr-file" accept=".md,.markdown,text/markdown" hidden />' +
  '<input type="file" id="mdr-import" accept="application/json,.json" hidden />' +
  '<div class="mdr-progress" aria-hidden="true"><div class="mdr-progress-fill" id="mdr-progress-fill"></div></div>';

// --- Source (edit) view -----------------------------------------------------
const sourceView = document.createElement('section');
sourceView.className = 'mdr-source';
sourceView.hidden = true;
sourceView.setAttribute('aria-label', t('markdownSource'));
sourceView.setAttribute('data-i18n-al', 'markdownSource');
sourceView.innerHTML =
  '<div class="mdr-source-inner">' +
  '<div class="mdr-source-head"><h2 data-i18n="markdownSource">Markdown source</h2>' +
  '<div class="mdr-source-actions">' +
  '<button type="button" class="mdr-btn" id="mdr-source-cancel" data-i18n="cancel">Cancel</button>' +
  '<button type="button" class="mdr-btn primary" id="mdr-render" data-i18n="renderReview">Render &amp; review</button>' +
  '</div></div>' +
  '<textarea class="mdr-source-textarea" id="mdr-textarea" spellcheck="false" ' +
  'data-i18n-ph="sourcePlaceholder"></textarea>' +
  '</div>';

const readView = document.createElement('main');
readView.className = 'mdr-main';
const previewRoot = document.createElement('div');
previewRoot.id = 'mdr-preview';
readView.appendChild(previewRoot);

// --- Clipboard (plain-text) view --------------------------------------------
// A read-only preview of exactly what "Share review" copies, so reviewers can
// see the plain text before sending it.
const clipView = document.createElement('section');
clipView.className = 'mdr-clip';
clipView.hidden = true;
clipView.setAttribute('aria-label', t('clipboardTitle'));
clipView.setAttribute('data-i18n-al', 'clipboardTitle');
clipView.innerHTML =
  '<div class="mdr-clip-inner">' +
  '<div class="mdr-clip-head">' +
  '<div><h2 data-i18n="clipboardTitle">Clipboard preview</h2>' +
  '<p class="mdr-clip-hint" data-i18n="clipboardHint"></p></div>' +
  '<button type="button" class="mdr-btn primary" id="mdr-clip-copy" data-i18n="copyToClipboard">Copy to clipboard</button>' +
  '</div>' +
  '<pre class="mdr-clip-pre" id="mdr-clip-pre"></pre>' +
  '</div>';

document.body.appendChild(appbar);
document.body.appendChild(sourceView);
document.body.appendChild(readView);
document.body.appendChild(clipView);

// Applies the configured document width by setting the shared `data-width`
// attribute on <html> (the same knob the VS Code preview uses). Switching is
// instant — the stylesheet maps the attribute to the sheet's max-width.
function applyPageWidth(width: PageWidth): void {
  const value = PAGE_WIDTHS.includes(width) ? width : 'medium';
  document.documentElement.setAttribute('data-width', value);
  const label = t(WIDTH_LABEL_KEY[value]);
  if (widthBtn) {
    widthBtn.dataset.width = value;
    widthBtn.setAttribute('aria-label', `${t('pageWidthLabel')} · ${label}`);
    widthBtn.setAttribute('title', `${t('pageWidthLabel')} · ${label}`);
  }
  const widthCode = appbar.querySelector('#mdr-width-code');
  if (widthCode) {
    widthCode.textContent = label;
  }
}

const WIDTH_LABEL_KEY: Record<PageWidth, string> = {
  narrow: 'pageWidthNarrow',
  medium: 'pageWidthMedium',
  wide: 'pageWidthWide',
  full: 'pageWidthFull',
};

const textarea = sourceView.querySelector('#mdr-textarea') as HTMLTextAreaElement;

let controller: PreviewController | null = null;

// --- View switching ---------------------------------------------------------
type ViewName = 'read' | 'source' | 'clip';

// Fills the clipboard preview with the exact plain text "Share review" copies.
function refreshClipPreview(): void {
  const pre = clipView.querySelector('#mdr-clip-pre');
  if (!pre) {
    return;
  }
  const text = shareText().trim();
  pre.textContent = text.length ? text : t('clipboardEmpty');
  pre.classList.toggle('empty', text.length === 0);
}

function setView(view: ViewName): void {
  readView.hidden = view !== 'read';
  sourceView.hidden = view !== 'source';
  clipView.hidden = view !== 'clip';
  appbar.querySelectorAll<HTMLElement>('.mdr-vtab').forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  // Each tab is a fresh surface, so start it at the top instead of inheriting
  // the previous view's scroll position.
  window.scrollTo({ top: 0 });
  if (view === 'read') {
    controller?.setPanelOpen(controller.isPanelOpen());
  } else if (view === 'clip') {
    refreshClipPreview();
  }
}

appbar.querySelectorAll<HTMLElement>('.mdr-vtab').forEach((tab) => {
  tab.addEventListener('click', () =>
    setView((tab.dataset.view as ViewName) ?? 'read')
  );
});

(clipView.querySelector('#mdr-clip-copy') as HTMLElement).addEventListener(
  'click',
  () => {
    void shareReview();
  }
);

// --- Render -----------------------------------------------------------------
function applyMarkdown(next: string, switchToRead = true): void {
  markdown = next;
  docKey = fingerprint(next);
  try {
    localStorage.setItem(LAST_DOC_KEY, next);
  } catch {
    /* ignore */
  }
  const data = adapter.init() as PreviewInitData;
  if (controller) {
    controller.setData(data);
  } else {
    controller = mountPreview(previewRoot, adapter, {
      sidePanel: true,
      currentUser: CURRENT_USER,
      onStats: updateCommentsBadge,
      statuses: settings.quickReplies,
      onCopyComments: () => void shareReview(),
    });
  }
  if (switchToRead) {
    setView('read');
  }
}

(sourceView.querySelector('#mdr-render') as HTMLElement).addEventListener(
  'click',
  () => applyMarkdown(textarea.value)
);
(sourceView.querySelector('#mdr-source-cancel') as HTMLElement).addEventListener(
  'click',
  () => {
    textarea.value = markdown;
    setView('read');
  }
);

// --- Comments toggle + badge ------------------------------------------------
const commentsToggle = appbar.querySelector(
  '#mdr-comments-toggle'
) as HTMLButtonElement;
const commentsBadge = appbar.querySelector('#mdr-comments-badge') as HTMLElement;

function updateCommentsBadge(stats: ReviewStats): void {
  commentsBadge.textContent = String(stats.open);
  commentsBadge.classList.toggle('zero', stats.open === 0);
  // Keep the clipboard preview live if the reviewer is looking at it.
  if (!clipView.hidden) {
    refreshClipPreview();
  }
}

commentsToggle.addEventListener('click', () => {
  if (!controller) {
    return;
  }
  const next = !controller.isPanelOpen();
  controller.setPanelOpen(next);
  commentsToggle.setAttribute('aria-pressed', String(next));
});

// --- File + data actions ----------------------------------------------------
const fileInput = appbar.querySelector('#mdr-file') as HTMLInputElement;
const importInput = appbar.querySelector('#mdr-import') as HTMLInputElement;

function exportPayload(): string {
  return JSON.stringify(
    {
      version: 1,
      markdown,
      threads: controller ? controller.getThreads() : loadThreads(docKey),
    },
    null,
    2
  );
}

function downloadReview(): void {
  const blob = new Blob([exportPayload()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'markthread-review.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportComments(): void {
  const count = controller ? controller.getThreads().length : 0;
  downloadReview();
  showToast(
    count ? t('exportedThreads', { n: count }) : t('exportedEmpty'),
    'success'
  );
}

// Drops every comment for the current document (after confirmation) and
// persists the empty set so it stays cleared across reloads.
function clearReview(): void {
  const count = controller
    ? controller.getThreads().length
    : loadThreads(docKey).length;
  if (count === 0) {
    showToast(t('noCommentsToClear'), 'info');
    return;
  }
  const ok = window.confirm(t('confirmClear', { n: count }));
  if (!ok) {
    return;
  }
  saveThreads(docKey, []);
  controller?.setData(adapter.init() as PreviewInitData);
  showToast(t('clearedAll'), 'success');
}

// Renders a single comment to plain text: an optional verdict tag + body.
function commentToText(c: PreviewThread['comments'][number]): string {
  const tag = c.status
    ? `[${resolveStatus(c.status, c.statusTone as StatusTone | undefined).label}]`
    : '';
  const body = c.body?.trim() ?? '';
  return [tag, body].filter(Boolean).join(' ');
}

// Builds a location reference for a table-cell thread: which table (ordinal +
// source line), which row, and which column (index + header label). Falls back
// to undefined for non-cell threads so the formatter uses the plain `Line N`.
function cellLocationLabel(t: PreviewThread): string | undefined {
  if (!t.cell) {
    return undefined;
  }
  return describeTableCell(markdown.split('\n'), t.line, t.cell);
}

// Builds a human-readable review summary (NOT JSON) using the configurable
// share template + toggles. Each thread quotes its line number/text + comments.
function shareText(): string {
  const threads = controller ? controller.getThreads() : loadThreads(docKey);
  const copyThreads: CopyThread[] = threads.map((t) => ({
    file: 'document.md',
    comments: [
      {
        line: t.line,
        lineText: t.selection?.text || t.lineText,
        locationLabel: cellLocationLabel(t),
        comment:
          t.comments.map(commentToText).filter(Boolean).join('\n') +
          (t.resolved ? '\n(resolved)' : ''),
      },
    ],
  }));
  return formatStructured(copyThreads, {
    includeFileName: false,
    includeLineNumber: settings.includeLineNumber,
    includeLineText: settings.includeLineText,
    includeComment: settings.includeComment,
    headerTemplate: settings.shareHeader,
  });
}

// Copy text to the clipboard with an iOS-friendly fallback. iOS Safari only
// exposes navigator.clipboard in a secure context; over plain HTTP (or in
// older WebViews) it is undefined, so we synchronously fall back to the legacy
// execCommand path, which still works while we are inside the click gesture.
async function copyTextToClipboard(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    const selection = document.getSelection();
    const saved =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0)
        : null;
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    if (saved && selection) {
      selection.removeAllRanges();
      selection.addRange(saved);
    }
    return ok;
  } catch {
    return false;
  }
}

async function shareReview(): Promise<void> {
  const text = shareText();
  const ok = await copyTextToClipboard(text);
  showToast(
    ok ? t('copiedSummary') : t('clipboardUnavailable'),
    ok ? 'success' : 'error'
  );
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    textarea.value = String(reader.result ?? '');
    applyMarkdown(textarea.value);
    showToast(t('loadedFile', { name: file.name }), 'success');
  };
  reader.onerror = () => showToast(t('couldNotRead'), 'error');
  reader.readAsText(file);
  fileInput.value = '';
});

importInput.addEventListener('change', () => {
  const file = importInput.files?.[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result ?? '{}'));
      const md = typeof data.markdown === 'string' ? data.markdown : markdown;
      const threads: PreviewThread[] = Array.isArray(data.threads)
        ? data.threads
        : [];
      textarea.value = md;
      markdown = md;
      docKey = fingerprint(md);
      saveThreads(docKey, threads);
      const init = adapter.init() as PreviewInitData;
      if (controller) {
        controller.setData(init);
      } else {
        controller = mountPreview(previewRoot, adapter, {
          sidePanel: true,
          currentUser: CURRENT_USER,
          onStats: updateCommentsBadge,
          statuses: settings.quickReplies,
          onCopyComments: () => void shareReview(),
        });
      }
      setView('read');
      showToast(t('importedThreads', { n: threads.length }), 'success');
    } catch {
      showToast(t('invalidExport'), 'error');
    }
  };
  reader.onerror = () => showToast(t('couldNotRead'), 'error');
  reader.readAsText(file);
  importInput.value = '';
});

function loadSample(): void {
  textarea.value = SAMPLE_DOC;
  applyMarkdown(SAMPLE_DOC);
  showToast(t('loadedSample'), 'success');
}

// --- More menu --------------------------------------------------------------
const moreBtn = appbar.querySelector('#mdr-more') as HTMLButtonElement;
const menu = appbar.querySelector('#mdr-menu') as HTMLElement;

function setMenuOpen(open: boolean): void {
  menu.hidden = !open;
  moreBtn.setAttribute('aria-expanded', String(open));
}

moreBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenuOpen(menu.hidden);
});
document.addEventListener('click', (e) => {
  if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== moreBtn) {
    setMenuOpen(false);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    setMenuOpen(false);
  }
});

menu.querySelectorAll<HTMLElement>('[data-act]').forEach((btn) => {
  btn.addEventListener('click', () => {
    setMenuOpen(false);
    switch (btn.dataset.act) {
      case 'sample':
        loadSample();
        break;
      case 'upload':
        fileInput.click();
        break;
      case 'export':
        exportComments();
        break;
      case 'import':
        importInput.click();
        break;
      case 'clear':
        clearReview();
        break;
      case 'share':
        void shareReview();
        break;
      case 'settings':
        openSettings();
        break;
    }
  });
});

(appbar.querySelector('#mdr-share') as HTMLElement).addEventListener('click', () =>
  void shareReview()
);

// --- Settings modal ---------------------------------------------------------
const modal = document.createElement('div');
modal.className = 'mdr-modal';
modal.hidden = true;
modal.setAttribute('role', 'dialog');
modal.setAttribute('aria-modal', 'true');
modal.setAttribute('aria-label', t('reviewSettings'));
modal.setAttribute('data-i18n-al', 'reviewSettings');
modal.innerHTML =
  '<div class="mdr-modal-card">' +
  '<div class="mdr-modal-head"><h2 data-i18n="settingsTitle">Settings</h2>' +
  '<button type="button" class="mdr-iconbtn" id="mdr-settings-close" data-i18n-al="closeSettings">✕</button></div>' +
  '<div class="mdr-field"><span class="mdr-field-label" data-i18n="quickReplyPills">Quick reply pills</span>' +
  '<div id="mdr-qr-list"></div>' +
  '<button type="button" class="mdr-btn" id="mdr-qr-add" data-i18n="addReply">+ Add reply</button>' +
  '<p class="mdr-hint" data-i18n="quickReplyHint">Shown as one-click verdict pills on every comment. Tone sets the colour and icon.</p></div>' +
  '<div class="mdr-field"><span class="mdr-field-label" data-i18n="pageWidthLabel">Page width</span>' +
  '<select id="mdr-page-width" class="mdr-select" data-i18n-al="pageWidthLabel">' +
  '<option value="narrow" data-i18n="pageWidthNarrow">Narrow</option>' +
  '<option value="medium" data-i18n="pageWidthMedium">Medium</option>' +
  '<option value="wide" data-i18n="pageWidthWide">Wide</option>' +
  '<option value="full" data-i18n="pageWidthFull">Full width</option>' +
  '</select>' +
  '<p class="mdr-hint" data-i18n="pageWidthHint">Sets how wide the rendered document is. Wider fits big tables; narrower is easier to read.</p></div>' +
  '<div class="mdr-field"><span class="mdr-field-label" data-i18n="shareTemplate">Share summary template</span>' +
  '<textarea id="mdr-share-header" data-i18n-al="shareHeaderAria"></textarea>' +
  '<label class="mdr-check"><input type="checkbox" id="mdr-inc-line" /> <span data-i18n="includeLineNumber">Include line number</span></label>' +
  '<label class="mdr-check"><input type="checkbox" id="mdr-inc-text" /> <span data-i18n="includeLineText">Include line / selection text</span></label>' +
  '<label class="mdr-check"><input type="checkbox" id="mdr-inc-comment" /> <span data-i18n="includeComment">Include comment text</span></label>' +
  '<p class="mdr-hint" data-i18n="shareHint">Used by Share review, which copies a readable summary (not JSON) to the clipboard.</p></div>' +
  '<div class="mdr-modal-actions">' +
  '<button type="button" class="mdr-btn" id="mdr-settings-reset" data-i18n="resetDefaults">Reset to defaults</button>' +
  '<span class="mdr-spacer"></span>' +
  '<button type="button" class="mdr-btn" id="mdr-settings-cancel" data-i18n="cancel">Cancel</button>' +
  '<button type="button" class="mdr-btn primary" id="mdr-settings-save" data-i18n="save">Save</button>' +
  '</div></div>';
document.body.appendChild(modal);

const qrList = modal.querySelector('#mdr-qr-list') as HTMLElement;

function addQrRow(reply: QuickReply): void {
  const row = document.createElement('div');
  row.className = 'mdr-qr-row';
  row.dataset.tone = reply.tone;
  const text = document.createElement('input');
  text.type = 'text';
  text.value = reply.label;
  text.setAttribute('aria-label', t('quickReplyLabelAria'));

  // Colour picker: a row of tinted swatches (the verdict glyph shown in its
  // tone colour) instead of a text dropdown, so the colour is obvious at a
  // glance. The chosen tone is stored on the row for save().
  const swatches = document.createElement('div');
  swatches.className = 'mdr-tone-swatches';
  swatches.setAttribute('role', 'radiogroup');
  swatches.setAttribute('aria-label', t('quickReplyToneAria'));
  const swatchBtns: HTMLButtonElement[] = [];
  const selectTone = (tone: StatusTone): void => {
    row.dataset.tone = tone;
    swatchBtns.forEach((b) => {
      const on = b.dataset.tone === tone;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-checked', String(on));
    });
  };
  for (const tone of TONES) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'mdr-status mdr-tone-swatch';
    sw.dataset.tone = tone;
    sw.setAttribute('role', 'radio');
    sw.setAttribute('aria-label', tone);
    sw.innerHTML = `<span class="mdr-status-glyph" aria-hidden="true">${glyphForTone(
      tone
    )}</span>`;
    sw.addEventListener('click', () => selectTone(tone));
    swatches.appendChild(sw);
    swatchBtns.push(sw);
  }
  selectTone(reply.tone);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'mdr-iconbtn';
  remove.setAttribute('aria-label', t('removeQuickReply'));
  remove.textContent = '✕';
  remove.addEventListener('click', () => row.remove());
  row.append(text, swatches, remove);
  qrList.appendChild(row);
}

function openSettings(): void {
  qrList.innerHTML = '';
  for (const reply of settings.quickReplies) {
    addQrRow(reply);
  }
  (modal.querySelector('#mdr-share-header') as HTMLTextAreaElement).value =
    settings.shareHeader;
  (modal.querySelector('#mdr-inc-line') as HTMLInputElement).checked =
    settings.includeLineNumber;
  (modal.querySelector('#mdr-inc-text') as HTMLInputElement).checked =
    settings.includeLineText;
  (modal.querySelector('#mdr-inc-comment') as HTMLInputElement).checked =
    settings.includeComment;
  (modal.querySelector('#mdr-page-width') as HTMLSelectElement).value =
    settings.pageWidth;
  modal.hidden = false;
}

function closeSettings(): void {
  modal.hidden = true;
}

(modal.querySelector('#mdr-qr-add') as HTMLElement).addEventListener('click', () =>
  addQrRow({ label: '', tone: 'neutral' })
);
(modal.querySelector('#mdr-settings-close') as HTMLElement).addEventListener(
  'click',
  closeSettings
);
(modal.querySelector('#mdr-settings-cancel') as HTMLElement).addEventListener(
  'click',
  closeSettings
);
modal.addEventListener('click', (e) => {
  if (e.target === modal) {
    closeSettings();
  }
});
(modal.querySelector('#mdr-settings-reset') as HTMLElement).addEventListener(
  'click',
  () => {
    settings = defaultSettings();
    openSettings();
  }
);
(modal.querySelector('#mdr-settings-save') as HTMLElement).addEventListener(
  'click',
  () => {
    const quickReplies: QuickReply[] = [];
    qrList.querySelectorAll<HTMLElement>('.mdr-qr-row').forEach((row) => {
      const label = (row.querySelector('input') as HTMLInputElement).value.trim();
      const tone = (row.dataset.tone as StatusTone) ?? 'neutral';
      if (label) {
        quickReplies.push({ label, tone });
      }
    });
    settings = {
      quickReplies: quickReplies.length
        ? quickReplies
        : defaultSettings().quickReplies,
      shareHeader: (modal.querySelector('#mdr-share-header') as HTMLTextAreaElement)
        .value,
      includeLineNumber: (modal.querySelector('#mdr-inc-line') as HTMLInputElement)
        .checked,
      includeLineText: (modal.querySelector('#mdr-inc-text') as HTMLInputElement)
        .checked,
      includeComment: (modal.querySelector('#mdr-inc-comment') as HTMLInputElement)
        .checked,
      pageWidth: (modal.querySelector('#mdr-page-width') as HTMLSelectElement)
        .value as PageWidth,
    };
    persistSettings();
    controller?.setStatuses(settings.quickReplies);
    applyPageWidth(settings.pageWidth);
    closeSettings();
    showToast(t('settingsSaved'), 'success');
  }
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.hidden) {
    closeSettings();
  }
});

// --- Theme toggle -----------------------------------------------------------
// Cycles light <-> dark, persisted per browser. With no saved preference the
// page follows the OS (prefers-color-scheme) via CSS, so the button reflects
// and overrides that.
const THEME_KEY = 'markthread.theme';
const themeBtn = appbar.querySelector('#mdr-theme') as HTMLButtonElement;
const widthBtn = appbar.querySelector('#mdr-width') as HTMLButtonElement;
type ThemeMode = 'system' | 'light' | 'dark';
const THEME_CYCLE: ThemeMode[] = ['system', 'light', 'dark'];
let themeMode: ThemeMode = 'system';

// `system` leaves data-theme unset so the OS prefers-color-scheme drives the
// CSS; `light`/`dark` force it explicitly.
function applyThemeMode(mode: ThemeMode): void {
  themeMode = mode;
  if (mode === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', mode);
  }
  if (themeBtn) {
    themeBtn.dataset.mode = mode;
    const label =
      mode === 'system'
        ? t('themeSystem')
        : mode === 'light'
          ? t('themeLight')
          : t('themeDark');
    themeBtn.setAttribute('aria-label', `${t('toggleTheme')} · ${label}`);
  }
}

(function initTheme(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    /* ignore */
  }
  applyThemeMode(
    saved === 'light' || saved === 'dark' || saved === 'system'
      ? saved
      : 'system'
  );
})();

themeBtn?.addEventListener('click', () => {
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(themeMode) + 1) % THEME_CYCLE.length];
  applyThemeMode(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
});

// --- Page width toggle ------------------------------------------------------
// Cycles narrow -> medium -> wide -> full, mirroring the theme toggle. The
// chosen width applies instantly (via the shared `data-width` attribute) and is
// persisted with the rest of the browser settings.
widthBtn?.addEventListener('click', () => {
  const current = PAGE_WIDTHS.includes(settings.pageWidth)
    ? settings.pageWidth
    : 'medium';
  const next = PAGE_WIDTHS[(PAGE_WIDTHS.indexOf(current) + 1) % PAGE_WIDTHS.length];
  settings = { ...settings, pageWidth: next };
  persistSettings();
  applyPageWidth(next);
});

// --- Accent palette picker --------------------------------------------------
// The accent is orthogonal to light/dark and persisted per browser.
const ACCENT_KEY = 'markthread.accent';
const ACCENTS: { id: string; dot: string }[] = [
  { id: 'oxblood', dot: '#8a2f3b' },
  { id: 'ink', dot: '#26262b' },
  { id: 'pine', dot: '#1f6f4f' },
  { id: 'terracotta', dot: '#b4502f' },
  { id: 'petrol', dot: '#0e6e72' },
];
const accentBtn = appbar.querySelector('#mdr-accent') as HTMLButtonElement;
const accentMenu = appbar.querySelector('#mdr-accent-menu') as HTMLElement;
let currentAccent = 'oxblood';

function renderAccentMenu(): void {
  accentMenu.innerHTML =
    `<div class="mdr-menu-label">${t('accent')}</div>` +
    ACCENTS.map(
      (a) =>
        `<button type="button" role="menuitemradio" data-accent="${a.id}" aria-checked="${String(
          a.id === currentAccent
        )}">` +
        `<span class="mdr-swatch" style="background:${a.dot}"></span>${t(
          'accent_' + a.id
        )}</button>`
    ).join('');
}

function applyAccent(id: string): void {
  currentAccent = id;
  document.documentElement.setAttribute('data-accent', id);
  accentMenu
    .querySelectorAll<HTMLElement>('[data-accent]')
    .forEach((b) =>
      b.setAttribute('aria-checked', String(b.dataset.accent === id))
    );
}

renderAccentMenu();

(function initAccent(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(ACCENT_KEY);
  } catch {
    /* ignore */
  }
  applyAccent(ACCENTS.some((a) => a.id === saved) ? (saved as string) : 'oxblood');
})();

function setAccentMenuOpen(open: boolean): void {
  accentMenu.hidden = !open;
  accentBtn.setAttribute('aria-expanded', String(open));
}

accentBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setAccentMenuOpen(accentMenu.hidden);
});
accentMenu.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-accent]');
  if (!btn || !btn.dataset.accent) {
    return;
  }
  applyAccent(btn.dataset.accent);
  try {
    localStorage.setItem(ACCENT_KEY, btn.dataset.accent);
  } catch {
    /* ignore */
  }
  setAccentMenuOpen(false);
});
document.addEventListener('click', () => setAccentMenuOpen(false));

// --- Language switch --------------------------------------------------------
// A compact globe button toggles EN <-> 简体中文. The active code shows in the
// button; all chrome relabels in place (no reload) via data-i18n* attributes.
const langBtn = appbar.querySelector('#mdr-lang') as HTMLButtonElement;
const langCode = appbar.querySelector('#mdr-lang-code') as HTMLElement;

function applyLangButton(): void {
  const lang = getLang();
  const meta = LANGS.find((l) => l.id === lang) ?? LANGS[0];
  langCode.textContent = meta.short;
  langBtn.setAttribute('aria-label', `${t('switchLanguage')} · ${meta.label}`);
  langBtn.setAttribute('title', `${t('switchLanguage')} · ${meta.label}`);
}

langBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const next: Lang = getLang() === 'zh' ? 'en' : 'zh';
  setLang(next);
});

// Relabel every element tagged with a data-i18n* attribute in the static chrome
// (app bar, source view, settings modal), plus the dynamic/per-theme labels.
function relabelUI(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as string);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-ph]').forEach((el) => {
    (el as HTMLInputElement | HTMLTextAreaElement).placeholder = t(
      el.dataset.i18nPh as string
    );
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-al]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAl as string));
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle as string));
  });
  renderAccentMenu();
  applyLangButton();
  applyThemeMode(themeMode);
  applyPageWidth(
    PAGE_WIDTHS.includes(settings.pageWidth) ? settings.pageWidth : 'medium'
  );
  if (!clipView.hidden) {
    refreshClipPreview();
  }
}

onLangChange(() => relabelUI());

// --- Reading progress -------------------------------------------------------
// Fills a hairline under the app bar as the document scrolls past. Reads the
// document scroll position directly and writes a transform inside a rAF tick
// (no React state, no per-frame layout thrash).
const progressFill = appbar.querySelector('#mdr-progress-fill') as HTMLElement;
let progressTicking = false;

function updateProgress(): void {
  const doc = document.documentElement;
  const max = doc.scrollHeight - doc.clientHeight;
  const ratio = max > 8 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
  progressFill.style.transform = `scaleX(${ratio})`;
}

window.addEventListener(
  'scroll',
  () => {
    if (progressTicking) {
      return;
    }
    progressTicking = true;
    requestAnimationFrame(() => {
      updateProgress();
      progressTicking = false;
    });
  },
  { passive: true }
);
window.addEventListener('resize', updateProgress, { passive: true });

// --- Boot -------------------------------------------------------------------
// Restore the last reviewed document (if any) so a refresh brings back both the
// rendered Markdown and its comments; on a first visit load the showcase sample.
let initialDoc = '';
try {
  initialDoc = localStorage.getItem(LAST_DOC_KEY) ?? '';
} catch {
  /* ignore */
}
if (!initialDoc) {
  initialDoc = SAMPLE_DOC;
}
document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
relabelUI();
applyPageWidth(settings.pageWidth);
textarea.value = initialDoc;
applyMarkdown(initialDoc);
setView('read');
requestAnimationFrame(updateProgress);
