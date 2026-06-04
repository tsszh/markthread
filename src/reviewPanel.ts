import * as vscode from 'vscode';
import { MarkdownCommentController, ReviewCommentItem } from './comments';

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
    const rawLine = doc ? doc.lineAt(line).text : '';
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
  public static readonly viewId = 'md-ai-reviewer.commentsView';

  private view?: vscode.WebviewView;
  private activeUri: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: MarkdownCommentController
  ) {
    controller.onDidChange(() => this.update());
  }

  /**
   * The file whose comments the panel shows. Set only to a real Markdown file
   * so that transient focus changes (typing in a comment box, clicking this
   * panel) never blank the list.
   */
  setActiveUri(uri: string | undefined): void {
    this.activeUri = uri;
    this.update();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message?.type) {
        case 'copy':
          vscode.commands.executeCommand('md-ai-reviewer.copyToClipboard');
          break;
        case 'save':
          vscode.commands.executeCommand('md-ai-reviewer.saveToFile');
          break;
        case 'clear':
          vscode.commands.executeCommand('md-ai-reviewer.clearAll');
          break;
        case 'reveal':
          vscode.commands.executeCommand(
            'md-ai-reviewer.revealComment',
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
      ? buildPanelModel(this.controller).filter(
          (file) => file.uri === this.activeUri
        )
      : [];
    this.view.webview.postMessage({ type: 'update', files });
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
    justify-content: flex-end;
    gap: 4px;
    margin-bottom: 8px;
  }
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
  .line-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--vscode-badge-background, #4d4d4d);
    color: var(--vscode-badge-foreground, #fff);
    flex: 0 0 auto;
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
</style>
</head>
<body>
  <div class="toolbar">
    <div class="tree-actions">
      <button id="expandAll" title="Expand all">Expand all</button>
      <button id="collapseAll" title="Collapse all">Collapse all</button>
    </div>
    <div class="big-buttons">
      <button class="big" id="copy" title="Copy structured review comments to clipboard">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M10 1H4a2 2 0 0 0-2 2v8h1.5V3a.5.5 0 0 1 .5-.5h6V1Zm2 2H6.5A1.5 1.5 0 0 0 5 4.5v9A1.5 1.5 0 0 0 6.5 15H12a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 12 3Zm0 10.5H6.5v-9H12v9Z"/></svg>
        Copy Review
      </button>
      <button class="big secondary" id="save" title="Save these comments to a sibling .ai-review.json sidecar file">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2h8.5L14 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1.5 1.5v3h5v-3h-5ZM4 9v3.5h8V9H4Z"/></svg>
        Save to file
      </button>
    </div>
    <div class="clear-row">
      <button class="link" id="clear">Clear all comments</button>
    </div>
  </div>
  <div id="content"></div>
  <div id="empty" class="empty">
    No AI review comments yet.<br /><br />
    Open a Markdown file, hover the line-number gutter, and click + to add a
    review comment. Saved comments load here automatically.
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const empty = document.getElementById('empty');

  const twisty = '<svg class="twisty" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4V4z"/></svg>';
  const jumpIcon = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M9 2v1.5h2.44L6 8.94 7.06 10 12.5 4.56V7H14V2H9zM12 13H3V4h4V2.5H3A1.5 1.5 0 0 0 1.5 4v9A1.5 1.5 0 0 0 3 14.5h9A1.5 1.5 0 0 0 13.5 13V9H12v4z"/></svg>';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render(files) {
    content.innerHTML = '';
    const total = files.reduce((n, f) => n + f.threads.reduce((m, t) => m + t.comments.length, 0), 0);
    empty.style.display = total === 0 ? 'block' : 'none';

    for (const file of files) {
      const fileEl = document.createElement('details');
      fileEl.className = 'file';
      fileEl.open = true;
      const count = file.threads.reduce((m, t) => m + t.comments.length, 0);
      const summary = document.createElement('summary');
      summary.innerHTML = twisty + '<span>' + esc(file.label) + '</span>' +
        '<span class="count">' + count + (count === 1 ? ' comment' : ' comments') + '</span>';
      fileEl.appendChild(summary);

      for (const thread of file.threads) {
        const threadEl = document.createElement('details');
        threadEl.className = 'thread';
        threadEl.open = true;
        const tSummary = document.createElement('summary');
        tSummary.innerHTML = twisty +
          '<span class="line-badge">Line ' + (thread.line + 1) + '</span>' +
          '<span class="line-text">' + esc(thread.lineText || '') + '</span>' +
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
          commentsEl.appendChild(cEl);
        }
        threadEl.appendChild(commentsEl);
        fileEl.appendChild(threadEl);
      }

      content.appendChild(fileEl);
    }
  }

  function setAllOpen(open) {
    document.querySelectorAll('#content details').forEach((d) => { d.open = open; });
  }

  document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));
  document.getElementById('save').addEventListener('click', () => vscode.postMessage({ type: 'save' }));
  document.getElementById('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
  document.getElementById('expandAll').addEventListener('click', () => {
    setAllOpen(true);
    vscode.postMessage({ type: 'expandThreads' });
  });
  document.getElementById('collapseAll').addEventListener('click', () => {
    setAllOpen(false);
    vscode.postMessage({ type: 'collapseThreads' });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'update') {
      render(msg.files || []);
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
