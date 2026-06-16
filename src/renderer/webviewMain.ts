// VS Code webview entry. Bridges the shared preview client to the extension
// host over postMessage. Initial data is injected by the panel as
// `window.__MDR_INIT__`; later document edits arrive as `update` messages.
import { mountPreview } from './previewClient';
import type {
  HostAdapter,
  PreviewInitData,
  PreviewThread,
} from './hostAdapter';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;
declare global {
  interface Window {
    __MDR_INIT__?: PreviewInitData;
  }
}

const vscode = acquireVsCodeApi();

let onUpdateCb: ((data: PreviewInitData) => void) | undefined;

const adapter: HostAdapter = {
  init(): PreviewInitData {
    return (
      window.__MDR_INIT__ ?? {
        markdown: '',
        threads: [],
        quickReplies: [],
        author: 'Reviewer',
      }
    );
  },
  saveThreads(threads: PreviewThread[]): void {
    vscode.postMessage({ type: 'save', threads });
  },
  revealLine(line: number): void {
    vscode.postMessage({ type: 'reveal', line });
  },
  onUpdate(callback): void {
    onUpdateCb = callback;
  },
};

const root = document.getElementById('mdr-preview');
const controller = root ? mountPreview(root, adapter) : undefined;

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg && msg.type === 'update' && msg.data) {
    onUpdateCb?.(msg.data as PreviewInitData);
  } else if (msg && msg.type === 'revealLine' && typeof msg.line === 'number') {
    controller?.revealLine(msg.line);
  }
});

vscode.postMessage({ type: 'ready' });
