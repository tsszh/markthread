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
  formatStructured,
  STRUCTURED_HEADER,
  type ReviewThread as CopyThread,
} from '../core';
import type { HostAdapter, PreviewInitData, PreviewThread } from './hostAdapter';

const STORE_PREFIX = 'mdr-comments:';
const LAST_DOC_KEY = 'mdr-last-doc';

// A showcase document covering every supported component (frontmatter, tables,
// task lists, quotes, alerts/callouts, code, and all three chart kinds). Loaded
// by "Load sample" and on a first visit with no saved document. Built from an
// array so the fenced code blocks don't need backtick escaping.
const SAMPLE_DOC = [
  '---',
  'title: Markdown AI Reviewer — Sample',
  'owner: tsszh',
  'status: demo',
  'tags: [markdown, review, charts]',
  '---',
  '',
  '# Component Showcase',
  '',
  'This sample exercises **every** supported block. Hover any line for the 💬',
  'button, or select text to comment on a phrase.',
  '',
  '## Text formatting',
  '',
  'Mix of **bold**, *italic*, ~~strikethrough~~, `inline code`, and a',
  '[link](https://github.com/tsszh/md-ai-reviewer).',
  '',
  '## Lists',
  '',
  '- First bullet item',
  '- Second bullet item',
  '  - Nested item',
  '- Third bullet item',
  '',
  '1. Ordered one',
  '2. Ordered two',
  '3. Ordered three',
  '',
  '## Task list',
  '',
  '- [x] Render Markdown in the browser',
  '- [x] Per-line and per-selection comments',
  '- [ ] Publish to the marketplace',
  '',
  '## Table',
  '',
  '| Feature | Status | Owner |',
  '| --- | --- | --- |',
  '| Charts | Done | tsszh |',
  '| Comments | Done | tsszh |',
  '| Side panel | Done | tsszh |',
  '',
  '## Blockquote',
  '',
  '> A blockquote for emphasis or citations.',
  '> It can span multiple lines.',
  '',
  '## Alerts',
  '',
  '> [!NOTE]',
  '> Useful information that users should know.',
  '',
  '> [!TIP]',
  '> A helpful suggestion.',
  '',
  '> [!IMPORTANT]',
  '> Key information users need to succeed.',
  '',
  '> [!WARNING]',
  '> Urgent info that needs attention.',
  '',
  '> [!CAUTION]',
  '> Advises about risks or negative outcomes.',
  '',
  '## Code block',
  '',
  '```typescript',
  'function greet(name: string): string {',
  '  return `Hello, ${name}!`;',
  '}',
  '```',
  '',
  '## ECharts',
  '',
  '```echarts',
  '{',
  '  "tooltip": {},',
  '  "xAxis": { "type": "category", "data": ["Mon","Tue","Wed","Thu","Fri"] },',
  '  "yAxis": { "type": "value" },',
  '  "series": [{ "type": "line", "smooth": true, "areaStyle": {}, "data": [120, 200, 150, 280, 320] }]',
  '}',
  '```',
  '',
  '## Obsidian Chart',
  '',
  '```chart',
  'type: bar',
  'labels: [Organic, Paid, Referral, Email]',
  'series:',
  '  - title: Q2',
  '    data: [32, 18, 12, 9]',
  '  - title: Q3',
  '    data: [44, 26, 15, 14]',
  '```',
  '',
  '## Mermaid',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Write] --> B[Render]',
  '  B --> C[Review]',
  '  C --> D[Ship]',
  '```',
  '',
].join('\n');

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
interface WebSettings {
  quickReplies: QuickReply[];
  shareHeader: string;
  includeLineNumber: boolean;
  includeLineText: boolean;
  includeComment: boolean;
}

function defaultSettings(): WebSettings {
  return {
    quickReplies: DEFAULT_QUICK_REPLIES_RICH.map((q) => ({ ...q })),
    shareHeader: STRUCTURED_HEADER,
    includeLineNumber: true,
    includeLineText: true,
    includeComment: true,
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
  '<div class="mdr-brand"><span class="mdr-logo" aria-hidden="true">✸</span>' +
  '<span class="mdr-brand-name">Markdown Review</span></div>' +
  '<div class="mdr-vtabs" role="tablist" aria-label="View">' +
  '<button type="button" class="mdr-vtab active" data-view="read" role="tab" aria-selected="true">Read</button>' +
  '<button type="button" class="mdr-vtab" data-view="source" role="tab" aria-selected="false">Source</button>' +
  '</div>' +
  '<span class="mdr-spacer"></span>' +
  '<button type="button" class="mdr-appbtn" id="mdr-comments-toggle" aria-pressed="false">' +
  '<span>Comments</span><span class="mdr-appbadge" id="mdr-comments-badge">0</span></button>' +
  '<button type="button" class="mdr-appbtn primary mdr-desktop-only" id="mdr-share">Share review</button>' +
  '<div class="mdr-menuwrap">' +
  '<button type="button" class="mdr-appbtn mdr-iconbtn" id="mdr-more" aria-haspopup="true" aria-expanded="false" aria-label="More actions">⋯</button>' +
  '<div class="mdr-menu" id="mdr-menu" role="menu" hidden>' +
  '<button type="button" role="menuitem" data-act="sample">Load sample</button>' +
  '<button type="button" role="menuitem" data-act="upload">Upload Markdown…</button>' +
  '<div class="mdr-menu-sep" role="separator"></div>' +
  '<button type="button" role="menuitem" data-act="share" class="mdr-mobile-only">Share review</button>' +
  '<button type="button" role="menuitem" data-act="export">Export comments</button>' +
  '<button type="button" role="menuitem" data-act="import">Import comments</button>' +
  '<div class="mdr-menu-sep" role="separator"></div>' +
  '<button type="button" role="menuitem" data-act="clear" class="mdr-menu-danger">Clear all comments</button>' +
  '<div class="mdr-menu-sep" role="separator"></div>' +
  '<button type="button" role="menuitem" data-act="settings">Settings…</button>' +
  '</div></div>' +
  '<input type="file" id="mdr-file" accept=".md,.markdown,text/markdown" hidden />' +
  '<input type="file" id="mdr-import" accept="application/json,.json" hidden />';

// --- Source (edit) view -----------------------------------------------------
const sourceView = document.createElement('section');
sourceView.className = 'mdr-source';
sourceView.hidden = true;
sourceView.setAttribute('aria-label', 'Markdown source');
sourceView.innerHTML =
  '<div class="mdr-source-inner">' +
  '<div class="mdr-source-head"><h2>Markdown source</h2>' +
  '<div class="mdr-source-actions">' +
  '<button type="button" class="mdr-btn" id="mdr-source-cancel">Cancel</button>' +
  '<button type="button" class="mdr-btn primary" id="mdr-render">Render &amp; review</button>' +
  '</div></div>' +
  '<textarea class="mdr-source-textarea" id="mdr-textarea" spellcheck="false" ' +
  'placeholder="Paste Markdown here, then Render &amp; review…"></textarea>' +
  '</div>';

const readView = document.createElement('main');
readView.className = 'mdr-main';
const previewRoot = document.createElement('div');
previewRoot.id = 'mdr-preview';
readView.appendChild(previewRoot);

document.body.appendChild(appbar);
document.body.appendChild(sourceView);
document.body.appendChild(readView);

const textarea = sourceView.querySelector('#mdr-textarea') as HTMLTextAreaElement;

let controller: PreviewController | null = null;

// --- View switching ---------------------------------------------------------
function setView(view: 'read' | 'source'): void {
  const read = view === 'read';
  readView.hidden = !read;
  sourceView.hidden = read;
  appbar.querySelectorAll<HTMLElement>('.mdr-vtab').forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  if (read) {
    controller?.setPanelOpen(controller.isPanelOpen());
  }
}

appbar.querySelectorAll<HTMLElement>('.mdr-vtab').forEach((tab) => {
  tab.addEventListener('click', () =>
    setView((tab.dataset.view as 'read' | 'source') ?? 'read')
  );
});

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
  a.download = 'md-review.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportComments(): void {
  const count = controller ? controller.getThreads().length : 0;
  downloadReview();
  showToast(
    count
      ? `Exported ${count} comment thread${count > 1 ? 's' : ''}`
      : 'Exported review (no comments yet)',
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
    showToast('No comments to clear', 'info');
    return;
  }
  const ok = window.confirm(
    `Clear all ${count} comment thread${count > 1 ? 's' : ''}? This cannot be undone.`
  );
  if (!ok) {
    return;
  }
  saveThreads(docKey, []);
  controller?.setData(adapter.init() as PreviewInitData);
  showToast('Cleared all comments', 'success');
}

// Renders a single comment to plain text: an optional verdict tag + body.
function commentToText(c: PreviewThread['comments'][number]): string {
  const tag = c.status
    ? `[${resolveStatus(c.status, c.statusTone as StatusTone | undefined).label}]`
    : '';
  const body = c.body?.trim() ?? '';
  return [tag, body].filter(Boolean).join(' ');
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

async function shareReview(): Promise<void> {
  const text = shareText();
  try {
    await navigator.clipboard.writeText(text);
    showToast('Review summary copied to clipboard', 'success');
  } catch {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'md-review.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Clipboard unavailable — downloaded the review summary instead', 'info');
  }
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
    showToast(`Loaded ${file.name}`, 'success');
  };
  reader.onerror = () => showToast('Could not read that file', 'error');
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
        });
      }
      setView('read');
      showToast(`Imported ${threads.length} comment thread${threads.length === 1 ? '' : 's'}`, 'success');
    } catch {
      showToast('That file is not a valid review export', 'error');
    }
  };
  reader.onerror = () => showToast('Could not read that file', 'error');
  reader.readAsText(file);
  importInput.value = '';
});

function loadSample(): void {
  textarea.value = SAMPLE_DOC;
  applyMarkdown(SAMPLE_DOC);
  showToast('Loaded the sample document', 'success');
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
modal.setAttribute('aria-label', 'Review settings');
modal.innerHTML =
  '<div class="mdr-modal-card">' +
  '<div class="mdr-modal-head"><h2>Settings</h2>' +
  '<button type="button" class="mdr-iconbtn" id="mdr-settings-close" aria-label="Close settings">✕</button></div>' +
  '<div class="mdr-field"><span class="mdr-field-label">Quick reply pills</span>' +
  '<div id="mdr-qr-list"></div>' +
  '<button type="button" class="mdr-btn" id="mdr-qr-add">+ Add reply</button>' +
  '<p class="mdr-hint">Shown as one-click verdict pills on every comment. Tone sets the colour and icon.</p></div>' +
  '<div class="mdr-field"><span class="mdr-field-label">Share summary template</span>' +
  '<textarea id="mdr-share-header" aria-label="Share summary header"></textarea>' +
  '<label class="mdr-check"><input type="checkbox" id="mdr-inc-line" /> Include line number</label>' +
  '<label class="mdr-check"><input type="checkbox" id="mdr-inc-text" /> Include line / selection text</label>' +
  '<label class="mdr-check"><input type="checkbox" id="mdr-inc-comment" /> Include comment text</label>' +
  '<p class="mdr-hint">Used by “Share review”, which copies a readable summary (not JSON) to the clipboard.</p></div>' +
  '<div class="mdr-modal-actions">' +
  '<button type="button" class="mdr-btn" id="mdr-settings-reset">Reset to defaults</button>' +
  '<span class="mdr-spacer"></span>' +
  '<button type="button" class="mdr-btn" id="mdr-settings-cancel">Cancel</button>' +
  '<button type="button" class="mdr-btn primary" id="mdr-settings-save">Save</button>' +
  '</div></div>';
document.body.appendChild(modal);

const qrList = modal.querySelector('#mdr-qr-list') as HTMLElement;

function addQrRow(reply: QuickReply): void {
  const row = document.createElement('div');
  row.className = 'mdr-qr-row';
  const text = document.createElement('input');
  text.type = 'text';
  text.value = reply.label;
  text.setAttribute('aria-label', 'Quick reply label');
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Quick reply tone');
  for (const tone of TONES) {
    const opt = document.createElement('option');
    opt.value = tone;
    opt.textContent = tone;
    if (tone === reply.tone) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }
  const preview = document.createElement('span');
  preview.className = 'mdr-status mdr-qr-preview';
  const renderPreview = (): void => {
    const tone = select.value as StatusTone;
    preview.dataset.tone = tone;
    preview.innerHTML =
      `<span class="mdr-status-glyph" aria-hidden="true">${glyphForTone(
        tone
      )}</span><span>${text.value || 'Label'}</span>`;
  };
  text.addEventListener('input', renderPreview);
  select.addEventListener('change', renderPreview);
  renderPreview();
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'mdr-iconbtn';
  remove.setAttribute('aria-label', 'Remove quick reply');
  remove.textContent = '✕';
  remove.addEventListener('click', () => row.remove());
  row.append(text, select, preview, remove);
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
      const tone = (row.querySelector('select') as HTMLSelectElement)
        .value as StatusTone;
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
    };
    persistSettings();
    controller?.setStatuses(settings.quickReplies);
    closeSettings();
    showToast('Settings saved', 'success');
  }
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.hidden) {
    closeSettings();
  }
});

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
textarea.value = initialDoc;
applyMarkdown(initialDoc);
setView('read');
