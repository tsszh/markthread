// Browser-only preview client. Renders Markdown (via the shared renderer),
// initializes charts/diagrams, and provides the review-comment UX: persistent
// gutter markers, a visible line/selection comment entry, compact Quip-style
// inline threads, and a right-hand review inbox (standalone). It is
// host-agnostic and talks to VS Code / standalone through a HostAdapter.
import mermaid from 'mermaid';
import * as echarts from 'echarts';
import { Chart, registerables } from 'chart.js';
import { renderMarkdown } from './markdownRenderer';
import { enhanceTables } from './tableEnhancer';
import { obsidianChartToChartJs, parseEchartsOption } from './charts';
import {
  DEFAULT_QUICK_REPLIES_RICH,
  glyphForTone,
  resolveStatus,
} from './defaults';
import type { QuickReply, StatusTone } from './defaults';
import { t, onLangChange, locale } from './i18n';
import type {
  HostAdapter,
  PreviewInitData,
  PreviewThread,
} from './hostAdapter';

Chart.register(...registerables);
mermaid.initialize({ startOnLoad: false, theme: 'default' });

export interface ReviewStats {
  total: number;
  open: number;
  resolved: number;
}

export interface PreviewController {
  /** Replaces the rendered document and its threads (standalone re-render). */
  setData(data: PreviewInitData): void;
  /** Current thread set (used by the standalone export/import). */
  getThreads(): PreviewThread[];
  /** Opens/closes the review inbox panel (standalone). */
  setPanelOpen(open: boolean): void;
  /** Whether the inbox panel is currently open. */
  isPanelOpen(): boolean;
  /** Replaces the configurable quick-reply verdict pills. */
  setStatuses(list: QuickReply[]): void;
  /** Scrolls to a source line and opens its comment thread (if any). */
  revealLine(line: number): void;
}

export interface MountOptions {
  /** Show the right-hand review inbox panel (standalone only). */
  sidePanel?: boolean;
  /** Display name of the reviewer (used for new comments + the "Mine" filter). */
  currentUser?: string;
  /** Notified after every change so the host chrome can show counts. */
  onStats?: (stats: ReviewStats) => void;
  /** Configurable quick-reply verdict pills (defaults to the review statuses). */
  statuses?: QuickReply[];
  /** When set, the side panel shows a "copy review to clipboard" button. */
  onCopyComments?: () => void;
}

type Filter = 'all' | 'open' | 'resolved' | 'mine';
type PanelTab = 'inbox' | 'outline';

// Block elements that merely *contain* other commentable blocks (list/table
// wrappers, quotes). We never attach the per-line comment button to these, so a
// list or table can only be commented on per item/row — not as a whole.
const CONTAINER_TAGS = new Set([
  'UL',
  'OL',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'DL',
  'BLOCKQUOTE',
]);

const ICON_PATHS: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M20 6L9 17l-5-5',
  chevron: 'M6 9l6 6 6-6',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13',
  plus: 'M12 5v14M5 12h14',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  comment: 'M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z',
  reopen: 'M4 4v6h6M20 20v-6h-6M20 9a8 8 0 0 0-14-3M4 15a8 8 0 0 0 14 3',
  copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1',
};

function icon(name: keyof typeof ICON_PATHS): string {
  return `<svg class="mdr-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[name]}"/></svg>`;
}

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function uid(): string {
  return 'th_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic pleasant avatar colour from the author name.
function avatarHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function timeAgo(ts: number | undefined): { short: string; full: string } {
  if (!ts) {
    return { short: '', full: '' };
  }
  const full = new Date(ts).toLocaleString(locale());
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) {
    return { short: t('justNow'), full };
  }
  if (min < 60) {
    return { short: t('timeMin', { n: min }), full };
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return { short: t('timeHour', { n: hr }), full };
  }
  const day = Math.floor(hr / 24);
  if (day < 7) {
    return { short: t('timeDay', { n: day }), full };
  }
  return { short: new Date(ts).toLocaleDateString(locale()), full };
}

interface Draft {
  line: number;
  lineText: string;
  selection?: PreviewThread['selection'];
  cell?: PreviewThread['cell'];
}

export function mountPreview(
  root: HTMLElement,
  adapter: HostAdapter,
  options: MountOptions = {}
): PreviewController {
  root.classList.add('mdr-root');
  root.innerHTML =
    '<div class="md-properties"></div><div class="mdr-body"></div>';
  const propsEl = root.querySelector('.md-properties') as HTMLElement;
  const contentEl = root.querySelector('.mdr-body') as HTMLElement;

  let threads: PreviewThread[] = [];
  let resourceBase = '';
  let statuses: QuickReply[] = options.statuses ?? DEFAULT_QUICK_REPLIES_RICH;
  let author = options.currentUser ?? 'Reviewer';
  let mdLines: string[] = [];
  let hoverLine: number | null = null;
  let draft: Draft | null = null;
  let loaded = false;
  let focusedId: string | null = null;
  // The comment currently being edited inline (thread id + index), if any.
  let editing: { threadId: string; index: number } | null = null;
  let filter: Filter = 'all';
  let panelTab: PanelTab = 'inbox';

  function persist(): void {
    adapter.saveThreads(threads);
    emitStats();
  }

  function emitStats(): void {
    if (!options.onStats) {
      return;
    }
    const open = threads.filter((t) => !t.resolved).length;
    options.onStats({
      total: threads.length,
      open,
      resolved: threads.length - open,
    });
  }

  function lineTextFor(line: number): string {
    return (mdLines[line] ?? '').trim();
  }

  // The exact commentable element for a line (used for gutter markers and line
  // highlighting): the most specific block whose source line matches, else the
  // nearest preceding leaf block.
  function exactAnchor(line: number): HTMLElement | null {
    const nodes = Array.from(
      contentEl.querySelectorAll<HTMLElement>('[data-source-line]')
    ).filter((n) => !CONTAINER_TAGS.has(n.tagName));
    let best: HTMLElement | null = null;
    let bestLine = -1;
    for (const node of nodes) {
      const nodeLine = Number(node.getAttribute('data-source-line'));
      if (nodeLine === line) {
        return node;
      }
      if (nodeLine <= line && nodeLine > bestLine) {
        best = node;
        bestLine = nodeLine;
      }
    }
    return best;
  }

  function findTable(line: number): HTMLTableElement | null {
    const tables = Array.from(
      contentEl.querySelectorAll<HTMLTableElement>('table[data-source-line]')
    );
    return (
      tables.find((t) => Number(t.getAttribute('data-source-line')) === line) ??
      null
    );
  }

  function findCell(thread: PreviewThread | Draft): HTMLElement | null {
    if (!thread.cell) {
      return null;
    }
    const table = findTable(thread.line);
    if (!table) {
      return null;
    }
    // Prefer the stable, sort/filter-proof row identity stamped by the table
    // enhancer; fall back to the live DOM index for un-enhanced tables.
    const row =
      table.querySelector<HTMLTableRowElement>(
        `tr[data-mdr-row="${thread.cell.row}"]`
      ) ?? table.rows[thread.cell.row];
    return (row?.cells[thread.cell.col] as HTMLElement) ?? null;
  }

  // The element a thread is anchored to (a table cell, or a line block).
  function threadAnchorEl(thread: PreviewThread): HTMLElement | null {
    return thread.cell ? findCell(thread) : exactAnchor(thread.line);
  }

  // --- Charts / diagrams ----------------------------------------------------
  let echartsInstances: echarts.ECharts[] = [];
  let chartjsInstances: { destroy(): void }[] = [];

  window.addEventListener('resize', () => {
    for (const chart of echartsInstances) {
      chart.resize();
    }
  });

  function disposeCharts(): void {
    for (const chart of echartsInstances) {
      chart.dispose();
    }
    echartsInstances = [];
    for (const chart of chartjsInstances) {
      chart.destroy();
    }
    chartjsInstances = [];
  }

  function renderCharts(): void {
    disposeCharts();

    const mermaidNodes = contentEl.querySelectorAll<HTMLElement>('pre.mermaid');
    if (mermaidNodes.length) {
      try {
        void mermaid.run({ nodes: Array.from(mermaidNodes) });
      } catch (err) {
        mermaidNodes.forEach((n) => showError(n, 'Mermaid', err));
      }
    }

    contentEl.querySelectorAll<HTMLElement>('.echarts-chart').forEach((el) => {
      const src = el.querySelector('.chart-src')?.textContent ?? '';
      const canvas = el.querySelector<HTMLElement>('.chart-canvas');
      if (!canvas) {
        return;
      }
      try {
        const option = parseEchartsOption(src);
        const chart = echarts.init(canvas);
        chart.setOption(option);
        echartsInstances.push(chart);
      } catch (err) {
        showError(canvas, 'ECharts', err);
      }
    });

    contentEl.querySelectorAll<HTMLElement>('.obsidian-chart').forEach((el) => {
      const src = el.querySelector('.chart-src')?.textContent ?? '';
      const host = el.querySelector<HTMLElement>('.chart-canvas');
      if (!host) {
        return;
      }
      try {
        const config = obsidianChartToChartJs(src);
        const canvas = document.createElement('canvas');
        host.appendChild(canvas);
        chartjsInstances.push(
          new Chart(
            canvas,
            config as unknown as ConstructorParameters<typeof Chart>[1]
          )
        );
      } catch (err) {
        showError(host, 'Chart', err);
      }
    });
  }

  function showError(el: HTMLElement, kind: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    el.innerHTML = `<div class="mdr-chart-error">⚠️ ${esc(
      t('renderFailed', { kind, message })
    )}</div>`;
  }

  // --- Shared comment pieces ------------------------------------------------
  function statusChip(status: string, tone?: string): HTMLElement {
    const r = resolveStatus(status, tone as StatusTone | undefined);
    const chip = document.createElement('span');
    chip.className = 'mdr-status';
    chip.dataset.tone = r.tone;
    chip.innerHTML =
      `<span class="mdr-status-glyph" aria-hidden="true">${esc(
        r.glyph
      )}</span>` + `<span>${esc(r.label)}</span>`;
    return chip;
  }

  function avatar(name: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'mdr-avatar';
    el.style.setProperty('--hue', String(avatarHue(name)));
    el.textContent = initials(name);
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  function commentEl(thread: PreviewThread, index: number): HTMLElement {
    const c = thread.comments[index];
    const isReply = index > 0;
    const isEditing =
      !!editing && editing.threadId === thread.id && editing.index === index;
    const el = document.createElement('div');
    el.className = 'mdr-c' + (isReply ? ' reply' : '');
    el.appendChild(avatar(c.author));

    const main = document.createElement('div');
    main.className = 'mdr-c-main';

    const meta = document.createElement('div');
    meta.className = 'mdr-c-meta';
    const name = document.createElement('span');
    name.className = 'mdr-c-name';
    name.textContent = c.author;
    meta.appendChild(name);
    const ago = timeAgo(c.createdAt);
    if (ago.short) {
      const time = document.createElement('time');
      time.className = 'mdr-c-time';
      time.textContent = ago.short;
      time.title = ago.full;
      meta.appendChild(time);
    }
    if (c.status) {
      meta.appendChild(statusChip(c.status, c.statusTone));
    }
    if (!isEditing) {
      const acts = document.createElement('span');
      acts.className = 'mdr-c-actions';
      acts.appendChild(
        iconButton('edit', t('editComment'), () => startEdit(thread.id, index))
      );
      acts.appendChild(
        iconButton('trash', t('deleteComment'), () =>
          deleteComment(thread.id, index)
        )
      );
      meta.appendChild(acts);
    }
    main.appendChild(meta);

    if (isEditing) {
      main.appendChild(
        composer(
          t('editCommentPlaceholder'),
          (text) => editComment(thread.id, index, text),
          () => {
            editing = null;
            renderThreads();
          },
          undefined,
          { initialValue: c.body ?? '', submitLabel: t('save'), autofocus: true }
        )
      );
    } else if (c.body && c.body !== c.status) {
      // A quick-reply pill stores its verdict in both `status` (for the colored
      // chip) and `body` (so it survives hosts that only persist author+body,
      // e.g. the VS Code sidecar). Skip the body when it repeats the chip.
      const body = document.createElement('div');
      body.className = 'mdr-c-body';
      body.textContent = c.body;
      main.appendChild(body);
    }
    el.appendChild(main);
    return el;
  }

  function iconButton(
    name: keyof typeof ICON_PATHS,
    label: string,
    onClick: () => void,
    extraClass = ''
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mdr-iconbtn ' + extraClass;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = icon(name);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  function quickRow(
    onPick: (label: string, tone: StatusTone) => void
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mdr-quickrow';
    for (const s of statuses) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mdr-status mdr-status-btn';
      chip.dataset.tone = s.tone;
      chip.setAttribute('aria-label', t('addVerdict', { label: s.label }));
      chip.innerHTML =
        `<span class="mdr-status-glyph" aria-hidden="true">${esc(
          s.glyph ?? glyphForTone(s.tone)
        )}</span>` + `<span>${esc(s.label)}</span>`;
      chip.addEventListener('click', () => onPick(s.label, s.tone));
      row.appendChild(chip);
    }
    return row;
  }

  // A textarea + submit row. Enter submits, Shift+Enter newlines, Esc cancels.
  function composer(
    placeholder: string,
    onSubmit: (text: string) => void,
    onCancel?: () => void,
    onFocus?: () => void,
    opts?: { initialValue?: string; submitLabel?: string; autofocus?: boolean }
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'mdr-composer';
    const ta = document.createElement('textarea');
    ta.className = 'mdr-input';
    ta.placeholder = placeholder;
    ta.rows = 1;
    ta.value = opts?.initialValue ?? '';
    ta.setAttribute('aria-label', placeholder);
    if (opts?.autofocus) {
      window.requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    }
    if (onFocus) {
      ta.addEventListener('focus', onFocus);
    }
    const actions = document.createElement('div');
    actions.className = 'mdr-composer-actions';
    const hint = document.createElement('span');
    hint.className = 'mdr-composer-hint';
    hint.textContent = t('enterToSend');
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'mdr-btn primary';
    submit.textContent = opts?.submitLabel ?? t('commentLabel');
    const doSubmit = (): void => {
      const text = ta.value.trim();
      if (text) {
        onSubmit(text);
      }
    };
    submit.addEventListener('click', doSubmit);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (onCancel) {
          onCancel();
        } else {
          ta.value = '';
          ta.blur();
        }
      }
    });
    actions.appendChild(hint);
    if (onCancel) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'mdr-btn';
      cancel.textContent = t('cancel');
      cancel.addEventListener('click', onCancel);
      actions.appendChild(cancel);
    }
    actions.appendChild(submit);
    wrap.appendChild(ta);
    wrap.appendChild(actions);
    return wrap;
  }

  function contextLabel(thread: PreviewThread | Draft): string {
    if (thread.selection?.text) {
      return '“' + thread.selection.text.slice(0, 90) + '”';
    }
    return thread.lineText || t('lineN', { n: (thread.line ?? 0) + 1 });
  }

  // --- Thread popup card ----------------------------------------------------
  function threadBlock(thread: PreviewThread): HTMLElement {
    const block = document.createElement('div');
    block.className = 'mdr-thread focused';
    if (thread.resolved) {
      block.classList.add('resolved');
    }
    block.dataset.threadId = thread.id;

    const top = document.createElement('div');
    top.className = 'mdr-thread-top';

    const ctx = document.createElement('button');
    ctx.type = 'button';
    ctx.className = 'mdr-ctx';
    ctx.innerHTML =
      `<span class="mdr-ctx-line">L${thread.line + 1}</span>` +
      `<span class="mdr-ctx-text">${esc(contextLabel(thread))}</span>`;
    ctx.title = t('jumpToLine');
    ctx.addEventListener('click', () => focusLine(thread));
    top.appendChild(ctx);

    if (thread.resolved) {
      const badge = document.createElement('span');
      badge.className = 'mdr-resolved-badge';
      badge.textContent = t('resolved');
      top.appendChild(badge);
    }

    const spacer = document.createElement('span');
    spacer.className = 'mdr-spacer';
    top.appendChild(spacer);

    top.appendChild(
      iconButton(
        thread.resolved ? 'reopen' : 'check',
        thread.resolved ? t('reopenThread') : t('resolveThread'),
        () => toggleResolved(thread.id),
        thread.resolved ? '' : 'mdr-resolve'
      )
    );
    top.appendChild(
      iconButton('trash', t('deleteThread'), () => deleteThread(thread.id))
    );
    top.appendChild(
      iconButton('close', t('close'), () => closePopup(), 'mdr-pop-close')
    );
    block.appendChild(top);

    const body = document.createElement('div');
    body.className = 'mdr-thread-body';

    for (let i = 0; i < thread.comments.length; i++) {
      body.appendChild(commentEl(thread, i));
    }

    const qr = quickRow((label, tone) =>
      addComment(thread.id, label, label, tone)
    );
    body.appendChild(qr);
    body.appendChild(
      composer(
        t('reply'),
        (text) => addComment(thread.id, text),
        undefined,
        () => qr.classList.add('show')
      )
    );
    block.appendChild(body);
    return block;
  }

  function draftBlock(d: Draft): HTMLElement {
    const block = document.createElement('div');
    block.className = 'mdr-thread mdr-draft focused';

    const top = document.createElement('div');
    top.className = 'mdr-thread-top';
    top.innerHTML =
      `<span class="mdr-ctx-line">L${d.line + 1}</span>` +
      `<span class="mdr-ctx-text">${esc(contextLabel(d))}</span>` +
      '<span class="mdr-spacer"></span>';
    top.appendChild(
      iconButton('close', t('cancel'), () => {
        draft = null;
        renderThreads();
      })
    );
    block.appendChild(top);

    const body = document.createElement('div');
    body.className = 'mdr-thread-body';
    const qr = quickRow((label, tone) => submitDraft(label, label, tone));
    body.appendChild(qr);
    body.appendChild(
      composer(
        t('writeComment'),
        (text) => submitDraft(text),
        () => {
          draft = null;
          renderThreads();
        },
        () => qr.classList.add('show')
      )
    );
    block.appendChild(body);
    return block;
  }

  // --- Mutations ------------------------------------------------------------
  function toggleResolved(id: string): void {
    const thread = threads.find((t) => t.id === id);
    if (!thread) {
      return;
    }
    thread.resolved = !thread.resolved;
    persist();
    renderThreads();
  }

  function deleteThread(id: string): void {
    threads = threads.filter((t) => t.id !== id);
    if (focusedId === id) {
      focusedId = null;
    }
    persist();
    renderThreads();
  }

  function startEdit(threadId: string, index: number): void {
    editing = { threadId, index };
    renderThreads();
  }

  function editComment(threadId: string, index: number, text: string): void {
    const thread = threads.find((t) => t.id === threadId);
    const comment = thread?.comments[index];
    if (!comment) {
      return;
    }
    comment.body = text;
    // Edited free text supersedes a one-click verdict chip.
    comment.status = undefined;
    comment.statusTone = undefined;
    editing = null;
    persist();
    renderThreads();
  }

  // Deletes a single comment; removes the whole thread if it was the last one.
  function deleteComment(threadId: string, index: number): void {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread || !thread.comments[index]) {
      return;
    }
    thread.comments.splice(index, 1);
    if (editing && editing.threadId === threadId) {
      editing = null;
    }
    if (thread.comments.length === 0) {
      threads = threads.filter((t) => t.id !== threadId);
      if (focusedId === threadId) {
        focusedId = null;
      }
    }
    persist();
    renderThreads();
  }

  function addComment(
    id: string,
    text: string,
    statusLabel?: string,
    statusTone?: StatusTone
  ): void {
    const thread = threads.find((t) => t.id === id);
    if (!thread) {
      return;
    }
    thread.comments.push({
      author,
      body: text,
      status: statusLabel,
      statusTone,
      createdAt: Date.now(),
    });
    // Dismiss the popup once the comment is saved (it lives in the side panel).
    focusedId = null;
    persist();
    renderThreads();
  }

  function submitDraft(
    text: string,
    statusLabel?: string,
    statusTone?: StatusTone
  ): void {
    if (!draft) {
      return;
    }
    const thread: PreviewThread = {
      id: uid(),
      line: draft.line,
      lineText: draft.lineText,
      selection: draft.selection,
      cell: draft.cell,
      createdAt: Date.now(),
      comments: [
        {
          author,
          body: text,
          status: statusLabel,
          statusTone,
          createdAt: Date.now(),
        },
      ],
    };
    threads.push(thread);
    // Close the composer popup after creating the comment instead of keeping
    // the new thread focused/open.
    draft = null;
    focusedId = null;
    persist();
    renderThreads();
  }

  // --- Render threads + gutter markers --------------------------------------
  function clearAnnotations(): void {
    contentEl
      .querySelectorAll('.mdr-thread')
      .forEach((n) => n.remove());
    contentEl
      .querySelectorAll('.mdr-gutter, .mdr-cell-marker')
      .forEach((n) => n.remove());
    contentEl
      .querySelectorAll(
        '.mdr-anchored, .mdr-line-focus, .mdr-cell-anchored, .mdr-cell-focus'
      )
      .forEach((n) =>
        n.classList.remove(
          'mdr-anchored',
          'mdr-line-focus',
          'mdr-cell-anchored',
          'mdr-cell-focus'
        )
      );
  }

  function renderThreads(): void {
    clearAnnotations();

    const sorted = [...threads].sort((a, b) => a.line - b.line);

    // Persistent markers: a left gutter pill for line threads, a top-right
    // badge inside the cell for table-cell threads.
    const byBlock = new Map<HTMLElement, PreviewThread[]>();
    for (const thread of sorted) {
      const el = threadAnchorEl(thread);
      if (!el) {
        continue;
      }
      const list = byBlock.get(el) ?? [];
      list.push(thread);
      byBlock.set(el, list);
    }
    for (const [el, list] of byBlock) {
      const open = list.some((t) => !t.resolved);
      const isCell = el.tagName === 'TD' || el.tagName === 'TH';
      // Show the number of comments (including follow-ups), not threads.
      const count = list.reduce((n, t) => n + t.comments.length, 0);
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className =
        (isCell ? 'mdr-cell-marker' : 'mdr-gutter') + (open ? '' : ' resolved');
      marker.setAttribute(
        'aria-label',
        isCell
          ? t('commentsOnCell', { n: count })
          : t('commentsOnLine', { n: count })
      );
      marker.title = t('viewComments', { n: count });
      marker.innerHTML =
        icon('comment') +
        `<span class="mdr-gutter-count">${count}</span>`;
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        // Re-open the existing thread (toggle closed if it's already open).
        if (!draft && focusedId === list[0].id) {
          closePopup();
        } else {
          openThread(list[0].id);
        }
      });
      el.classList.add(isCell ? 'mdr-cell-anchored' : 'mdr-anchored');
      el.appendChild(marker);
    }

    // Exactly one floating popup at a time (a draft or an open thread); it is an
    // overlay so it never reflows / interrupts the rendered document.
    renderPopup();

    renderPanel();
    emitStats();
  }

  // --- Single floating popup (draft or open thread) -------------------------
  let popAnchor: HTMLElement | null = null;

  function renderPopup(): void {
    popEl.innerHTML = '';
    popAnchor = null;
    let node: HTMLElement | null = null;

    if (draft) {
      node = draftBlock(draft);
      popAnchor = draft.cell ? findCell(draft) : exactAnchor(draft.line);
      popAnchor?.classList.add(draft.cell ? 'mdr-cell-focus' : 'mdr-line-focus');
    } else if (focusedId) {
      const thread = threads.find((t) => t.id === focusedId);
      if (thread) {
        node = threadBlock(thread);
        popAnchor = threadAnchorEl(thread);
        popAnchor?.classList.add(
          thread.cell ? 'mdr-cell-focus' : 'mdr-line-focus'
        );
      }
    }

    if (!node) {
      popEl.style.display = 'none';
      return;
    }
    popEl.appendChild(node);
    popEl.style.display = 'block';
    if (popAnchor) {
      positionPopup(popAnchor);
    }
    // Intentionally not auto-focusing the textarea so the quick-reply pills are
    // immediately clickable (and the mobile keyboard doesn't pop up).
  }

  function positionPopup(anchorEl: HTMLElement): void {
    const margin = 12;
    const popW = Math.min(420, window.innerWidth - 24);
    popEl.style.width = popW + 'px';
    const a = anchorEl.getBoundingClientRect();
    const popH = popEl.offsetHeight || 220;
    let left: number;
    let top: number;
    // The comment marker lives in the left gutter near the block's top edge, so
    // anchor the popup on the left when there's room. Otherwise drop it just
    // below the marker — but for tall blocks (charts, tables, images) cap the
    // drop to a few lines so the popup stays next to the marker instead of
    // appearing far below the whole element.
    if (a.left >= popW + margin + 4) {
      left = a.left - popW - margin;
      top = a.top;
    } else {
      left = Math.min(
        Math.max(margin, a.left),
        window.innerWidth - popW - margin
      );
      const MAX_DROP = 84;
      top = Math.min(a.bottom, a.top + MAX_DROP) + 8;
    }
    // Keep the popup within the viewport vertically when it fits.
    const maxTop = window.innerHeight - popH - margin;
    top = maxTop > margin ? Math.min(Math.max(margin, top), maxTop) : margin;
    popEl.style.left = window.scrollX + left + 'px';
    popEl.style.top = window.scrollY + top + 'px';
  }

  function closePopup(): void {
    if (!focusedId && !draft) {
      return;
    }
    focusedId = null;
    draft = null;
    editing = null;
    renderThreads();
  }

  // Open a thread's popup (from a gutter/cell marker or the inbox) and bring its
  // anchored line/cell into view.
  function openThread(id: string): void {
    focusedId = id;
    draft = null;
    renderThreads();
    if (popAnchor) {
      popAnchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.requestAnimationFrame(() => {
        if (popAnchor) {
          positionPopup(popAnchor);
        }
      });
    }
  }

  // Scroll the anchored line/cell into view (from the popup's context button).
  function focusLine(thread: PreviewThread): void {
    const el = threadAnchorEl(thread);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // --- Add-comment affordances ----------------------------------------------
  const addBtn = document.createElement('button');
  addBtn.className = 'mdr-add-btn';
  addBtn.type = 'button';
  addBtn.setAttribute('aria-label', t('addCommentLine'));
  addBtn.title = t('commentOnLine');
  addBtn.innerHTML = icon('plus');
  addBtn.style.display = 'none';
  document.body.appendChild(addBtn);

  // Single floating popup container for the active draft / open thread.
  const popEl = document.createElement('div');
  popEl.className = 'mdr-thread-pop';
  popEl.style.display = 'none';
  document.body.appendChild(popEl);

  const POP_KEEP_OPEN =
    '.mdr-thread-pop, .mdr-add-btn, .mdr-cell-add, .mdr-sel-pop, ' +
    '.mdr-gutter, .mdr-cell-marker, .mdr-inbox-item';

  // Dismiss the popup on outside click or Escape (one popup at a time).
  document.addEventListener('mousedown', (e) => {
    if (popEl.style.display === 'none') {
      return;
    }
    const t = e.target as HTMLElement;
    if (t.closest(POP_KEEP_OPEN)) {
      return;
    }
    closePopup();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popEl.style.display !== 'none') {
      closePopup();
    }
  });
  window.addEventListener('resize', () => {
    if (popEl.style.display !== 'none' && popAnchor) {
      positionPopup(popAnchor);
    }
  });

  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function showAddButtonFor(block: HTMLElement): void {
    hoverLine = Number(block.getAttribute('data-source-line'));
    const rect = block.getBoundingClientRect();
    addBtn.style.display = 'flex';
    addBtn.style.top = window.scrollY + rect.top + 'px';
    addBtn.style.left = Math.max(2, window.scrollX + rect.left - 34) + 'px';
  }

  function scheduleHideAddButton(): void {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      addBtn.style.display = 'none';
    }, 320);
  }

  function leafBlockFrom(target: HTMLElement): HTMLElement | null {
    if (target.closest('.mdr-thread') || target.closest('.mdr-gutter')) {
      return null;
    }
    const block = target.closest<HTMLElement>('[data-source-line]');
    if (!block || !contentEl.contains(block) || CONTAINER_TAGS.has(block.tagName)) {
      return null;
    }
    // Lines that already have a comment use their gutter marker to re-open it,
    // so don't also surface the "add" affordance there.
    if (block.classList.contains('mdr-anchored')) {
      return null;
    }
    return block;
  }

  // Floating per-cell comment button (top-right of a table cell).
  const cellBtn = document.createElement('button');
  cellBtn.className = 'mdr-cell-add';
  cellBtn.type = 'button';
  cellBtn.setAttribute('aria-label', t('addCommentCell'));
  cellBtn.title = t('commentOnCell');
  cellBtn.innerHTML = icon('comment');
  cellBtn.style.display = 'none';
  document.body.appendChild(cellBtn);
  let hoverCell: { line: number; row: number; col: number; text: string } | null =
    null;

  function cellInfo(
    target: HTMLElement
  ): { el: HTMLTableCellElement; line: number; row: number; col: number } | null {
    if (target.closest('.mdr-thread')) {
      return null;
    }
    const cell = target.closest<HTMLTableCellElement>('td, th');
    if (!cell || !contentEl.contains(cell)) {
      return null;
    }
    // A commented cell uses its corner marker to re-open the thread.
    if (cell.classList.contains('mdr-cell-anchored')) {
      return null;
    }
    const table = cell.closest<HTMLTableElement>('table[data-source-line]');
    if (!table) {
      return null;
    }
    const tr = cell.parentElement as HTMLTableRowElement;
    // The enhancer's per-column filter row isn't part of the author's data.
    if (tr.classList.contains('mdr-filter-row')) {
      return null;
    }
    // Anchor to the stable row identity (survives sorting/filtering) when the
    // table has been enhanced; otherwise the live DOM index.
    const stableRow = tr.getAttribute('data-mdr-row');
    return {
      el: cell,
      line: Number(table.getAttribute('data-source-line')),
      row: stableRow !== null ? Number(stableRow) : tr.rowIndex,
      col: cell.cellIndex,
    };
  }

  function showCellButtonFor(info: {
    el: HTMLTableCellElement;
    line: number;
    row: number;
    col: number;
  }): void {
    hoverCell = {
      line: info.line,
      row: info.row,
      col: info.col,
      text: (info.el.textContent ?? '').trim(),
    };
    const rect = info.el.getBoundingClientRect();
    cellBtn.style.display = 'flex';
    cellBtn.style.top = window.scrollY + rect.top + 3 + 'px';
    cellBtn.style.left = window.scrollX + rect.right - 24 + 'px';
  }

  function scheduleHideCellButton(): void {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      cellBtn.style.display = 'none';
    }, 320);
  }

  contentEl.addEventListener('mouseover', (e) => {
    const target = e.target as HTMLElement;
    const info = cellInfo(target);
    if (info) {
      clearTimeout(hideTimer);
      addBtn.style.display = 'none';
      showCellButtonFor(info);
      return;
    }
    const block = leafBlockFrom(target);
    if (!block) {
      return;
    }
    clearTimeout(hideTimer);
    cellBtn.style.display = 'none';
    showAddButtonFor(block);
  });
  contentEl.addEventListener('mouseleave', () => {
    scheduleHideAddButton();
    scheduleHideCellButton();
  });
  addBtn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  addBtn.addEventListener('mouseleave', scheduleHideAddButton);
  addBtn.addEventListener('click', () => {
    if (hoverLine === null) {
      return;
    }
    openDraftForLine(hoverLine);
    addBtn.style.display = 'none';
  });
  cellBtn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  cellBtn.addEventListener('mouseleave', scheduleHideCellButton);
  cellBtn.addEventListener('click', () => {
    if (!hoverCell) {
      return;
    }
    focusedId = null;
    draft = {
      line: hoverCell.line,
      lineText: hoverCell.text,
      cell: { row: hoverCell.row, col: hoverCell.col },
    };
    cellBtn.style.display = 'none';
    hideSelectionPopover();
    renderThreads();
  });

  function openDraftForLine(line: number): void {
    focusedId = null;
    draft = { line, lineText: lineTextFor(line) };
    hideSelectionPopover();
    renderThreads();
  }

  // Touch/click: tapping a leaf block or table cell (no selection) surfaces the
  // relevant add button so commenting is reachable without hover on touch.
  contentEl.addEventListener('click', (e) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('a, button, input, .mdr-thread, .mdr-gutter, .mdr-cell-marker')) {
      return;
    }
    const info = cellInfo(target);
    if (info) {
      showCellButtonFor(info);
      return;
    }
    const block = leafBlockFrom(target);
    if (block) {
      showAddButtonFor(block);
    }
  });

  // --- Selection popover (phrase comments; works for mouse + touch) ---------
  const selPop = document.createElement('div');
  selPop.className = 'mdr-sel-pop';
  selPop.style.display = 'none';
  selPop.innerHTML =
    `<button type="button" class="mdr-sel-btn">${icon(
      'comment'
    )}<span class="mdr-sel-label">${esc(t('commentLabel'))}</span></button>`;
  document.body.appendChild(selPop);
  let pendingSelection: Draft | null = null;

  function hideSelectionPopover(): void {
    selPop.style.display = 'none';
    pendingSelection = null;
  }

  function selectionAnchorLine(sel: Selection): number | null {
    let node: Node | null = sel.anchorNode;
    while (node && node !== contentEl) {
      if (
        node instanceof HTMLElement &&
        node.hasAttribute('data-source-line')
      ) {
        return Number(node.getAttribute('data-source-line'));
      }
      node = node.parentNode;
    }
    return null;
  }

  function maybeShowSelectionPopover(): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      hideSelectionPopover();
      return;
    }
    const range = sel.getRangeAt(0);
    if (!contentEl.contains(range.commonAncestorContainer)) {
      hideSelectionPopover();
      return;
    }
    const anchorEl =
      sel.anchorNode instanceof HTMLElement
        ? sel.anchorNode
        : sel.anchorNode?.parentElement;
    if (anchorEl?.closest('.mdr-thread')) {
      hideSelectionPopover();
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      hideSelectionPopover();
      return;
    }
    const line = selectionAnchorLine(sel) ?? 0;
    pendingSelection = {
      line,
      lineText: lineTextFor(line),
      selection: { startLine: line, startChar: 0, endLine: line, endChar: 0, text },
    };
    const rect = range.getBoundingClientRect();
    selPop.style.display = 'flex';
    const top = window.scrollY + rect.top - 44;
    selPop.style.top = Math.max(window.scrollY + 4, top) + 'px';
    selPop.style.left =
      window.scrollX + rect.left + rect.width / 2 - 56 + 'px';
  }

  selPop.querySelector('.mdr-sel-btn')?.addEventListener('mousedown', (e) => {
    // mousedown (not click) so the text selection isn't cleared first.
    e.preventDefault();
  });
  selPop.querySelector('.mdr-sel-btn')?.addEventListener('click', () => {
    if (pendingSelection) {
      focusedId = null;
      draft = pendingSelection;
      hideSelectionPopover();
      window.getSelection()?.removeAllRanges();
      renderThreads();
    }
  });

  contentEl.addEventListener('mouseup', () =>
    setTimeout(maybeShowSelectionPopover, 0)
  );
  contentEl.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift') {
      setTimeout(maybeShowSelectionPopover, 0);
    }
  });
  document.addEventListener('mousedown', (e) => {
    if (!selPop.contains(e.target as Node)) {
      hideSelectionPopover();
    }
  });
  window.addEventListener('scroll', hideSelectionPopover, { passive: true });

  // --- Compact frontmatter --------------------------------------------------
  let lastPropertiesHtml = '';
  function renderProperties(propertiesHtml: string): void {
    lastPropertiesHtml = propertiesHtml;
    if (!propertiesHtml.trim()) {
      propsEl.innerHTML = '';
      propsEl.hidden = true;
      return;
    }
    propsEl.hidden = false;
    propsEl.innerHTML =
      '<details class="mdr-props">' +
      `<summary class="mdr-props-summary"><span class="mdr-props-label">${esc(
        t('properties')
      )}</span>` +
      `<span class="mdr-props-hint">${esc(t('showDetails'))}</span></summary>` +
      `<div class="mdr-props-body">${propertiesHtml}</div>` +
      '</details>';
  }

  // --- Review inbox panel (standalone) --------------------------------------
  let panel: HTMLElement | null = null;
  let panelBody: HTMLElement | null = null;
  let panelCount: HTMLElement | null = null;
  let scrim: HTMLElement | null = null;
  let fab: HTMLButtonElement | null = null;
  let panelOpen = false;

  function setPanelOpen(open: boolean): void {
    panelOpen = open;
    if (!panel) {
      return;
    }
    panel.classList.toggle('open', open);
    document.body.classList.toggle('mdr-panel-open', open);
    scrim?.classList.toggle('show', open);
    fab?.classList.toggle('hidden', open);
    if (open) {
      renderPanel();
    }
  }

  if (options.sidePanel) {
    panel = document.createElement('aside');
    panel.className = 'mdr-side-panel';
    panel.setAttribute('aria-label', t('reviewComments'));
    panel.innerHTML =
      '<div class="mdr-side-head">' +
      `<span class="mdr-side-title">${esc(t('comments'))}</span>` +
      '<span class="mdr-side-count">0</span>' +
      '<span class="mdr-spacer"></span>' +
      '<div class="mdr-side-tabs" role="tablist">' +
      `<button type="button" class="mdr-tab" data-tab="inbox" role="tab">${esc(
        t('inbox')
      )}</button>` +
      `<button type="button" class="mdr-tab" data-tab="outline" role="tab">${esc(
        t('outline')
      )}</button>` +
      '</div>' +
      (options.onCopyComments
        ? `<button type="button" class="mdr-iconbtn mdr-side-copy" aria-label="${esc(
            t('copyToClipboard')
          )}" title="${esc(t('copyToClipboard'))}">${icon('copy')}</button>`
        : '') +
      `<button type="button" class="mdr-iconbtn mdr-side-close" aria-label="${esc(
        t('hideCommentsPanel')
      )}" title="${esc(t('hidePanel'))}">${icon('close')}</button>` +
      '</div>' +
      '<div class="mdr-side-scroll"></div>';
    document.body.appendChild(panel);
    panelBody = panel.querySelector('.mdr-side-scroll');
    panelCount = panel.querySelector('.mdr-side-count');
    panel
      .querySelector('.mdr-side-close')
      ?.addEventListener('click', () => setPanelOpen(false));
    panel
      .querySelector('.mdr-side-copy')
      ?.addEventListener('click', () => options.onCopyComments?.());
    panel.querySelectorAll<HTMLElement>('.mdr-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        panelTab = (tab.dataset.tab as PanelTab) ?? 'inbox';
        renderPanel();
      });
    });

    scrim = document.createElement('div');
    scrim.className = 'mdr-scrim';
    scrim.addEventListener('click', () => setPanelOpen(false));
    document.body.appendChild(scrim);

    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'mdr-fab';
    fab.setAttribute('aria-label', t('openComments'));
    fab.innerHTML = icon('comment') + '<span class="mdr-fab-count">0</span>';
    fab.addEventListener('click', () => setPanelOpen(true));
    document.body.appendChild(fab);

    // Mobile: a horizontal swipe opens/closes the comments drawer. Opening
    // starts from the right portion of the page (a left swipe); closing accepts
    // a rightward swipe anywhere while the panel is open. We start the open
    // zone inside the viewport (right ~40%) rather than the very edge, because
    // iOS Safari reserves the screen edge for its own back/forward gesture.
    let swipeX = 0;
    let swipeY = 0;
    let swipeTracking = false;
    document.addEventListener(
      'touchstart',
      (e) => {
        if (
          e.touches.length !== 1 ||
          !window.matchMedia('(max-width: 879px)').matches
        ) {
          swipeTracking = false;
          return;
        }
        // Don't hijack horizontal swipes that belong to a scrollable region
        // (wide tables, code blocks): those gestures must scroll the content.
        const target = e.target as HTMLElement | null;
        if (target?.closest('.mdr-table-scroll, pre')) {
          swipeTracking = false;
          return;
        }
        swipeX = e.touches[0].clientX;
        swipeY = e.touches[0].clientY;
        swipeTracking = panelOpen || swipeX > window.innerWidth * 0.6;
      },
      { passive: true }
    );
    document.addEventListener(
      'touchend',
      (e) => {
        if (!swipeTracking) {
          return;
        }
        swipeTracking = false;
        const touch = e.changedTouches[0];
        const dx = touch.clientX - swipeX;
        const dy = touch.clientY - swipeY;
        // Require a clearly horizontal swipe to avoid hijacking vertical scroll.
        if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.5) {
          return;
        }
        if (dx < 0 && !panelOpen) {
          setPanelOpen(true);
        } else if (dx > 0 && panelOpen) {
          setPanelOpen(false);
        }
      },
      { passive: true }
    );

    // Open by default on a roomy screen; start closed on small screens.
    setPanelOpen(window.matchMedia('(min-width: 880px)').matches);
  }

  function filtered(): PreviewThread[] {
    let list = [...threads];
    if (filter === 'open') {
      list = list.filter((t) => !t.resolved);
    } else if (filter === 'resolved') {
      list = list.filter((t) => t.resolved);
    } else if (filter === 'mine') {
      list = list.filter((t) =>
        t.comments.some((c) => c.author === author)
      );
    }
    return list.sort((a, b) => a.line - b.line);
  }

  function renderPanel(): void {
    if (fab) {
      const open = threads.filter((t) => !t.resolved).length;
      const fabCount = fab.querySelector('.mdr-fab-count');
      if (fabCount) {
        fabCount.textContent = String(open);
      }
      fab.classList.toggle('empty', threads.length === 0);
    }
    if (panelCount) {
      panelCount.textContent = String(threads.length);
    }
    if (!panel || !panelBody) {
      return;
    }
    panel
      .querySelectorAll<HTMLElement>('.mdr-tab')
      .forEach((t) =>
        t.classList.toggle('active', t.dataset.tab === panelTab)
      );
    panelBody.innerHTML = '';
    if (panelTab === 'outline') {
      renderOutline(panelBody);
    } else {
      renderInbox(panelBody);
    }
  }

  function renderInbox(host: HTMLElement): void {
    const bar = document.createElement('div');
    bar.className = 'mdr-filterbar';
    bar.setAttribute('role', 'tablist');
    const counts = {
      all: threads.length,
      open: threads.filter((t) => !t.resolved).length,
      resolved: threads.filter((t) => t.resolved).length,
      mine: threads.filter((t) => t.comments.some((c) => c.author === author))
        .length,
    };
    const filterLabels: Record<Filter, string> = {
      all: t('filterAll'),
      open: t('filterOpen'),
      resolved: t('filterResolved'),
      mine: t('filterMine'),
    };
    (['all', 'open', 'resolved', 'mine'] as Filter[]).forEach((f) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mdr-filter' + (filter === f ? ' active' : '');
      btn.setAttribute('aria-pressed', String(filter === f));
      btn.innerHTML =
        `<span>${esc(filterLabels[f])}</span>` +
        `<span class="mdr-filter-count">${counts[f]}</span>`;
      btn.addEventListener('click', () => {
        filter = f;
        renderPanel();
      });
      bar.appendChild(btn);
    });
    host.appendChild(bar);

    if (!loaded) {
      host.appendChild(stateBlock(t('loadingComments'), true));
      return;
    }
    if (!threads.length) {
      host.appendChild(stateBlock(t('noCommentsYet')));
      return;
    }
    const list = filtered();
    if (!list.length) {
      host.appendChild(
        stateBlock(t('noFilterComments', { label: filterLabels[filter] }))
      );
      return;
    }

    const listEl = document.createElement('div');
    listEl.className = 'mdr-inbox';
    for (const thread of list) {
      listEl.appendChild(inboxItem(thread));
    }
    host.appendChild(listEl);
  }

  function inboxItem(thread: PreviewThread): HTMLElement {
    const first = thread.comments[0];
    const last = thread.comments[thread.comments.length - 1];
    const item = document.createElement('button');
    item.type = 'button';
    item.className =
      'mdr-inbox-item' +
      (thread.resolved ? ' resolved' : '') +
      (thread.id === focusedId ? ' active' : '');
    item.dataset.threadId = thread.id;

    const head = document.createElement('div');
    head.className = 'mdr-inbox-head';
    head.appendChild(avatar(first?.author ?? author));
    const who = document.createElement('span');
    who.className = 'mdr-inbox-author';
    who.textContent = first?.author ?? author;
    head.appendChild(who);
    const ago = timeAgo(last?.createdAt ?? thread.createdAt);
    if (ago.short) {
      const time = document.createElement('time');
      time.className = 'mdr-inbox-time';
      time.textContent = ago.short;
      time.title = ago.full;
      head.appendChild(time);
    }
    const dot = document.createElement('span');
    dot.className =
      'mdr-inbox-dot ' + (thread.resolved ? 'resolved' : 'open');
    dot.title = thread.resolved ? t('resolved') : t('open');
    head.appendChild(dot);
    item.appendChild(head);

    const ctx = document.createElement('div');
    ctx.className = 'mdr-inbox-ctx';
    ctx.innerHTML =
      `<span class="mdr-ctx-line">L${thread.line + 1}</span>` +
      `<span class="mdr-inbox-ctxtext">${esc(contextLabel(thread))}</span>`;
    item.appendChild(ctx);

    const verdict = [...thread.comments].reverse().find((c) => c.status);
    if (verdict?.status) {
      item.appendChild(statusChip(verdict.status, verdict.statusTone));
    }
    const lastText = [...thread.comments].reverse().find((c) => c.body);
    if (lastText?.body) {
      const body = document.createElement('div');
      body.className = 'mdr-inbox-body';
      body.textContent = lastText.body;
      item.appendChild(body);
    }
    if (thread.comments.length > 1) {
      const meta = document.createElement('div');
      meta.className = 'mdr-inbox-meta';
      meta.textContent = t('nComments', { n: thread.comments.length });
      item.appendChild(meta);
    }

    item.addEventListener('click', () => {
      openThread(thread.id);
      if (window.matchMedia('(max-width: 879px)').matches) {
        setPanelOpen(false);
      }
    });
    return item;
  }

  function stateBlock(message: string, loading = false): HTMLElement {
    const el = document.createElement('div');
    el.className = 'mdr-side-state' + (loading ? ' loading' : '');
    if (loading) {
      el.innerHTML =
        '<div class="mdr-skel"></div><div class="mdr-skel"></div><div class="mdr-skel short"></div>';
    } else {
      el.innerHTML = `<div class="mdr-side-state-icon">${icon(
        'comment'
      )}</div><p>${esc(message)}</p>`;
    }
    return el;
  }

  function renderOutline(host: HTMLElement): void {
    const headings = Array.from(
      contentEl.querySelectorAll<HTMLElement>(
        'h1[data-source-line],h2[data-source-line],h3[data-source-line],h4[data-source-line],h5[data-source-line],h6[data-source-line]'
      )
    );
    if (!headings.length) {
      host.appendChild(stateBlock(t('noHeadings')));
      return;
    }
    const lines = headings.map((h) => Number(h.getAttribute('data-source-line')));
    const minLevel = Math.min(...headings.map((h) => Number(h.tagName[1])));
    const outline = document.createElement('div');
    outline.className = 'mdr-outline';
    headings.forEach((h, i) => {
      const start = lines[i];
      const end = i + 1 < lines.length ? lines[i + 1] : Infinity;
      const inSection = threads.filter(
        (t) => t.line >= start && t.line < end
      );
      const openCount = inSection.filter((t) => !t.resolved).length;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mdr-outline-item';
      row.style.setProperty(
        '--depth',
        String(Number(h.tagName[1]) - minLevel)
      );
      const label = document.createElement('span');
      label.className = 'mdr-outline-text';
      label.textContent = h.textContent ?? '';
      row.appendChild(label);
      if (inSection.length) {
        const badge = document.createElement('span');
        badge.className =
          'mdr-outline-badge' + (openCount ? ' open' : ' resolved');
        badge.textContent = openCount
          ? String(openCount)
          : '✓';
        badge.title = openCount
          ? t('openCommentsCount', { n: openCount })
          : t('allResolved');
        row.appendChild(badge);
      }
      row.addEventListener('click', () => {
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.matchMedia('(max-width: 879px)').matches) {
          setPanelOpen(false);
        }
      });
      outline.appendChild(row);
    });
    host.appendChild(outline);
  }

  // --- Render pipeline ------------------------------------------------------
  function render(data: PreviewInitData): void {
    threads = data.threads.map((t) => ({
      ...t,
      id: t.id || uid(),
      comments: t.comments.map((c) => ({ ...c })),
    }));
    author = options.currentUser ?? data.author ?? 'Reviewer';
    mdLines = data.markdown.split('\n');
    draft = null;
    focusedId = null;
    editing = null;

    resourceBase = data.resourceBase ?? '';

    const { html, propertiesHtml } = renderMarkdown(data.markdown);
    renderProperties(propertiesHtml);
    contentEl.innerHTML = html;
    resolveResourceUrls(contentEl);
    resolveResourceUrls(propsEl);

    // Upgrade Markdown tables to interactive grids (scroll/sort/filter/resize).
    // Reposition any open comment popup when a sort/filter/resize moves cells.
    enhanceTables(contentEl, () => {
      if (popEl.style.display !== 'none' && popAnchor) {
        positionPopup(popAnchor);
      }
    });

    renderCharts();
    loaded = true;
    renderThreads();
  }

  // Relative image/links in Markdown resolve against the webview document URL,
  // which can't see workspace files. Rewrite them against the host-provided
  // resource base (the document folder mapped through asWebviewUri).
  function resolveResourceUrls(scope: HTMLElement): void {
    if (!resourceBase) {
      return;
    }
    const base = resourceBase.endsWith('/') ? resourceBase : resourceBase + '/';
    const isAbsolute = (v: string): boolean =>
      /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(v);
    scope.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
      const raw = img.getAttribute('src') ?? '';
      if (raw && !isAbsolute(raw)) {
        try {
          img.src = new URL(raw.replace(/^\.\//, ''), base).href;
        } catch {
          /* leave untouched on malformed URLs */
        }
      }
    });
  }

  // Relabel the once-built chrome and re-render the dynamic parts when the UI
  // language changes (the document body itself is author content and is left
  // untouched).
  onLangChange(() => {
    if (panel) {
      panel.setAttribute('aria-label', t('reviewComments'));
      const title = panel.querySelector('.mdr-side-title');
      if (title) {
        title.textContent = t('comments');
      }
      panel.querySelectorAll<HTMLElement>('.mdr-tab').forEach((tab) => {
        tab.textContent = tab.dataset.tab === 'outline' ? t('outline') : t('inbox');
      });
      const close = panel.querySelector('.mdr-side-close');
      if (close) {
        close.setAttribute('aria-label', t('hideCommentsPanel'));
        close.setAttribute('title', t('hidePanel'));
      }
    }
    fab?.setAttribute('aria-label', t('openComments'));
    addBtn.setAttribute('aria-label', t('addCommentLine'));
    addBtn.title = t('commentOnLine');
    cellBtn.setAttribute('aria-label', t('addCommentCell'));
    cellBtn.title = t('commentOnCell');
    const selLabel = selPop.querySelector('.mdr-sel-label');
    if (selLabel) {
      selLabel.textContent = t('commentLabel');
    }
    renderProperties(lastPropertiesHtml);
    renderPanel();
    renderThreads();
  });

  if (adapter.onUpdate) {
    adapter.onUpdate((data) => render(data));
  }

  Promise.resolve(adapter.init()).then(render);

  return {
    setData: render,
    getThreads: () => threads,
    setPanelOpen,
    isPanelOpen: () => panelOpen,
    setStatuses: (list: QuickReply[]) => {
      statuses = list.length ? list : DEFAULT_QUICK_REPLIES_RICH;
      renderThreads();
    },
    revealLine: (line: number) => {
      const hit =
        threads.find((t) => t.line === line && !t.selection && !t.cell) ??
        threads.find((t) => t.line === line);
      if (hit) {
        openThread(hit.id);
        return;
      }
      const el = exactAnchor(line);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
  };
}
