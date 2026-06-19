import * as vscode from 'vscode';
import { MarkdownCommentController, ReviewCommentItem } from './comments';
import { describeTableCell } from './core';
import {
  readSettings,
  resetSettings,
  writeSettings,
  readAppearancePrefs,
  writeAppearance,
  AppearancePrefs,
  ReviewerSettings,
} from './settings';

export interface PanelComment {
  author: string;
  body: string;
  isReply: boolean;
}

export interface PanelThread {
  uri: string;
  line: number;
  lineText: string;
  comments: PanelComment[];
  /** Table/row/column address for cell-anchored threads (shown instead of `Line N`). */
  locationLabel?: string;
}

export interface PanelFile {
  uri: string;
  label: string;
  threads: PanelThread[];
}

function commentBody(comment: vscode.Comment): string {
  return comment.body instanceof vscode.MarkdownString
    ? comment.body.value
    : String(comment.body);
}

/**
 * Builds the file -> thread -> comment model the webview renders. Threads keep
 * their first comment plus replies nested underneath, mirroring VS Code's own
 * COMMENTS panel structure. Exported so it can be unit-tested without a webview.
 */
export function buildPanelModel(
  controller: MarkdownCommentController
): PanelFile[] {
  const byUri = new Map<string, PanelFile>();

  for (const thread of controller.getThreads()) {
    if (!thread.range) {
      continue;
    }

    const key = thread.uri.toString();
    let file = byUri.get(key);
    if (!file) {
      file = {
        uri: key,
        label: vscode.workspace.asRelativePath(thread.uri),
        threads: [],
      };
      byUri.set(key, file);
    }

    const doc = vscode.workspace.textDocuments.find(
      (item) => item.uri.toString() === key
    );
    const line = thread.range.start.line;
    const rawLine =
      doc && line < doc.lineCount
        ? doc.lineAt(line).text
        : controller.getLineText(thread);
    const lineText = rawLine
      .replace(/<!--\s*ai-review[\s\S]*?-->/g, '')
      .trim();

    const comments: PanelComment[] = thread.comments.map((comment, index) => ({
      author: (comment as ReviewCommentItem).author?.name ?? 'Reviewer',
      body: commentBody(comment),
      isReply: index > 0,
    }));

    file.threads.push({ uri: key, line, lineText, comments });
  }

  for (const file of byUri.values()) {
    file.threads.sort((a, b) => a.line - b.line);
  }

  return [...byUri.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Panel model including the in-memory selection-/cell-anchored threads that
 * have no native gutter representation. Used only by the review panel webview
 * so its list matches what is actually stored (gutter threads + detached
 * threads). Other consumers of `buildPanelModel` deliberately exclude these so
 * they aren't double-counted alongside `getSelectionThreads`.
 */
export function buildReviewPanelModel(
  controller: MarkdownCommentController
): PanelFile[] {
  const byUri = new Map<string, PanelFile>();
  for (const file of buildPanelModel(controller)) {
    byUri.set(file.uri, file);
  }

  for (const [uri, threads] of controller.getDetachedThreadsByUri()) {
    if (!threads.length) {
      continue;
    }
    let file = byUri.get(uri);
    if (!file) {
      file = {
        uri,
        label: vscode.workspace.asRelativePath(vscode.Uri.parse(uri)),
        threads: [],
      };
      byUri.set(uri, file);
    }
    const doc = vscode.workspace.textDocuments.find(
      (item) => item.uri.toString() === uri
    );
    const docLines = doc?.getText().split('\n');
    for (const thread of threads) {
      const locationLabel =
        thread.cell && docLines
          ? describeTableCell(docLines, thread.line, thread.cell)
          : undefined;
      file.threads.push({
        uri,
        line: thread.line,
        lineText: (thread.selection?.text || thread.lineText || '').trim(),
        locationLabel,
        comments: thread.comments.map((comment, index) => ({
          author: comment.author,
          body: comment.body,
          isReply: index > 0,
        })),
      });
    }
  }

  for (const file of byUri.values()) {
    file.threads.sort((a, b) => a.line - b.line);
  }
  return [...byUri.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function getNonce(): string {
  let text = '';
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export class ReviewPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'markthread.commentsView';

  private view?: vscode.WebviewView;
  private activeUri: string | undefined;
  /** Line of the thread that should render expanded in the panel. */
  private activeLine: number | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: MarkdownCommentController
  ) {
    controller.onDidChange(() => {
      // A just-added/edited comment becomes the active (expanded) thread.
      const lastActive = controller.lastActive;
      if (lastActive && lastActive.uri === this.activeUri) {
        this.activeLine = lastActive.line;
      }
      this.update();
    });
  }

  /**
   * The file whose comments the panel shows. Set only to a real Markdown file
   * so that transient focus changes (typing in a comment box, clicking this
   * panel) never blank the list.
   */
  setActiveUri(uri: string | undefined): void {
    if (uri !== this.activeUri) {
      this.activeLine = undefined;
    }
    this.activeUri = uri;
    this.update();
  }

  /** Follows the cursor so the thread under it renders expanded. */
  setActiveLine(line: number | undefined): void {
    if (line === this.activeLine) {
      return;
    }
    this.activeLine = line;
    this.update();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message?.type) {
        case 'copy':
          vscode.commands.executeCommand('markthread.copyToClipboard');
          break;
        case 'save':
          vscode.commands.executeCommand('markthread.saveToFile');
          break;
        case 'clear':
          vscode.commands.executeCommand('markthread.clearAll');
          break;
        case 'reveal':
          vscode.commands.executeCommand(
            'markthread.openCommentInPreview',
            vscode.Uri.parse(message.uri),
            message.line
          );
          break;
        case 'expandThreads':
          this.controller.setAllCollapsibleState(
            vscode.CommentThreadCollapsibleState.Expanded
          );
          break;
        case 'collapseThreads':
          this.controller.setAllCollapsibleState(
            vscode.CommentThreadCollapsibleState.Collapsed
          );
          break;
        case 'saveSettings':
          await writeSettings(
            (message.settings ?? {}) as Partial<ReviewerSettings>
          );
          this.update();
          break;
        case 'setAppearance':
          // Appearance pickers apply live (the open Review Preview reacts to the
          // config change), so persist immediately and refresh the panel.
          await writeAppearance(
            (message.prefs ?? {}) as Partial<AppearancePrefs>
          );
          this.update();
          break;
        case 'resetSettings':
          await resetSettings();
          this.update();
          // Dedicated message so the open settings form re-populates with the
          // defaults (regular updates never clobber in-progress form edits).
          this.view?.webview.postMessage({
            type: 'settingsReset',
            settings: readSettings(),
            appearance: readAppearancePrefs(),
          });
          break;
        case 'ready':
          this.update();
          break;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.update();
      }
    });

    this.update();
  }

  /** Public trigger for when editors open/close (the panel filters on them). */
  refresh(): void {
    this.update();
  }

  private update(): void {
    if (!this.view) {
      return;
    }
    // Only surface comments for the active Markdown file, so the Copy/Save
    // actions (which target that file) always match what's shown.
    const files = this.activeUri
      ? buildReviewPanelModel(this.controller).filter(
          (file) => file.uri === this.activeUri
        )
      : [];
    this.view.webview.postMessage({
      type: 'update',
      files,
      activeLine: this.activeLine ?? null,
      settings: readSettings(),
      appearance: readAppearancePrefs(),
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 2;
    padding: 10px 10px 8px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
  }
  .tree-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }
  .group-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    margin-right: 2px;
  }
  .group-label + .group-label { margin-left: 8px; }
  .tree-actions .spacer { flex: 1 1 auto; }
  .tree-actions button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    cursor: pointer;
    opacity: 0.85;
  }
  .tree-actions button:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18));
    opacity: 1;
  }
  .action-group {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
    border-radius: 4px;
    padding: 1px 3px;
  }
  .action-group + .action-group { margin-left: 6px; }
  .big-buttons {
    display: flex;
    gap: 8px;
  }
  button.big {
    flex: 1 1 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 8px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.big.secondary {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ffffff);
  }
  button.big:hover { background: var(--vscode-button-hoverBackground); }
  button.big.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
  }
  button.big svg { width: 16px; height: 16px; flex: 0 0 auto; }
  .clear-row { text-align: center; margin-top: 8px; }
  button.link {
    background: none;
    border: none;
    color: var(--vscode-textLink-foreground, #3794ff);
    cursor: pointer;
    font-size: 11px;
    text-decoration: underline;
    padding: 2px 6px;
  }
  button.link:hover { color: var(--vscode-textLink-activeForeground, #4daafc); }
  #content { padding: 4px 0 16px; }
  .empty {
    padding: 24px 16px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    line-height: 1.5;
    font-size: 12px;
  }
  details.file { border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.18)); }
  details.file > summary {
    list-style: none;
    cursor: pointer;
    padding: 8px 10px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
    user-select: none;
  }
  details.file > summary::-webkit-details-marker { display: none; }
  .twisty { transition: transform 0.12s ease; opacity: 0.7; }
  details[open] > summary .twisty { transform: rotate(90deg); }
  .count {
    margin-left: auto;
    font-weight: 400;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  details.thread { margin: 0 0 2px 14px; }
  details.thread > summary {
    list-style: none;
    cursor: pointer;
    padding: 5px 10px 5px 6px;
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 4px;
    user-select: none;
  }
  details.thread > summary::-webkit-details-marker { display: none; }
  details.thread > summary:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12)); }
  details.thread.active > summary {
    background: var(--vscode-list-activeSelectionBackground, rgba(128,128,255,0.14));
  }
  .line-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--vscode-badge-background, #4d4d4d);
    color: var(--vscode-badge-foreground, #fff);
    flex: 0 1 auto;
    min-width: 0;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line-text {
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-style: italic;
  }
  .jump {
    margin-left: auto;
    background: transparent;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    opacity: 0.6;
    padding: 2px;
    border-radius: 4px;
    flex: 0 0 auto;
  }
  .jump:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .comments { padding: 2px 10px 8px 22px; }
  .comment {
    padding: 6px 8px;
    border-left: 2px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    margin: 4px 0;
    cursor: pointer;
    border-radius: 0 4px 4px 0;
  }
  .comment:hover {
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12));
  }
  .comment.reply {
    margin-left: 16px;
    border-left-color: var(--vscode-textLink-foreground, #3794ff);
  }
  .comment .author {
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-foreground);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .comment .reply-tag {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--vscode-textLink-foreground, #3794ff);
    color: #fff;
  }
  .comment .body {
    margin-top: 3px;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
  button.pill {
    background: var(--vscode-badge-background, #4d4d4d);
    color: var(--vscode-badge-foreground, #fff);
    border: none;
    border-radius: 10px;
    padding: 2px 10px;
    font-size: 11px;
    cursor: pointer;
    opacity: 0.9;
  }
  button.pill:hover { opacity: 1; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .settings {
    padding: 10px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  .settings h3 {
    margin: 10px 0 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
  }
  .settings h3:first-child { margin-top: 0; }
  .settings label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    margin: 4px 0;
    cursor: pointer;
  }
  .settings input[type="text"], .settings textarea {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.35));
    border-radius: 4px;
    padding: 4px 6px;
    font-family: inherit;
    font-size: 12px;
  }
  .settings textarea { resize: vertical; min-height: 80px; }
  .qr-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 4px 0;
  }
  .qr-row button {
    background: transparent;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    opacity: 0.7;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
    flex: 0 0 auto;
  }
  .qr-row button:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .settings .row-actions { display: flex; gap: 8px; margin-top: 10px; }
  .settings .row-actions button.big { padding: 6px 8px; }
  /* Appearance controls */
  .appr-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 0;
  }
  .appr-label {
    flex: 0 0 58px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    border-radius: 6px;
    overflow: hidden;
  }
  .seg button {
    background: transparent;
    color: var(--vscode-foreground);
    border: none;
    border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    padding: 4px 11px;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    opacity: 0.85;
  }
  .seg button:first-child { border-left: none; }
  .seg button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); opacity: 1; }
  .seg button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    opacity: 1;
  }
  .swatches { display: inline-flex; gap: 8px; }
  .swatch-btn {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid transparent;
    box-shadow: 0 0 0 1px var(--vscode-panel-border, rgba(128,128,128,0.4));
    cursor: pointer;
    padding: 0;
    transition: transform 0.1s ease;
  }
  .swatch-btn:hover { transform: scale(1.12); }
  .swatch-btn.active {
    border-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
    box-shadow: 0 0 0 2px var(--vscode-focusBorder, #4daafc);
  }
</style>
</head>
<body>
  <div class="toolbar">
    <div class="tree-actions">
      <span class="group-label">Panel</span>
      <span class="action-group">
        <button id="panelExpandAll" title="Expand all threads in this panel">Expand</button>
        <button id="panelCollapseAll" title="Collapse all threads in this panel">Collapse</button>
      </span>
      <span class="group-label">Editor</span>
      <span class="action-group">
        <button id="editorExpandAll" title="Expand all comment threads in the Markdown editor">Expand</button>
        <button id="editorCollapseAll" title="Collapse all comment threads in the Markdown editor">Collapse</button>
      </span>
      <span class="spacer"></span>
      <button id="settingsBtn" title="MarkThread settings">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.1 4.4 8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.2.7-2.4.5v1.2l2.4.5.3.8-1.3 2 .8.8 2-1.3.8.3.4 2.3h1.2l.5-2.4.8-.3 2 1.3.8-.8-1.3-2 .3-.8 2.3-.4V7.4l-2.4-.5-.3-.8 1.3-2-.8-.8-2 1.3-.7-.2zM8 10.3A2.3 2.3 0 1 1 8 5.7a2.3 2.3 0 0 1 0 4.6z"/></svg>
      </button>
    </div>
    <div class="big-buttons">
      <button class="big" id="copy" title="Copy structured review comments to clipboard">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M10 1H4a2 2 0 0 0-2 2v8h1.5V3a.5.5 0 0 1 .5-.5h6V1Zm2 2H6.5A1.5 1.5 0 0 0 5 4.5v9A1.5 1.5 0 0 0 6.5 15H12a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 12 3Zm0 10.5H6.5v-9H12v9Z"/></svg>
        Copy Review
      </button>
      <button class="big secondary" id="save" title="Save these comments to a sibling .markthread.json sidecar file">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2h8.5L14 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1.5 1.5v3h5v-3h-5ZM4 9v3.5h8V9H4Z"/></svg>
        Save to file
      </button>
    </div>
    <div class="clear-row">
      <button class="link" id="clear">Clear all comments</button>
    </div>
  </div>
  <div id="settings" class="settings" hidden>
    <h3>Appearance</h3>
    <div class="appr-row">
      <span class="appr-label">Language</span>
      <div class="seg" id="apprLang">
        <button data-val="auto" title="Follow VS Code's display language">Auto</button>
        <button data-val="en">EN</button>
        <button data-val="zh">中</button>
      </div>
    </div>
    <div class="appr-row">
      <span class="appr-label">Theme</span>
      <div class="seg" id="apprTheme">
        <button data-val="system" title="Follow the active VS Code color theme">System</button>
        <button data-val="light">Light</button>
        <button data-val="dark">Dark</button>
      </div>
    </div>
    <div class="appr-row">
      <span class="appr-label">Accent</span>
      <div class="swatches" id="apprAccent"></div>
    </div>
    <h3>Quick replies</h3>
    <div id="qrList"></div>
    <div class="row-actions">
      <button class="link" id="qrAdd">+ Add quick reply</button>
    </div>
    <h3>Copy content</h3>
    <label><input type="checkbox" id="optFileName" /> File name</label>
    <label><input type="checkbox" id="optLineNumber" /> Line number</label>
    <label><input type="checkbox" id="optLineText" /> Line content</label>
    <label><input type="checkbox" id="optComment" /> Comment content</label>
    <h3>Copy header template</h3>
    <textarea id="optHeader" rows="6" placeholder="Prefix prepended to the copied review..."></textarea>
    <div class="row-actions">
      <button class="big" id="settingsSave">Save settings</button>
      <button class="big secondary" id="settingsClose">Close</button>
    </div>
    <div class="clear-row">
      <button class="link" id="settingsReset" title="Restore quick replies, copy options and the header template to their defaults">Reset to defaults</button>
    </div>
  </div>
  <div id="content"></div>
  <div id="empty" class="empty">
    No review comments yet.<br /><br />
    Open a Markdown file, hover the line-number gutter, and click + to add a
    review comment. Saved comments load here automatically.
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const empty = document.getElementById('empty');
  const settingsEl = document.getElementById('settings');
  const qrList = document.getElementById('qrList');

  const twisty = '<svg class="twisty" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4V4z"/></svg>';
  const jumpIcon = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M9 2v1.5h2.44L6 8.94 7.06 10 12.5 4.56V7H14V2H9zM12 13H3V4h4V2.5H3A1.5 1.5 0 0 0 1.5 4v9A1.5 1.5 0 0 0 3 14.5h9A1.5 1.5 0 0 0 13.5 13V9H12v4z"/></svg>';

  let latest = { files: [], activeLine: null, settings: null, appearance: null };
  // Remembers the user's manual expand/collapse choices across re-renders.
  const openState = new Map();

  // Appearance palette swatches (colours mirror the preview's accent palettes).
  const APPR_ACCENTS = [
    { id: 'oxblood', dot: '#8a2f3b', label: 'Oxblood (deep red)' },
    { id: 'ink', dot: '#26262b', label: 'Graphite ink' },
    { id: 'pine', dot: '#1f6f4f', label: 'Pine green' },
    { id: 'terracotta', dot: '#b4502f', label: 'Terracotta' },
    { id: 'petrol', dot: '#0e6e72', label: 'Petrol teal' },
  ];
  let appr = { language: 'auto', theme: 'system', accent: 'oxblood' };

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function threadKey(thread) { return thread.uri + '#' + thread.line; }

  function render() {
    const files = latest.files;
    const activeLine = latest.activeLine;

    content.innerHTML = '';
    const total = files.reduce((n, f) => n + f.threads.reduce((m, t) => m + t.comments.length, 0), 0);
    empty.style.display = total === 0 ? 'block' : 'none';

    for (const file of files) {
      const fileEl = document.createElement('details');
      fileEl.className = 'file';
      fileEl.open = openState.has(file.uri) ? openState.get(file.uri) : true;
      fileEl.addEventListener('toggle', () => openState.set(file.uri, fileEl.open));
      const count = file.threads.reduce((m, t) => m + t.comments.length, 0);
      const summary = document.createElement('summary');
      summary.innerHTML = twisty + '<span>' + esc(file.label) + '</span>' +
        '<span class="count">' + count + (count === 1 ? ' comment' : ' comments') + '</span>';
      fileEl.appendChild(summary);

      for (const thread of file.threads) {
        const key = threadKey(thread);
        const isActive = activeLine !== null && thread.line === activeLine;
        const threadEl = document.createElement('details');
        threadEl.className = 'thread' + (isActive ? ' active' : '');
        // Threads are collapsed by default; only the active thread (cursor
        // line / latest comment) opens, unless the user toggled it manually.
        threadEl.open = openState.has(key) ? openState.get(key) : isActive;
        threadEl.addEventListener('toggle', () => openState.set(key, threadEl.open));
        const tSummary = document.createElement('summary');
        // Cell-anchored threads show their table/row/column address (and the
        // cell content as the context text); line threads show the line number.
        const badge = thread.locationLabel
          ? esc(thread.locationLabel)
          : 'Line ' + (thread.line + 1);
        const ctx = esc(thread.lineText || '');
        tSummary.innerHTML = twisty +
          '<span class="line-badge"' +
          (thread.locationLabel ? ' title="' + esc(thread.locationLabel) + '"' : '') +
          '>' + badge + '</span>' +
          '<span class="line-text" title="' + ctx + '">' + ctx + '</span>' +
          '<button class="jump" title="Jump to line">' + jumpIcon + '</button>';
        threadEl.appendChild(tSummary);

        const jumpBtn = tSummary.querySelector('.jump');
        jumpBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          vscode.postMessage({ type: 'reveal', uri: thread.uri, line: thread.line });
        });

        const commentsEl = document.createElement('div');
        commentsEl.className = 'comments';
        for (const c of thread.comments) {
          const cEl = document.createElement('div');
          cEl.className = 'comment' + (c.isReply ? ' reply' : '');
          const tag = c.isReply ? '<span class="reply-tag">reply</span>' : '';
          cEl.innerHTML =
            '<div class="author">' + esc(c.author) + tag + '</div>' +
            '<div class="body">' + esc(c.body) + '</div>';
          // Clicking a comment opens the rendered preview at that thread, where
          // it can be read, replied to and edited (the panel itself is read-only).
          cEl.title = 'Open in review preview';
          cEl.addEventListener('click', () => {
            vscode.postMessage({ type: 'reveal', uri: thread.uri, line: thread.line });
          });
          commentsEl.appendChild(cEl);
        }

        threadEl.appendChild(commentsEl);
        fileEl.appendChild(threadEl);
      }

      content.appendChild(fileEl);
    }
  }

  function setAllOpen(open) {
    // Only threads collapse; file nodes stay open so the panel never looks empty.
    document.querySelectorAll('#content details.thread').forEach((d) => {
      d.open = open;
    });
    document.querySelectorAll('#content details.file').forEach((d) => {
      d.open = true;
    });
    for (const file of latest.files) {
      openState.set(file.uri, true);
      for (const thread of file.threads) {
        openState.set(threadKey(thread), open);
      }
    }
  }

  // --- Settings panel -------------------------------------------------------
  function addQrRow(value) {
    const row = document.createElement('div');
    row.className = 'qr-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = 'Quick reply text';
    const remove = document.createElement('button');
    remove.textContent = '✕';
    remove.title = 'Remove';
    remove.addEventListener('click', () => row.remove());
    row.appendChild(input);
    row.appendChild(remove);
    qrList.appendChild(row);
  }

  function setSeg(id, val) {
    document.querySelectorAll('#' + id + ' button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.val === val);
    });
  }

  function renderAppearance() {
    setSeg('apprLang', appr.language);
    setSeg('apprTheme', appr.theme);
    const wrap = document.getElementById('apprAccent');
    wrap.innerHTML = '';
    for (const a of APPR_ACCENTS) {
      const b = document.createElement('button');
      b.className = 'swatch-btn' + (a.id === appr.accent ? ' active' : '');
      b.style.background = a.dot;
      b.title = a.label;
      b.addEventListener('click', () => setAppr('accent', a.id));
      wrap.appendChild(b);
    }
  }

  // Appearance changes apply live: persist to config and update the swatches.
  function setAppr(key, val) {
    appr = Object.assign({}, appr, { [key]: val });
    renderAppearance();
    vscode.postMessage({ type: 'setAppearance', prefs: { [key]: val } });
  }

  document.getElementById('apprLang').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-val]');
    if (btn) { setAppr('language', btn.dataset.val); }
  });
  document.getElementById('apprTheme').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-val]');
    if (btn) { setAppr('theme', btn.dataset.val); }
  });

  function populateSettings() {
    if (latest.appearance) {
      appr = Object.assign({ language: 'auto', theme: 'system', accent: 'oxblood' }, latest.appearance);
    }
    renderAppearance();
    const s = latest.settings;
    if (!s) { return; }
    qrList.innerHTML = '';
    for (const reply of s.quickReplies) { addQrRow(reply); }
    document.getElementById('optFileName').checked = !!s.includeFileName;
    document.getElementById('optLineNumber').checked = !!s.includeLineNumber;
    document.getElementById('optLineText').checked = !!s.includeLineText;
    document.getElementById('optComment').checked = !!s.includeComment;
    document.getElementById('optHeader').value = s.headerTemplate || '';
  }

  document.getElementById('settingsBtn').addEventListener('click', () => {
    if (settingsEl.hidden) {
      populateSettings();
      settingsEl.hidden = false;
    } else {
      settingsEl.hidden = true;
    }
  });
  document.getElementById('settingsClose').addEventListener('click', () => {
    settingsEl.hidden = true;
  });
  document.getElementById('qrAdd').addEventListener('click', () => addQrRow(''));
  document.getElementById('settingsReset').addEventListener('click', () => {
    vscode.postMessage({ type: 'resetSettings' });
  });
  document.getElementById('settingsSave').addEventListener('click', () => {
    const quickReplies = [...qrList.querySelectorAll('input')]
      .map((i) => i.value.trim())
      .filter((v) => v.length > 0);
    vscode.postMessage({
      type: 'saveSettings',
      settings: {
        quickReplies,
        includeFileName: document.getElementById('optFileName').checked,
        includeLineNumber: document.getElementById('optLineNumber').checked,
        includeLineText: document.getElementById('optLineText').checked,
        includeComment: document.getElementById('optComment').checked,
        headerTemplate: document.getElementById('optHeader').value,
      },
    });
    settingsEl.hidden = true;
  });

  // --- Toolbar --------------------------------------------------------------
  document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));
  document.getElementById('save').addEventListener('click', () => vscode.postMessage({ type: 'save' }));
  document.getElementById('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
  document.getElementById('panelExpandAll').addEventListener('click', () => setAllOpen(true));
  document.getElementById('panelCollapseAll').addEventListener('click', () => setAllOpen(false));
  document.getElementById('editorExpandAll').addEventListener('click', () => vscode.postMessage({ type: 'expandThreads' }));
  document.getElementById('editorCollapseAll').addEventListener('click', () => vscode.postMessage({ type: 'collapseThreads' }));

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'settingsReset') {
      latest.settings = msg.settings || latest.settings;
      latest.appearance = msg.appearance || latest.appearance;
      if (!settingsEl.hidden) {
        populateSettings();
      }
      render();
      return;
    }
    if (msg && msg.type === 'update') {
      const prevActive = latest.activeLine;
      latest = {
        files: msg.files || [],
        activeLine: msg.activeLine === undefined ? null : msg.activeLine,
        settings: msg.settings || latest.settings,
        appearance: msg.appearance || latest.appearance,
      };
      // Keep the appearance pickers in sync if config changed elsewhere.
      if (!settingsEl.hidden && latest.appearance) {
        appr = Object.assign({ language: 'auto', theme: 'system', accent: 'oxblood' }, latest.appearance);
        renderAppearance();
      }
      if (latest.activeLine !== prevActive && latest.activeLine !== null) {
        // A newly-active thread always opens, even if previously collapsed.
        for (const file of latest.files) {
          openState.delete(file.uri + '#' + latest.activeLine);
        }
      }
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
