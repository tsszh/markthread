// VS Code webview entry. Bridges the shared preview client to the extension
// host over postMessage. Initial data is injected by the panel as
// `window.__MDR_INIT__`; later document edits arrive as `update` messages.
import { mountPreview } from './previewClient';
import { setLang } from './i18n';
import type {
  HostAdapter,
  PreviewInitData,
  PreviewThread,
} from './hostAdapter';

// Applies the host-resolved appearance prefs (language/theme/accent) to the
// document root. Theme/accent drive the CSS token sets; language re-renders the
// chrome via the i18n subscribers.
function applyUi(ui: PreviewInitData['ui']): void {
  if (!ui) {
    return;
  }
  const root = document.documentElement;
  if (ui.theme) {
    root.setAttribute('data-theme', ui.theme);
  }
  if (ui.accent) {
    root.setAttribute('data-accent', ui.accent);
  }
  if (ui.pageWidth) {
    root.setAttribute('data-width', ui.pageWidth);
  }
  if (ui.lang) {
    root.lang = ui.lang === 'zh' ? 'zh-CN' : 'en';
    setLang(ui.lang);
  }
}

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

// Apply the appearance injected with the initial HTML before mounting so the
// first paint already matches the resolved language/theme/accent.
applyUi(window.__MDR_INIT__?.ui);

const root = document.getElementById('mdr-preview');
const controller = root ? mountPreview(root, adapter) : undefined;

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg && msg.type === 'update' && msg.data) {
    const data = msg.data as PreviewInitData;
    applyUi(data.ui);
    onUpdateCb?.(data);
  } else if (msg && msg.type === 'revealLine' && typeof msg.line === 'number') {
    controller?.revealLine(msg.line);
  }
});

vscode.postMessage({ type: 'ready' });
