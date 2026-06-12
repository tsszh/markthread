import * as vscode from 'vscode';
import { MarkdownCommentController, ReviewCommentItem } from './comments';
import { buildPanelModel, ReviewPanelProvider } from './reviewPanel';
import { formatStructured } from './core';
import { readSettings } from './settings';
import {
  deleteReview,
  isReviewableMarkdownDocument,
  isSidecar,
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
  if (!file || file.threads.length === 0) {
    return undefined;
  }
  return {
    version: 1,
    comments: file.threads.map((thread) => ({
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
    })),
  };
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
      'md-ai-reviewer.revealComment',
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
  // previously-saved `<file>.ai-review.json` sidecar is auto-loaded so the
  // review reliably comes back. Commit sidecars to share with a team.
  async function loadForDocument(document: vscode.TextDocument): Promise<void> {
    if (
      document.languageId !== 'markdown' ||
      document.uri.scheme !== 'file' ||
      isSidecar(document.uri)
    ) {
      return;
    }
    const stored = await readReview(document.uri);
    if (stored && stored.comments.length > 0) {
      controller.loadStoredComments(document, stored.comments);
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
      if (event.affectsConfiguration('mdAiReviewer')) {
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
    vscode.commands.registerCommand('md-ai-reviewer.submit', async () => {
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
      'md-ai-reviewer.createComment',
      (reply: vscode.CommentReply) => {
        controller.addComment(reply);
      }
    ),

    // Reply button for a thread that already has comments.
    vscode.commands.registerCommand(
      'md-ai-reviewer.replyComment',
      (reply: vscode.CommentReply) => {
        controller.addComment(reply);
      }
    ),

    vscode.commands.registerCommand(
      'md-ai-reviewer.deleteComment',
      (comment: ReviewCommentItem) => {
        controller.deleteComment(comment);
      }
    ),

    // In-place editing of an already submitted comment.
    vscode.commands.registerCommand(
      'md-ai-reviewer.editComment',
      (comment: ReviewCommentItem) => {
        controller.editComment(comment);
      }
    ),

    vscode.commands.registerCommand(
      'md-ai-reviewer.saveComment',
      (comment: ReviewCommentItem) => {
        controller.saveComment(comment);
      }
    ),

    vscode.commands.registerCommand(
      'md-ai-reviewer.cancelEditComment',
      (comment: ReviewCommentItem) => {
        controller.cancelEditComment(comment);
      }
    ),

    // Escape in the comment editor: cancel an in-progress comment edit, or
    // fall back to VS Code's default behavior (hide the comment widget).
    vscode.commands.registerCommand('md-ai-reviewer.cancelEdit', async () => {
      if (!controller.cancelAllEdits()) {
        await vscode.commands.executeCommand('workbench.action.hideComment');
      }
    }),

    // Quick reply from the editor comment widget: pick one of the configured
    // replies and submit it directly to the thread.
    vscode.commands.registerCommand(
      'md-ai-reviewer.quickReply',
      async (reply: vscode.CommentReply) => {
        const { quickReplies } = readSettings();
        if (quickReplies.length === 0) {
          vscode.window.showInformationMessage(
            'No quick replies configured. Add some in the AI Review panel settings.'
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
    vscode.commands.registerCommand('md-ai-reviewer.expandAllThreads', () => {
      controller.setAllCollapsibleState(
        vscode.CommentThreadCollapsibleState.Expanded
      );
    }),

    vscode.commands.registerCommand('md-ai-reviewer.collapseAllThreads', () => {
      controller.setAllCollapsibleState(
        vscode.CommentThreadCollapsibleState.Collapsed
      );
    }),

    vscode.commands.registerCommand(
      'md-ai-reviewer.deleteThread',
      (thread: vscode.CommentThread) => {
        controller.deleteThread(thread);
      }
    ),

    vscode.commands.registerCommand('md-ai-reviewer.copyToClipboard', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Open a Markdown file to copy review comments.');
        return;
      }

      // Only the active file's comments are collected; output fields and the
      // header prefix follow the user's copy settings.
      const threads = controller.collectReviewThreads(editor.document);
      if (threads.length === 0) {
        vscode.window.showInformationMessage('No review comments on this file yet.');
        return;
      }

      await vscode.env.clipboard.writeText(
        formatStructured(threads, readSettings())
      );
      const count = threads.reduce((sum, t) => sum + t.comments.length, 0);
      const file = vscode.workspace.asRelativePath(editor.document.uri);
      vscode.window.showInformationMessage(
        `Copied ${count} AI review comment(s) from "${file}" to clipboard.`
      );
    }),

    vscode.commands.registerCommand('md-ai-reviewer.saveToFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Open a Markdown file to save its review comments.');
        return;
      }
      if (editor.document.uri.scheme !== 'file') {
        vscode.window.showWarningMessage(
          'Save the Markdown file to disk first, then save its review comments.'
        );
        return;
      }

      const review = reviewForDocument(controller, editor.document);
      if (!review) {
        vscode.window.showInformationMessage('No review comments on this file to save.');
        return;
      }

      await writeReview(editor.document.uri, review);
      const total = review.comments.reduce((n, t) => n + t.comments.length, 0);
      const name = vscode.workspace.asRelativePath(sidecarUri(editor.document.uri));
      vscode.window.showInformationMessage(`Saved ${total} comment(s) to "${name}".`);
    }),

    vscode.commands.registerCommand('md-ai-reviewer.loadFromFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Open a Markdown file to load its saved review comments.');
        return;
      }

      const stored = await readReview(editor.document.uri);
      if (!stored || stored.comments.length === 0) {
        vscode.window.showInformationMessage('No saved review comments found for this file.');
        return;
      }

      const added = controller.loadStoredComments(editor.document, stored.comments);
      vscode.window.showInformationMessage(
        added > 0
          ? `Loaded ${added} saved review comment(s).`
          : 'Saved review comments are already loaded.'
      );
    }),

    vscode.commands.registerCommand('md-ai-reviewer.clearAll', async () => {
      controller.clearAll();

      // Also remove the active file's sidecar so cleared comments don't
      // auto-reload (resurrect) the next time the file is opened.
      const editor = vscode.window.activeTextEditor;
      const document = editor?.document;
      if (
        document &&
        document.languageId === 'markdown' &&
        document.uri.scheme === 'file' &&
        !isSidecar(document.uri)
      ) {
        await deleteReview(document.uri);
      }

      vscode.window.showInformationMessage('Cleared all AI review comment threads.');
    })
  );
}

export function deactivate(): void {
  commentController?.dispose();
  commentController = undefined;
}
