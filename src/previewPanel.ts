import * as vscode from 'vscode';
import { MarkdownCommentController } from './comments';
import { buildPanelModel } from './reviewPanel';
import { readSettings, resolveUiPrefs } from './settings';
import { StoredThread } from './storage';

interface PreviewSelection {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  text: string;
}

interface PreviewComment {
  author: string;
  body: string;
}

interface PreviewCell {
  row: number;
  col: number;
}

interface PreviewThread {
  id: string;
  line: number;
  lineText: string;
  selection?: PreviewSelection;
  cell?: PreviewCell;
  comments: PreviewComment[];
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

/**
 * Custom Markdown review preview. Renders the active document with the shared
 * preview client in a fully-controlled webview, so comments can be authored
 * per-line and per-selection. Line-level comments stay in sync with the native
 * gutter `CommentController`; everything is persisted to the `.markthread.json`
 * sidecar.
 */
export class ReviewPreviewPanel {
  private static current: ReviewPreviewPanel | undefined;

  /** Document shown by the live preview (used to resolve commands when the
   *  webview, not a text editor, is the active tab). */
  static get activeDocument(): vscode.TextDocument | undefined {
    return ReviewPreviewPanel.current?.document;
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    controller: MarkdownCommentController,
    document: vscode.TextDocument,
    column: vscode.ViewColumn = vscode.ViewColumn.Beside
  ): void {
    if (ReviewPreviewPanel.current) {
      ReviewPreviewPanel.current.bind(document);
      ReviewPreviewPanel.current.panel.reveal(
        column,
        column === vscode.ViewColumn.Beside
      );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'markThreadPreview',
      'Review Preview',
      { viewColumn: column, preserveFocus: column === vscode.ViewColumn.Beside },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: ReviewPreviewPanel.resourceRoots(
          extensionUri,
          document
        ),
      }
    );

    ReviewPreviewPanel.current = new ReviewPreviewPanel(
      panel,
      extensionUri,
      controller,
      document
    );
  }

  /** Opens (or binds) the preview and scrolls to / opens a thread at `line`. */
  static async revealLine(
    extensionUri: vscode.Uri,
    controller: MarkdownCommentController,
    uri: vscode.Uri,
    line: number
  ): Promise<void> {
    const doc =
      vscode.workspace.textDocuments.find(
        (item) => item.uri.toString() === uri.toString()
      ) ?? (await vscode.workspace.openTextDocument(uri));
    ReviewPreviewPanel.createOrShow(extensionUri, controller, doc);
    ReviewPreviewPanel.current?.revealLine(line);
  }

  /**
   * Local roots the webview may load files from: the extension assets, every
   * workspace folder, and the previewed document's own folder (covers files
   * opened outside any workspace). Lets relative Markdown images resolve.
   */
  private static resourceRoots(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument
  ): vscode.Uri[] {
    const roots = [extensionUri];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      roots.push(folder.uri);
    }
    if (document.uri.scheme === 'file') {
      roots.push(vscode.Uri.joinPath(document.uri, '..'));
    }
    return roots;
  }

  private document: vscode.TextDocument;
  private readonly disposables: vscode.Disposable[] = [];
  /** True once the webview script has reported it is ready to receive updates. */
  private ready = false;
  /** A reveal requested before the webview was ready (flushed on 'ready'). */
  private pendingReveal: number | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly controller: MarkdownCommentController,
    document: vscode.TextDocument
  ) {
    this.document = document;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message) => this.onMessage(message),
      null,
      this.disposables
    );

    // Re-render when the bound document changes on disk/in editor.
    vscode.workspace.onDidSaveTextDocument(
      (doc) => {
        if (doc.uri.toString() === this.document.uri.toString()) {
          this.postUpdate();
        }
      },
      null,
      this.disposables
    );

    // Keep the preview's comment view fresh when the gutter changes.
    this.controller.onDidChange(() => this.postUpdate());

    // Re-apply appearance live when the user edits MarkThread settings, and
    // when the VS Code color theme changes (relevant while theme is "system").
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration('markThread')) {
          this.postUpdate();
        }
      },
      null,
      this.disposables
    );
    vscode.window.onDidChangeActiveColorTheme(
      () => this.postUpdate(),
      null,
      this.disposables
    );
  }

  /** Switches the preview to a different document (reused single panel). */
  private bind(document: vscode.TextDocument): void {
    this.document = document;
    this.ready = false;
    this.panel.title = `Review Preview — ${vscode.workspace.asRelativePath(
      document.uri
    )}`;
    // Refresh the allowed resource roots so a doc in another folder can still
    // load its relative images.
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: ReviewPreviewPanel.resourceRoots(
        this.extensionUri,
        document
      ),
    };
    this.panel.webview.html = this.getHtml();
  }

  /** Scrolls the webview to a source line and opens its thread (if present). */
  revealLine(line: number): void {
    this.panel.reveal(this.panel.viewColumn, true);
    if (this.ready) {
      this.panel.webview.postMessage({ type: 'revealLine', line });
    } else {
      this.pendingReveal = line;
    }
  }

  private async onMessage(message: {
    type?: string;
    threads?: PreviewThread[];
    line?: number;
  }): Promise<void> {
    switch (message?.type) {
      case 'ready':
        this.ready = true;
        this.postUpdate();
        if (this.pendingReveal !== undefined) {
          this.panel.webview.postMessage({
            type: 'revealLine',
            line: this.pendingReveal,
          });
          this.pendingReveal = undefined;
        }
        break;
      case 'reveal':
        if (typeof message.line === 'number') {
          await vscode.commands.executeCommand(
            'markthread.revealComment',
            this.document.uri,
            message.line
          );
        }
        break;
      case 'save':
        this.save(message.threads ?? []);
        break;
    }
  }

  /**
   * Reconciles the preview's full thread set into in-memory state only. Nothing
   * is written to disk here — the user persists explicitly via "Save to file".
   */
  private save(threads: PreviewThread[]): void {
    const stored: StoredThread[] = threads.map((t) => ({
      line: t.line,
      lineText: t.lineText,
      ...(t.selection ? { selection: t.selection } : {}),
      ...(t.cell ? { cell: t.cell } : {}),
      comments: t.comments.map((c) => ({ author: c.author, body: c.body })),
    }));

    const uri = this.document.uri.toString();
    // Selection- and cell-anchored threads have no native gutter representation,
    // so keep them in the controller's in-memory store; only whole-line threads
    // mirror onto the gutter (otherwise multiple cells in one table collapse
    // onto the single table line).
    this.controller.setSelectionThreads(
      uri,
      stored.filter((t) => !!t.selection || !!t.cell)
    );
    const lineLevel = stored.filter((t) => !t.selection && !t.cell);
    this.controller.removeThreadsForUri(uri);
    this.controller.loadStoredComments(this.document, lineLevel);
  }

  /** Builds the init payload: live gutter threads + in-memory selection threads. */
  private buildThreads(): PreviewThread[] {
    const uri = this.document.uri.toString();
    const result: PreviewThread[] = [];

    const file = buildPanelModel(this.controller).find((f) => f.uri === uri);
    if (file) {
      for (const thread of file.threads) {
        result.push({
          id: `line-${thread.line}`,
          line: thread.line,
          lineText: thread.lineText,
          comments: thread.comments.map((c) => ({
            author: c.author,
            body: c.body,
          })),
        });
      }
    }

    let i = 0;
    for (const thread of this.controller.getSelectionThreads(uri)) {
      const comments = thread.comments.map((c) => ({
        author: c.author,
        body: c.body,
      }));
      if (thread.selection) {
        result.push({
          id: `sel-${i++}`,
          line: thread.line,
          lineText: thread.lineText,
          selection: thread.selection,
          comments,
        });
      } else if (thread.cell) {
        result.push({
          id: `cell-${i++}`,
          line: thread.line,
          lineText: thread.lineText,
          cell: thread.cell,
          comments,
        });
      }
    }

    return result;
  }

  private postUpdate(): void {
    const data = {
      markdown: this.document.getText(),
      threads: this.buildThreads(),
      quickReplies: readSettings().quickReplies,
      author: 'Reviewer',
      resourceBase: this.resourceBase(),
      ui: resolveUiPrefs(),
    };
    this.panel.webview.postMessage({ type: 'update', data });
  }

  /** Webview URL of the document's folder, used to resolve relative images. */
  private resourceBase(): string {
    if (this.document.uri.scheme !== 'file') {
      return '';
    }
    const dir = vscode.Uri.joinPath(this.document.uri, '..');
    return this.panel.webview.asWebviewUri(dir).toString();
  }

  private uri(...parts: string[]): vscode.Uri {
    return this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, ...parts)
    );
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const nonce = getNonce();
    const scriptUri = this.uri('dist', 'webview', 'preview.js');
    const tocUri = this.uri('media', 'toc.js');
    const baseCss = this.uri('media', 'markdown-preview.css');
    const reviewCss = this.uri('media', 'review-preview.css');

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline' https:`,
      `font-src ${webview.cspSource} https: data:`,
      `script-src 'nonce-${nonce}' 'unsafe-eval'`,
    ].join('; ');

    // Resolve appearance up front so the document paints in the right
    // language/theme/accent with no flash before the script runs.
    const ui = resolveUiPrefs();
    const htmlLang = ui.lang === 'zh' ? 'zh-CN' : 'en';
    const initData = JSON.stringify({
      markdown: '',
      threads: [],
      quickReplies: [],
      author: 'Reviewer',
      ui,
    });

    return `<!DOCTYPE html>
<html lang="${htmlLang}" data-theme="${ui.theme}" data-accent="${ui.accent}" data-width="${ui.pageWidth}">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${baseCss}" />
<link rel="stylesheet" href="${reviewCss}" />
</head>
<body class="markdown-body">
<div id="mdr-preview"></div>
<script nonce="${nonce}">window.__MDR_INIT__ = ${initData};</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
<script nonce="${nonce}" src="${tocUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    ReviewPreviewPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
