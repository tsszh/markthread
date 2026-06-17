import * as vscode from 'vscode';
import { MarkdownCommentController, ReviewCommentItem } from './comments';
import { buildPanelModel, ReviewPanelProvider } from './reviewPanel';
import { ReviewPreviewPanel } from './previewPanel';
import { formatStructured } from './core';
import { readSettings } from './settings';
import {
  deleteReview,
  isReviewableMarkdownDocument,
  readReview,
  sidecarUri,
  StoredReview,
  writeReview,
} from './storage';

let commentController: MarkdownCommentController | undefined;

function reviewForDocument(
  controller: MarkdownCommentController,
  document: vscode.TextDocument
): StoredReview | undefined {
  const file = buildPanelModel(controller).find(
    (item) => item.uri === document.uri.toString()
  );
  const lineThreads = (file?.threads ?? []).map((thread) => ({
    line: thread.line,
    // Persist the raw source line so the sidecar reflects the actual file
    // content, not the marker-stripped/trimmed text shown in the panel.
    lineText:
      thread.line >= 0 && thread.line < document.lineCount
        ? document.lineAt(thread.line).text
        : thread.lineText,
    comments: thread.comments.map((comment) => ({
      author: comment.author,
      body: comment.body,
    })),
  }));
  // Selection-anchored threads live only in the controller's in-memory store
  // (they have no native gutter representation) — include them when saving.
  const selectionThreads = controller.getSelectionThreads(
    document.uri.toString()
  );
  const comments = [...lineThreads, ...selectionThreads];
  if (comments.length === 0) {
    return undefined;
  }
  return { version: 1, comments };
}

export function activate(context: vscode.ExtensionContext): void {
  commentController = new MarkdownCommentController(context);
  const controller = commentController;

  const panelProvider = new ReviewPanelProvider(context.extensionUri, controller);

  // Whether an editor represents a real Markdown file we should track in the
  // panel. The comment input box is ALSO a markdown-language editor (for syntax
  // highlighting) but has a non-file scheme like `comment`, so focusing it must
  // not be mistaken for switching files. Unsaved (`untitled`) files count too.
  const isReviewableMarkdown = (editor?: vscode.TextEditor): boolean =>
    !!editor && isReviewableMarkdownDocument(editor.document);

  // The Markdown document that review commands act on. Prefers the active text
  // editor, but falls back to the document shown in the live preview so Copy /
  // Save work even when the rendered webview (not the raw file) is focused.
  const activeReviewDocument = (): vscode.TextDocument | undefined => {
    const editor = vscode.window.activeTextEditor;
    if (editor && isReviewableMarkdownDocument(editor.document)) {
      return editor.document;
    }
    return ReviewPreviewPanel.activeDocument;
  };

  const initialEditor = vscode.window.activeTextEditor;
  if (isReviewableMarkdown(initialEditor)) {
    panelProvider.setActiveUri(initialEditor!.document.uri.toString());
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ReviewPanelProvider.viewId,
      panelProvider
    ),

    vscode.commands.registerCommand(
      'markthread.revealComment',
      async (uri: vscode.Uri, line: number) => {
        // Untitled documents cannot be re-opened by URI; reuse the live one.
        const doc =
          vscode.workspace.textDocuments.find(
            (item) => item.uri.toString() === uri.toString()
          ) ?? (await vscode.workspace.openTextDocument(uri));
        const editor = await vscode.window.showTextDocument(doc, {
          preview: false,
        });
        const position = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      }
    )
  );

  // --- Optional per-file persistence (sidecar) -----------------------------
  // Saving is manual (Save to file). When a Markdown file is opened, any
  // previously-saved `<file>.markthread.json` sidecar is auto-loaded so the
  // review reliably comes back. Commit sidecars to share with a team.
  async function loadForDocument(document: vscode.TextDocument): Promise<void> {
    if (!isReviewableMarkdownDocument(document) || document.uri.scheme !== 'file') {
      return;
    }
    const stored = await readReview(document.uri);
    if (stored && stored.comments.length > 0) {
      controller.loadStoredComments(
        document,
        stored.comments.filter((t) => !t.selection)
      );
      controller.setSelectionThreads(
        document.uri.toString(),
        stored.comments.filter((t) => !!t.selection)
      );
    }
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      void loadForDocument(document);
      panelProvider.refresh();
    }),
    vscode.workspace.onDidCloseTextDocument(() => {
      panelProvider.refresh();
    }),
    // Follow the active editor, but only switch to real Markdown files. Ignore
    // undefined/non-Markdown transitions and the comment input box (a markdown
    // editor with a `comment` scheme) so the comment list never blanks while editing.
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (isReviewableMarkdown(editor)) {
        panelProvider.setActiveUri(editor!.document.uri.toString());
      }
    }),
    // Follow the cursor so the side panel expands the thread under it.
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (isReviewableMarkdown(event.textEditor)) {
        panelProvider.setActiveLine(event.selections[0]?.active.line);
      }
    }),
    // Settings edited outside the panel (VS Code Settings UI) refresh it too.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('markThread')) {
        panelProvider.refresh();
      }
    })
  );

  for (const document of vscode.workspace.textDocuments) {
    void loadForDocument(document);
  }

  context.subscriptions.push(
    // Keyboard submit wrapper. The built-in submit command differs across
    // builds (editor.action.submitComment vs workbench.action.submitComment),
    // so try both. Bound to several keys because Cursor's AI grabs Enter/Ctrl+Enter.
    vscode.commands.registerCommand('markthread.submit', async () => {
      for (const id of [
        'editor.action.submitComment',
        'workbench.action.submitComment',
      ]) {
        try {
          await vscode.commands.executeCommand(id);
          return;
        } catch {
          // Command not available in this build; try the next one.
        }
      }
    }),

    // Submit button for an empty thread (first comment created via the gutter +).
    vscode.commands.registerCommand(
      'markthread.createComment',
      (reply: vscode.CommentReply) => {
        controller.addComment(reply);
      }
    ),

    // Reply button for a thread that already has comments.
    vscode.commands.registerCommand(
      'markthread.replyComment',
      (reply: vscode.CommentReply) => {
        controller.addComment(reply);
      }
    ),

    vscode.commands.registerCommand(
      'markthread.deleteComment',
      (comment: ReviewCommentItem) => {
        controller.deleteComment(comment);
      }
    ),

    // In-place editing of an already submitted comment.
    vscode.commands.registerCommand(
      'markthread.editComment',
      (comment: ReviewCommentItem) => {
        controller.editComment(comment);
      }
    ),

    vscode.commands.registerCommand(
      'markthread.saveComment',
      (comment: ReviewCommentItem) => {
        controller.saveComment(comment);
      }
    ),

    vscode.commands.registerCommand(
      'markthread.cancelEditComment',
      (comment: ReviewCommentItem) => {
        controller.cancelEditComment(comment);
      }
    ),

    // Escape in the comment editor: cancel an in-progress comment edit, or
    // fall back to VS Code's default behavior (hide the comment widget).
    vscode.commands.registerCommand('markthread.cancelEdit', async () => {
      if (!controller.cancelAllEdits()) {
        await vscode.commands.executeCommand('workbench.action.hideComment');
      }
    }),

    // Quick reply from the editor comment widget: pick one of the configured
    // replies and submit it directly to the thread.
    vscode.commands.registerCommand(
      'markthread.quickReply',
      async (reply: vscode.CommentReply) => {
        const { quickReplies } = readSettings();
        if (quickReplies.length === 0) {
          vscode.window.showInformationMessage(
            'No quick replies configured. Add some in the MarkThread panel settings.'
          );
          return;
        }
        const pick = await vscode.window.showQuickPick(quickReplies, {
          placeHolder: 'Select a quick reply to submit',
        });
        if (pick) {
          controller.addComment({ thread: reply.thread, text: pick });
        }
      }
    ),

    // Expand/collapse every review thread shown in the Markdown editor.
    vscode.commands.registerCommand('markthread.expandAllThreads', () => {
      controller.setAllCollapsibleState(
        vscode.CommentThreadCollapsibleState.Expanded
      );
    }),

    vscode.commands.registerCommand('markthread.collapseAllThreads', () => {
      controller.setAllCollapsibleState(
        vscode.CommentThreadCollapsibleState.Collapsed
      );
    }),

    vscode.commands.registerCommand(
      'markthread.deleteThread',
      (thread: vscode.CommentThread) => {
        controller.deleteThread(thread);
      }
    ),

    vscode.commands.registerCommand('markthread.copyToClipboard', async () => {
      const document = activeReviewDocument();
      if (!document) {
        vscode.window.showWarningMessage('Open a Markdown file to copy review comments.');
        return;
      }

      // Only the active file's comments are collected; output fields and the
      // header prefix follow the user's copy settings.
      const threads = controller.collectReviewThreads(document);
      if (threads.length === 0) {
        vscode.window.showInformationMessage('No review comments on this file yet.');
        return;
      }

      await vscode.env.clipboard.writeText(
        formatStructured(threads, readSettings())
      );
      const count = threads.reduce((sum, t) => sum + t.comments.length, 0);
      const file = vscode.workspace.asRelativePath(document.uri);
      vscode.window.showInformationMessage(
        `Copied ${count} review comment(s) from "${file}" to clipboard.`
      );
    }),

    vscode.commands.registerCommand('markthread.saveToFile', async () => {
      const document = activeReviewDocument();
      if (!document) {
        vscode.window.showWarningMessage('Open a Markdown file to save its review comments.');
        return;
      }
      if (document.uri.scheme !== 'file') {
        vscode.window.showWarningMessage(
          'Save the Markdown file to disk first, then save its review comments.'
        );
        return;
      }

      const review = reviewForDocument(controller, document);
      if (!review) {
        vscode.window.showInformationMessage('No review comments on this file to save.');
        return;
      }

      await writeReview(document.uri, review);
      const total = review.comments.reduce((n, t) => n + t.comments.length, 0);
      const name = vscode.workspace.asRelativePath(sidecarUri(document.uri));
      vscode.window.showInformationMessage(`Saved ${total} comment(s) to "${name}".`);
    }),

    vscode.commands.registerCommand('markthread.loadFromFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isReviewableMarkdownDocument(editor.document)) {
        vscode.window.showWarningMessage('Open a Markdown file to load its saved review comments.');
        return;
      }

      const stored = await readReview(editor.document.uri);
      if (!stored || stored.comments.length === 0) {
        vscode.window.showInformationMessage('No saved review comments found for this file.');
        return;
      }

      const added = controller.loadStoredComments(
        editor.document,
        stored.comments.filter((t) => !t.selection)
      );
      controller.setSelectionThreads(
        editor.document.uri.toString(),
        stored.comments.filter((t) => !!t.selection)
      );
      vscode.window.showInformationMessage(
        added > 0
          ? `Loaded ${added} saved review comment(s).`
          : 'Saved review comments are already loaded.'
      );
    }),

    vscode.commands.registerCommand('markthread.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isReviewableMarkdownDocument(editor.document)) {
        vscode.window.showWarningMessage(
          'Open a Markdown file to launch the review preview.'
        );
        return;
      }
      ReviewPreviewPanel.createOrShow(
        context.extensionUri,
        controller,
        editor.document,
        vscode.ViewColumn.Beside
      );
    }),

    // Like the built-in Ctrl+Shift+V: replace the active editor with the
    // review preview instead of opening it to the side.
    vscode.commands.registerCommand('markthread.openPreviewInPlace', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isReviewableMarkdownDocument(editor.document)) {
        vscode.window.showWarningMessage(
          'Open a Markdown file to launch the review preview.'
        );
        return;
      }
      ReviewPreviewPanel.createOrShow(
        context.extensionUri,
        controller,
        editor.document,
        editor.viewColumn ?? vscode.ViewColumn.Active
      );
    }),

    // Counterpart to the in-place preview: when the review preview webview is
    // focused, the same keybinding (Ctrl/Cmd+Shift+V) jumps back to the
    // Markdown source editor, so the shortcut toggles between the two.
    vscode.commands.registerCommand('markthread.openSource', async () => {
      const document = ReviewPreviewPanel.activeDocument;
      if (!document) {
        return;
      }
      await vscode.window.showTextDocument(document, { preview: false });
    }),

    // Side panel "jump": open the rendered preview and scroll to / open the
    // thread there, rather than dropping the user into the raw Markdown source.
    vscode.commands.registerCommand(
      'markthread.openCommentInPreview',
      async (uri: vscode.Uri, line: number) => {
        await ReviewPreviewPanel.revealLine(
          context.extensionUri,
          controller,
          uri,
          line
        );
      }
    ),

    vscode.commands.registerCommand('markthread.clearAll', async () => {
      controller.clearAll();

      // Also remove the active file's sidecar so cleared comments don't
      // auto-reload (resurrect) the next time the file is opened.
      const editor = vscode.window.activeTextEditor;
      const document = editor?.document;
      if (
        document &&
        isReviewableMarkdownDocument(document) &&
        document.uri.scheme === 'file'
      ) {
        await deleteReview(document.uri);
      }

      vscode.window.showInformationMessage('Cleared all review comment threads.');
    })
  );
}

export function deactivate(): void {
  commentController?.dispose();
  commentController = undefined;
}
