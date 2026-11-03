import { hasSavedContext, type AppSettings, type CurrentLookup, type LearningItem, type RuntimeResponse, type SelectionContext } from '@lexiside/shared';
import interFontUrl from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import { eventPathContains } from '../lib/shadow-events';
import { SPEECH_WAIT_TIP_TEXT } from '../lib/speech-wait';
import { escapeHtml, savedContextsHtml, selectionLemma } from '../lib/reencounter';
import { withLocalTranslationTimeout } from '../lib/local-translation';

type UiMode = 'hidden' | 'action' | 'loading' | 'result' | 'error';

interface ViewState {
  mode: UiMode;
  rect?: DOMRect;
  context?: SelectionContext;
  message?: string;
  downloadProgress?: number;
  analysisCount?: number;
  saved?: boolean;
  saving?: boolean;
  confirmingSave?: boolean;
  saveDraft?: string;
  copied?: boolean;
  meaningSource?: 'quick' | 'context' | 'confirmed';
  sidePanelOpen?: boolean;
  speechWaitTip?: boolean;
  savedMatches?: LearningItem[];
  matchesPending?: boolean;
  matchLemma?: string;
  appendItemId?: string;
}

const MAX_SELECTION_LENGTH = 2_000;
const SINGLE_WORD = /^[A-Za-z][A-Za-z'-]*$/;
const BLOCK_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'TD', 'TH', 'ARTICLE', 'SECTION', 'MAIN', 'DIV']);
const icon = (paths: string): string => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
const ICONS = {
  speak: icon('<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'),
  copy: icon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  check: icon('<path d="m20 6-11 11-5-5"/>'),
  panelOpen: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18M10 9l-3 3 3 3"/>'),
  panelClose: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18M7 9l3 3-3 3"/>'),
};

let settings: AppSettings | null = null;
let translatorPromise: Promise<TranslatorInstance> | null = null;
let activeRequestId = '';
let autoSaveRequestId = '';
let analyzeRequestId = '';
let currentState: ViewState = { mode: 'hidden' };
let sidePanelOpen = false;
let focusResultOnReady = false;
let focusReturnElement: HTMLElement | null = null;
const pendingSpeechRequests = new Set<string>();
let matchesRequest = 0;

function createSurface(): { host: HTMLDivElement; root: ShadowRoot; panel: HTMLDivElement } {
  const host = document.createElement('div');
  host.id = 'lexiside-extension-root';
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      @font-face { font-family: 'LexiSide Inter'; font-style: normal; font-weight: 100 900; font-display: swap; src: url('${interFontUrl}') format('woff2-variations'); }
      :host {
        color-scheme: light;
        --lexi-bg: #fff;
        --lexi-text: #172033;
        --lexi-muted: #667085;
        --lexi-border: #e3e7ee;
        --lexi-primary: #4f46e5;
        --lexi-soft: #f3f2ff;
        --lexi-hover: #e8e6ff;
        --lexi-success: #168a4b;
        --lexi-success-bg: #edf8f1;
        --lexi-error: #c43d3d;
        --lexi-shadow: 0 12px 36px rgba(23, 32, 51, .18);
        --lexi-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      :host(.lexi-inter) { --lexi-font: 'LexiSide Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
      *, *::before, *::after { box-sizing: border-box; }
      #surface {
        position: fixed;
        inset: 0;
        pointer-events: none;
        font-family: var(--lexi-font);
        color: var(--lexi-text);
      }
      .lexi-action, .lexi-card { pointer-events: auto; position: fixed; }
      .lexi-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border: 1px solid var(--lexi-border);
        border-radius: 8px;
        background: var(--lexi-bg);
        color: var(--lexi-primary);
        box-shadow: 0 8px 24px rgba(23, 32, 51, .16);
        cursor: pointer;
        font: 600 14px/1 inherit;
        animation: lexi-enter 140ms ease-out;
      }
      .lexi-action:hover { background: var(--lexi-soft); }
      .lexi-action:active, .lexi-icon:active, .lexi-link:active { background: var(--lexi-hover); }
      .lexi-action:focus-visible, .lexi-icon:focus-visible, .lexi-link:focus-visible, .lexi-retry:focus-visible, .lexi-save-input:focus-visible, .lexi-save-confirm:focus-visible, .lexi-save-cancel:focus-visible {
        outline: 2px solid var(--lexi-primary);
        outline-offset: 2px;
      }
      .lexi-card {
        width: min(336px, calc(100vw - 16px));
        max-height: min(60vh, 460px);
        overflow: auto;
        padding: 16px;
        border: 1px solid var(--lexi-border);
        border-radius: 8px;
        background: var(--lexi-bg);
        color: var(--lexi-text);
        box-shadow: var(--lexi-shadow);
        animation: lexi-enter 140ms ease-out;
      }
      .lexi-original { margin: 0 0 12px; color: var(--lexi-muted); font-size: 13px; line-height: 1.5; }
      .lexi-caption { margin: 0 0 4px; color: var(--lexi-muted); font-size: 11px; line-height: 1.4; }
      .lexi-translation { margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
      .lexi-status { display: flex; gap: 10px; align-items: center; color: var(--lexi-muted); font-size: 13px; line-height: 1.5; }
      .lexi-spinner { width: 16px; height: 16px; border: 2px solid var(--lexi-border); border-top-color: var(--lexi-primary); border-radius: 50%; animation: lexi-spin .8s linear infinite; flex: none; }
      .lexi-progress { height: 4px; margin-top: 12px; overflow: hidden; border-radius: 2px; background: var(--lexi-border); }
      .lexi-progress > span { display: block; height: 100%; background: var(--lexi-primary); transition: width 120ms linear; }
      .lexi-actions { display: flex; align-items: center; gap: 8px; margin: 14px -6px -6px; padding-top: 10px; border-top: 1px solid var(--lexi-border); }
      .lexi-icon, .lexi-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        padding: 0;
        border: 1px solid var(--lexi-primary);
        border-radius: 6px;
        background: var(--lexi-soft);
        color: var(--lexi-primary);
        cursor: pointer;
        flex: none;
      }
      .lexi-icon:hover, .lexi-link:hover { background: var(--lexi-hover); }
      .lexi-icon[data-action="speak"], .lexi-icon[data-action="copy"] { border-color: var(--lexi-border); background: var(--lexi-bg); color: var(--lexi-muted); }
      .lexi-icon[data-action="speak"]:hover, .lexi-icon[data-action="copy"]:hover { background: var(--lexi-soft); color: var(--lexi-text); }
      .lexi-action, .lexi-icon, .lexi-link { transition: background-color 100ms ease, color 100ms ease, transform 100ms ease; }
      .lexi-action:active:not(:disabled), .lexi-icon:active:not(:disabled), .lexi-link:active:not(:disabled) { background: var(--lexi-hover); color: var(--lexi-primary); transform: scale(.94); box-shadow: inset 0 0 0 1px currentColor; }
      .lexi-icon[data-action="speak"][aria-busy="true"] { background: var(--lexi-soft); border-color: var(--lexi-primary); color: var(--lexi-primary); cursor: wait; }
      .lexi-icon[aria-pressed="true"] { border-color: var(--lexi-success); background: var(--lexi-success-bg); color: var(--lexi-success); }
      .lexi-link { margin-left: auto; }
      .lexi-error { color: var(--lexi-error); }
      .lexi-speech-tip { margin-top: 12px; padding: 10px; border-radius: 6px; background: var(--lexi-soft); color: var(--lexi-text); font-size: 12px; line-height: 1.6; }
      .lexi-retry { margin-top: 10px; padding: 8px 10px; border: 1px solid var(--lexi-border); border-radius: 6px; background: var(--lexi-bg); color: var(--lexi-primary); cursor: pointer; }
      .lexi-save-form { margin-top: 12px; }
      .lexi-save-label { display: block; margin-bottom: 5px; color: var(--lexi-muted); font-size: 12px; }
      .lexi-save-input { width: 100%; padding: 8px 10px; border: 1px solid var(--lexi-border); border-radius: 6px; background: var(--lexi-bg); color: var(--lexi-text); font: 13px/1.5 var(--lexi-font); }
      .lexi-save-buttons { display: flex; gap: 8px; margin-top: 8px; }
      .lexi-save-confirm, .lexi-save-cancel { padding: 7px 12px; border: 1px solid var(--lexi-border); border-radius: 6px; background: var(--lexi-bg); color: var(--lexi-text); font: 12px/1.4 var(--lexi-font); cursor: pointer; }
      .lexi-save-confirm { border-color: var(--lexi-primary); background: var(--lexi-primary); color: var(--lexi-bg); }
      .lexi-reencounter { margin-top: 12px; padding: 10px; border-radius: 6px; background: var(--lexi-soft); overflow-wrap: anywhere; }
      .lexi-reencounter p { margin: 0 0 6px; font-size: 12px; line-height: 1.6; }
      .lexi-reencounter-title { font-weight: 600; }
      .lexi-reencounter-sentence { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
      .lexi-reencounter-source, .lexi-reencounter-meaning { color: var(--lexi-muted); }
      .lexi-reencounter a { color: var(--lexi-primary); }
      .lexi-reencounter a:focus-visible { outline: 2px solid var(--lexi-primary); outline-offset: 2px; }
      .lexi-reencounter .lexi-retry { margin-top: 0; }
      .lexi-retry:disabled { opacity: .65; cursor: default; }
      @keyframes lexi-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes lexi-spin { to { transform: rotate(360deg); } }
      @media (prefers-color-scheme: dark) {
        :host(:not(.lexi-light)) { color-scheme: dark; --lexi-bg: #171a21; --lexi-text: #f2f4f7; --lexi-muted: #aab2c0; --lexi-border: #343a46; --lexi-primary: #b5b6ff; --lexi-soft: #302f4b; --lexi-hover: #343a46; --lexi-success: #8be0ad; --lexi-success-bg: #20352b; --lexi-error: #ef7777; --lexi-shadow: 0 12px 36px rgba(0,0,0,.42); }
      }
      :host(.lexi-dark) { color-scheme: dark; --lexi-bg: #171a21; --lexi-text: #f2f4f7; --lexi-muted: #aab2c0; --lexi-border: #343a46; --lexi-primary: #b5b6ff; --lexi-soft: #302f4b; --lexi-hover: #343a46; --lexi-success: #8be0ad; --lexi-success-bg: #20352b; --lexi-error: #ef7777; --lexi-shadow: 0 12px 36px rgba(0,0,0,.42); }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } .lexi-action:active, .lexi-icon:active, .lexi-link:active { transform: none !important; } }
    </style>
    <div id="surface" aria-live="polite"></div>
  `;
  const panel = root.querySelector<HTMLDivElement>('#surface')!;
  applyAppearance(host);
  document.documentElement.append(host);
  return { host, root, panel };
}

function applyAppearance(host: HTMLDivElement): void {
  host.classList.toggle('lexi-light', settings?.theme === 'light');
  host.classList.toggle('lexi-dark', settings?.theme === 'dark');
  host.classList.toggle('lexi-inter', settings?.uiFont === 'inter');
}

function clampPosition(rect: DOMRect, width: number, height: number): { left: number; top: number } {
  const margin = 8;
  const left = Math.max(margin, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - margin));
  const above = rect.top - height - 10;
  const top = above >= margin ? above : Math.min(rect.bottom + 10, window.innerHeight - height - margin);
  return { left, top: Math.max(margin, top) };
}

function replacePanelContent(panel: HTMLDivElement, html: string, fallbackAction?: string): void {
  const active = (panel.getRootNode() as ShadowRoot).activeElement;
  const previousAction = active instanceof HTMLButtonElement && panel.contains(active) ? active.dataset.action : undefined;
  panel.innerHTML = html;
  const selector = previousAction ? `[data-action="${previousAction}"]` : '';
  const nextFocus = (selector ? panel.querySelector<HTMLButtonElement>(selector) : null)
    ?? (fallbackAction && (previousAction || focusResultOnReady)
      ? panel.querySelector<HTMLButtonElement>(`[data-action="${fallbackAction}"]`)
      : null);
  if (nextFocus && !nextFocus.disabled) nextFocus.focus({ preventScroll: true });
  else if (nextFocus?.disabled) panel.querySelector<HTMLButtonElement>('[data-action="expand"]')?.focus({ preventScroll: true });
  if (fallbackAction) focusResultOnReady = false;
}

function placeSurface(panel: HTMLDivElement, rect: DOMRect): void {
  const surface = panel.firstElementChild;
  if (!(surface instanceof HTMLElement)) return;
  const bounds = surface.getBoundingClientRect();
  const position = clampPosition(rect, bounds.width, bounds.height);
  surface.style.left = `${position.left}px`;
  surface.style.top = `${position.top}px`;
}

function needsSaveConfirmation(state: ViewState): boolean {
  return state.mode === 'result'
    && !state.saved
    && state.meaningSource !== 'context'
    && state.meaningSource !== 'confirmed'
    && SINGLE_WORD.test(state.context?.selectedText ?? '');
}

function chooseSavedItem(panel: HTMLDivElement): boolean {
  if (currentState.appendItemId || (currentState.savedMatches?.length ?? 0) <= 1) return false;
  render(panel, { ...currentState, confirmingSave: false, message: '请在旧语境中选择要追加的词条。' });
  panel.querySelector<HTMLButtonElement>('[data-action="append-context"]:not(:disabled)')?.focus({ preventScroll: true });
  return true;
}

async function saveCurrent(panel: HTMLDivElement, translation?: string): Promise<void> {
  const state = currentState;
  if (state.mode !== 'result' || !state.context || state.saved || state.saving || state.matchesPending) return;
  if (chooseSavedItem(panel)) return;
  const context = translation == null ? state.context : { ...state.context, translation };
  render(panel, { ...state, saving: true, message: undefined });
  try {
    const itemId = state.appendItemId ?? (state.savedMatches?.length === 1 ? state.savedMatches[0]!.id : undefined);
    const response = await chrome.runtime.sendMessage(itemId
      ? { type: 'APPEND_SAVED_CONTEXT', itemId, context }
      : { type: 'SAVE_BASIC_SELECTION', context });
    if (!response?.ok) throw new Error(response?.error ?? '保存失败');
    if (currentState.context?.requestId !== context.requestId) return;
    render(panel, {
      ...currentState,
      context,
      saved: true,
      saving: false,
      confirmingSave: false,
      appendItemId: undefined,
      meaningSource: translation == null ? currentState.meaningSource : 'confirmed',
      message: undefined,
    });
    void refreshSavedMatches(panel);
    panel.querySelector<HTMLButtonElement>('[data-action="expand"]')?.focus({ preventScroll: true });
  } catch (error) {
    if (currentState.context?.requestId !== context.requestId) return;
    render(panel, {
      ...currentState,
      saving: false,
      message: error instanceof Error ? `保存失败：${error.message}` : '保存失败，请重试',
    });
    (panel.querySelector<HTMLInputElement>('.lexi-save-input')
      ?? panel.querySelector<HTMLButtonElement>('[data-action="save"]'))?.focus({ preventScroll: true });
  }
}

async function refreshSavedMatches(panel: HTMLDivElement): Promise<void> {
  const state = currentState;
  if (state.mode !== 'result' || !state.context) return;
  const request = ++matchesRequest;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SAVED_MATCHES', text: state.context.selectedText, lemma: state.matchLemma }) as RuntimeResponse<LearningItem[]> | undefined;
    if (!response?.ok) throw new Error(response && !response.ok ? response.error : '扩展后台没有响应');
    if (request !== matchesRequest || currentState.mode !== 'result' || currentState.context?.requestId !== state.context.requestId) return;
    const relevant = currentState.appendItemId ? response.data.filter((item) => item.id === currentState.appendItemId) : response.data;
    render(panel, { ...currentState, savedMatches: response.data, matchesPending: false,
      saved: currentState.saving ? currentState.saved : relevant.some((item) => hasSavedContext(item, currentState.context!)) });
  } catch {
    if (request === matchesRequest && currentState.mode === 'result' && currentState.context?.requestId === state.context.requestId) {
      render(panel, { ...currentState, matchesPending: false });
    }
  }
}

function render(panel: HTMLDivElement, next: ViewState): void {
  if (next.mode === 'hidden' || (next.context && next.context.requestId !== currentState.context?.requestId)) {
    activeRequestId = '';
    autoSaveRequestId = '';
    analyzeRequestId = '';
  }
  if (next.sidePanelOpen != null) sidePanelOpen = next.sidePanelOpen;
  currentState = { ...next, sidePanelOpen };
  if (next.mode === 'hidden' || !next.rect) {
    const active = (panel.getRootNode() as ShadowRoot).activeElement;
    if (active instanceof HTMLElement && panel.contains(active) && focusReturnElement?.isConnected) {
      focusReturnElement.focus({ preventScroll: true });
    }
    focusResultOnReady = false;
    panel.replaceChildren();
    return;
  }
  if (next.mode === 'action') {
    const position = clampPosition(next.rect, 40, 40);
    replacePanelContent(panel, `<button class="lexi-action" style="left:${position.left}px;top:${position.top}px" aria-label="翻译当前选区" title="翻译当前选区">译</button>`);
    placeSurface(panel, next.rect);
    panel.querySelector('button')?.addEventListener('click', (event) => {
      if (event.detail === 0) focusResultOnReady = true;
      void translateCurrent(panel);
    });
    return;
  }

  const position = clampPosition(next.rect, Math.min(336, window.innerWidth - 16), Math.min(next.mode === 'result' ? 220 : 112, window.innerHeight - 16));
  const style = `left:${position.left}px;top:${position.top}px`;
  if (next.mode === 'loading') {
    const progress = next.downloadProgress;
    replacePanelContent(panel, `
      <section class="lexi-card" style="${style}" role="region" aria-label="拾词翻译">
        <div class="lexi-status"><span class="lexi-spinner" aria-hidden="true"></span><span>${escapeHtml(next.message ?? '正在翻译…')}</span></div>
        ${progress == null ? '' : `<div class="lexi-progress" aria-label="下载进度 ${Math.round(progress)}%"><span style="width:${progress}%"></span></div>`}
      </section>`);
    placeSurface(panel, next.rect);
    return;
  }
  if (next.mode === 'error') {
    replacePanelContent(panel, `
      <section class="lexi-card" style="${style}" role="region" aria-label="翻译失败">
        <div class="lexi-status lexi-error">${escapeHtml(next.message ?? '翻译暂时不可用')}</div>
        <button class="lexi-retry" data-action="retry">重试</button>
      </section>`, 'retry');
    placeSurface(panel, next.rect);
    panel.querySelector('button')?.addEventListener('click', () => void translateCurrent(panel));
    return;
  }

  const context = next.context!;
  const speechBusy = pendingSpeechRequests.has(context.requestId);
  const panelAction = sidePanelOpen ? '收起侧边栏' : next.analysisCount ? `展开侧边栏，发现 ${next.analysisCount} 项可积累` : '展开侧边栏';
  const saveCaption = next.meaningSource === 'confirmed' ? '已确认词义' : next.meaningSource === 'context' ? '本文含义' : '快速翻译 · 仅供参考';
  const saveLabel = next.saved ? '当前语境已保存' : next.matchesPending ? '正在查找旧语境' : next.savedMatches?.length ? '保存当前语境' : '保存到词库';
  const activeBeforeRender = (panel.getRootNode() as ShadowRoot).activeElement;
  const saveInputFocused = activeBeforeRender instanceof HTMLInputElement && activeBeforeRender.classList.contains('lexi-save-input');
  const caret = saveInputFocused ? activeBeforeRender.selectionStart : null;
  replacePanelContent(panel, `
    <section class="lexi-card" style="${style}" role="region" aria-label="快速翻译结果">
      <p class="lexi-original">${escapeHtml(context.selectedText)}</p>
      <p class="lexi-caption">${saveCaption}</p>
      <p class="lexi-translation">${escapeHtml(context.translation)}</p>
      ${savedContextsHtml(next.savedMatches ?? [], context)}
      ${next.confirmingSave ? `<form class="lexi-save-form" data-action="confirm-save">
        <label class="lexi-save-label" for="lexi-save-meaning">确认词义后保存</label>
        <input class="lexi-save-input" id="lexi-save-meaning" name="meaning" value="${escapeHtml(next.saveDraft ?? context.translation)}" maxlength="500" autocomplete="off" required ${next.saving ? 'disabled' : ''}>
        <div class="lexi-save-buttons">
          <button class="lexi-save-confirm" type="submit" ${next.saving ? 'disabled' : ''}>保存</button>
          <button class="lexi-save-cancel" type="button" data-action="cancel-save" ${next.saving ? 'disabled' : ''}>取消</button>
        </div>
      </form>` : ''}
      ${next.message ? `<p class="lexi-error" role="alert">${escapeHtml(next.message)}</p>` : ''}
      ${next.speechWaitTip ? `<div class="lexi-speech-tip" role="status">${SPEECH_WAIT_TIP_TEXT}<br><button class="lexi-retry" data-action="dismiss-speech-tip">知道了</button></div>` : ''}
      <div class="lexi-actions">
        <button class="lexi-icon" data-action="speak" aria-label="${speechBusy ? '正在准备朗读' : '朗读选中内容'}" aria-busy="${speechBusy}" title="${speechBusy ? '正在准备朗读…' : '朗读选中内容'}" ${speechBusy ? 'disabled' : ''}>${speechBusy ? '<span class="lexi-spinner" aria-hidden="true"></span>' : ICONS.speak}</button>
        <button class="lexi-icon" data-action="copy" aria-label="${next.copied ? '已复制译文' : '复制译文'}" title="${next.copied ? '已复制译文' : '复制译文'}">${next.copied ? ICONS.check : ICONS.copy}</button>
        <button class="lexi-icon" data-action="save" aria-label="${saveLabel}" aria-pressed="${next.saved ? 'true' : 'false'}" title="${saveLabel}" ${next.saved || next.saving || next.confirmingSave || next.matchesPending || (next.savedMatches?.length ?? 0) > 1 ? 'disabled' : ''}>${next.saved ? ICONS.check : ICONS.plus}</button>
        <button class="lexi-link" data-action="expand" aria-label="${panelAction}" aria-expanded="${sidePanelOpen}" title="${panelAction}">${sidePanelOpen ? ICONS.panelClose : ICONS.panelOpen}</button>
      </div>
    </section>`, 'save');
  placeSurface(panel, next.rect);
  panel.querySelectorAll<HTMLButtonElement>('[data-action="append-context"]').forEach((button) => {
    button.disabled ||= Boolean(next.saving || next.confirmingSave || next.matchesPending);
    button.addEventListener('click', () => {
      render(panel, { ...currentState, saved: false, appendItemId: button.dataset.itemId, confirmingSave: true, saveDraft: currentState.context?.translation.slice(0, 500), message: undefined });
      panel.querySelector<HTMLInputElement>('.lexi-save-input')?.focus({ preventScroll: true });
    });
  });
  panel.querySelector<HTMLButtonElement>('[data-action="dismiss-speech-tip"]')?.addEventListener('click', () => render(panel, { ...currentState, speechWaitTip: false }));
  if (next.confirmingSave) {
    const input = panel.querySelector<HTMLInputElement>('.lexi-save-input');
    input?.addEventListener('input', () => { currentState.saveDraft = input.value; });
    if (saveInputFocused) {
      input?.focus({ preventScroll: true });
      if (caret != null) input?.setSelectionRange(caret, caret);
    }
    panel.querySelector<HTMLFormElement>('[data-action="confirm-save"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const meaning = input?.value.trim();
      if (!meaning) return;
      void saveCurrent(panel, meaning);
    });
    panel.querySelector<HTMLButtonElement>('[data-action="cancel-save"]')?.addEventListener('click', () => {
      render(panel, { ...currentState, confirmingSave: false, saveDraft: undefined, appendItemId: undefined, message: undefined });
    });
  }
  panel.querySelector<HTMLButtonElement>('[data-action="speak"]')?.addEventListener('click', async () => {
    const id = context.requestId;
    if (pendingSpeechRequests.has(id) || currentState.context?.requestId !== id) return;
    pendingSpeechRequests.add(id);
    render(panel, { ...currentState, message: undefined });
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SPEAK', text: context.selectedText, context: context.sentence, scope: 'word' }) as RuntimeResponse | undefined;
      if (!response?.ok) throw new Error(response && !response.ok ? response.error : '扩展后台没有响应');
    } catch (error) {
      if (currentState.context?.requestId === id && currentState.mode === 'result') {
        currentState = { ...currentState, message: `朗读失败：${error instanceof Error ? error.message : String(error)}` };
      }
    } finally {
      pendingSpeechRequests.delete(id);
      if (currentState.context?.requestId === id && currentState.mode === 'result') render(panel, currentState);
    }
  });
  panel.querySelector<HTMLButtonElement>('[data-action="copy"]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(context.translation);
      if (currentState.context?.requestId === context.requestId) render(panel, { ...currentState, copied: true });
    } catch {
      if (currentState.context?.requestId === context.requestId) render(panel, { ...currentState, message: '复制失败，请重试' });
    }
  });
  panel.querySelector<HTMLButtonElement>('[data-action="save"]')?.addEventListener('click', () => {
    if (needsSaveConfirmation(currentState)) {
      render(panel, { ...currentState, confirmingSave: true, saveDraft: currentState.context?.translation, message: undefined });
      panel.querySelector<HTMLInputElement>('.lexi-save-input')?.focus({ preventScroll: true });
      return;
    }
    void saveCurrent(panel);
  });
  panel.querySelector<HTMLButtonElement>('[data-action="expand"]')?.addEventListener('click', async () => {
    const response = (await chrome.runtime.sendMessage({ type: 'TOGGLE_SIDE_PANEL', context })) as {
      ok: boolean;
      data?: { open: boolean };
    };
    if (response.ok && response.data) render(panel, { ...currentState, sidePanelOpen: response.data.open });
  });
}

function closestBlock(node: Node | null): HTMLElement | null {
  let element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  while (element && element !== document.body) {
    if (BLOCK_TAGS.has(element.tagName) && (element.textContent?.trim().length ?? 0) < 20_000) return element;
    element = element.parentElement;
  }
  return document.body;
}

function sentenceContext(blockText: string, selectedText: string): Pick<SelectionContext, 'sentence' | 'contextBefore' | 'contextAfter'> {
  const normalizedBlock = blockText.replace(/\s+/g, ' ').trim();
  const normalizedSelection = selectedText.replace(/\s+/g, ' ').trim();
  const index = normalizedBlock.toLowerCase().indexOf(normalizedSelection.toLowerCase());
  if (index < 0) return { sentence: normalizedSelection, contextBefore: '', contextAfter: '' };
  const boundaries = [...normalizedBlock.matchAll(/[.!?。！？]+\s*/g)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  const start = [...boundaries].reverse().find((boundary) => boundary.end <= index)?.end ?? 0;
  const selectionEnd = index + normalizedSelection.length;
  const end = boundaries.find((boundary) => boundary.start >= selectionEnd)?.end ?? normalizedBlock.length;
  const previousStart = [...boundaries].reverse().find((boundary) => boundary.end <= Math.max(0, start - 1))?.end ?? 0;
  const nextEnd = boundaries.find((boundary) => boundary.start >= end)?.end ?? normalizedBlock.length;
  return {
    sentence: normalizedBlock.slice(start, end).trim(),
    contextBefore: normalizedBlock.slice(previousStart, start).trim(),
    contextAfter: normalizedBlock.slice(end, nextEnd).trim(),
  };
}

function captureSelection(forcedText?: string): { context: SelectionContext; rect: DOMRect } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const text = (forcedText ?? selection.toString()).replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_SELECTION_LENGTH || !/[A-Za-z]/.test(text)) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const block = closestBlock(range.commonAncestorContainer);
  const sentence = sentenceContext(block?.innerText ?? text, text);
  return {
    rect,
    context: {
      requestId: crypto.randomUUID(),
      selectedText: text,
      ...sentence,
      translation: '',
      pageTitle: document.title,
      pageUrl: location.href,
      siteName: location.hostname,
      lookupOrigin: 'web',
      capturedAt: new Date().toISOString(),
    },
  };
}

function editableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, [contenteditable="true"]'));
}

async function getTranslator(panel: HTMLDivElement): Promise<TranslatorInstance> {
  if (translatorPromise) return translatorPromise;
  if (!('Translator' in globalThis)) throw new Error('Chrome 本地翻译不可用');
  const requestId = activeRequestId;
  translatorPromise = Translator.create({
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        if (activeRequestId !== requestId || currentState.mode !== 'loading') return;
        render(panel, {
          ...currentState,
          mode: 'loading',
          message: '正在准备本地翻译，首次使用后可离线翻译',
          downloadProgress: Math.round(event.loaded * 100),
        });
      });
    },
  }).catch((error) => {
    translatorPromise = null;
    throw error;
  });
  return translatorPromise;
}

async function translateCurrent(panel: HTMLDivElement): Promise<void> {
  const state = currentState;
  if (!state.context || !state.rect) return;
  const requestId = state.context.requestId;
  activeRequestId = requestId;
  render(panel, { ...state, mode: 'loading', message: '正在翻译…' });
  let translation = '';
  let provider: 'chrome' | 'deepseek' = 'chrome';
  try {
    try {
      translation = await withLocalTranslationTimeout(getTranslator(panel).then((translator) => translator.translate(state.context!.selectedText)));
    } catch {
      provider = 'deepseek';
      const response = (await chrome.runtime.sendMessage({
        type: 'TRANSLATE_FALLBACK',
        requestId,
        text: state.context.selectedText,
      })) as { ok: boolean; data?: string; error?: string };
      if (!response?.ok || !response.data) throw new Error(response?.error ?? '翻译服务不可用');
      translation = response.data;
    }
    if (activeRequestId !== requestId) return;
    const context = { ...state.context, translation };
    render(panel, { mode: 'result', rect: state.rect, context, matchesPending: true });
    const matchesReady = refreshSavedMatches(panel);
    const recordResponse = await chrome.runtime.sendMessage({
      type: 'RECORD_LOOKUP',
      payload: {
        context,
        translationProvider: provider,
        analysisState: 'idle',
      },
    });
    if (!recordResponse?.ok) throw new Error(recordResponse?.error ?? '记录查询失败');
    await matchesReady;
    if (currentState.context?.requestId !== requestId || currentState.mode !== 'result') return;
    if (analyzeRequestId === requestId && settings?.deepseekMode !== 'auto') {
      analyzeRequestId = '';
      const analysisResponse = await chrome.runtime.sendMessage({ type: 'REQUEST_ANALYSIS', context });
      if (!analysisResponse?.ok) throw new Error(analysisResponse?.error ?? '学习分析不可用');
    }
    if (autoSaveRequestId === requestId) {
      autoSaveRequestId = '';
      if (chooseSavedItem(panel)) return;
      if (needsSaveConfirmation(currentState)) {
        render(panel, { ...currentState, confirmingSave: true, saveDraft: currentState.context?.translation, message: undefined });
        panel.querySelector<HTMLInputElement>('.lexi-save-input')?.focus({ preventScroll: true });
      } else {
        await saveCurrent(panel);
      }
    }
  } catch (error) {
    if (activeRequestId !== requestId) return;
    if (currentState.mode === 'result' && currentState.context?.requestId === requestId) {
      render(panel, { ...currentState, message: error instanceof Error ? error.message : String(error) });
      return;
    }
    render(panel, {
      ...state,
      mode: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  async main(ctx) {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).then((response) =>
      response?.ok ? response.data : null,
    );
    const { host, root, panel } = createSurface();
    void chrome.runtime.sendMessage({ type: 'GET_SIDE_PANEL_STATE' }).then((response) => {
      if (response?.ok && !disposed) sidePanelOpen = Boolean(response.data?.open);
    }).catch(() => undefined);
    const siteDisabled = () => Boolean(settings?.disabledSites.includes(location.hostname));
    let lastPointerUpAt = 0;
    let disposed = false;
    const selectionTimers = new Set<ReturnType<typeof setTimeout>>();

    const showSelection = (immediate: boolean, forcedText?: string) => {
      if (siteDisabled()) return;
      const captured = captureSelection(forcedText);
      if (!captured) return;
      focusReturnElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      render(panel, { mode: immediate ? 'loading' : 'action', ...captured });
      if (immediate) void translateCurrent(panel);
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      if (siteDisabled() || editableTarget(event.target) || settings?.doubleClickMode === 'off') return;
      queueMicrotask(() => {
        if (disposed) return;
        const captured = captureSelection();
        if (!captured || !SINGLE_WORD.test(captured.context.selectedText)) return;
        focusReturnElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        render(panel, {
          mode: settings?.doubleClickMode === 'button' ? 'action' : 'loading',
          ...captured,
        });
        if (settings?.doubleClickMode !== 'button') void translateCurrent(panel);
      });
    };

    const onMouseUp = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      lastPointerUpAt = Date.now();
      if (siteDisabled() || editableTarget(event.target) || eventPathContains(event, host, root, panel)) return;
      const timer = setTimeout(() => {
        selectionTimers.delete(timer);
        if (disposed) return;
        if (siteDisabled()) return;
        const captured = captureSelection();
        if (!captured || SINGLE_WORD.test(captured.context.selectedText)) return;
        if (settings?.phraseSelectionMode === 'off') return;
        focusReturnElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        render(panel, {
          mode: settings?.phraseSelectionMode === 'immediate' ? 'loading' : 'action',
          ...captured,
        });
        if (settings?.phraseSelectionMode === 'immediate') void translateCurrent(panel);
      }, 0);
      selectionTimers.add(timer);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (eventPathContains(event, host, root, panel) || Date.now() - lastPointerUpAt < 40) return;
      render(panel, { mode: 'hidden' });
    };
    const onScroll = () => render(panel, { mode: 'hidden' });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') render(panel, { mode: 'hidden' });
    };

    const onMessage = (message: Record<string, unknown>) => {
      if (message.type === 'SPEECH_WAIT_TIP' && Number.isInteger(message.count) && Number(message.count) >= 3 && Number(message.count) <= 5 && currentState.mode === 'result') {
        render(panel, { ...currentState, speechWaitTip: true });
      }
      if (message.type === 'COMMAND_TRANSLATE') {
        focusResultOnReady = true;
        showSelection(true);
      }
      if (message.type === 'COMMAND_SAVE' && !siteDisabled()) {
        const captured = captureSelection();
        if (currentState.mode === 'result' && currentState.context
          && (!captured || (captured.context.selectedText === currentState.context.selectedText
            && captured.context.sentence === currentState.context.sentence))) {
          panel.querySelector<HTMLButtonElement>('[data-action="save"]')?.click();
        } else if (captured) {
          focusResultOnReady = true;
          focusReturnElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          render(panel, { mode: 'loading', ...captured });
          autoSaveRequestId = captured.context.requestId;
          void translateCurrent(panel);
        }
      }
      if (message.type === 'CONTEXT_ACTION') {
        const action = String(message.action);
        showSelection(action === 'save' || action === 'translate' || action === 'analyze', String(message.selectedText ?? ''));
        if (action === 'save') {
          autoSaveRequestId = currentState.context?.requestId ?? '';
        }
        if (action === 'analyze') {
          analyzeRequestId = currentState.context?.requestId ?? '';
        }
      }
      if (message.type === 'SETTINGS_UPDATED') {
        settings = message.settings as AppSettings;
        applyAppearance(host);
        if (settings.disabledSites.includes(location.hostname)) render(panel, { mode: 'hidden' });
      }
      if (message.type === 'SIDE_PANEL_STATE_CHANGED') {
        render(panel, { ...currentState, sidePanelOpen: Boolean(message.open) });
      }
      if (message.type === 'CURRENT_UPDATED') {
        const current = message.current as CurrentLookup;
        if (current.context.requestId !== currentState.context?.requestId || !current.analysis) return;
        const lemma = selectionLemma(current);
        if (lemma !== currentState.matchLemma) {
          currentState = { ...currentState, matchLemma: lemma };
          void refreshSavedMatches(panel);
        }
        const selectedContext = currentState.context;
        if (!selectedContext) return;
        const count = current.analysis.words.length + current.analysis.phrases.length + current.analysis.patterns.length;
        if (currentState.saved && currentState.meaningSource === 'confirmed') {
          render(panel, { ...currentState, analysisCount: count });
          return;
        }
        const selected = selectedContext.selectedText.trim().toLocaleLowerCase('en-US');
        const contextualWord = current.analysis.words.find((word) =>
          word.text.toLocaleLowerCase('en-US') === selected || word.lemma.toLocaleLowerCase('en-US') === selected,
        );
        const contextualMeaning = contextualWord?.meaningZh.trim();
        render(panel, {
          ...currentState,
          analysisCount: count,
          context: contextualMeaning
            ? { ...selectedContext, translation: contextualMeaning }
            : selectedContext,
          meaningSource: contextualMeaning ? 'context' : currentState.meaningSource,
          copied: contextualMeaning ? false : currentState.copied,
        });
      }
      if (message.type === 'LIBRARY_UPDATED') void refreshSavedMatches(panel);
    };

    document.addEventListener('dblclick', onDoubleClick);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    chrome.runtime.onMessage.addListener(onMessage);

    ctx.onInvalidated(() => {
      disposed = true;
      activeRequestId = '';
      for (const timer of selectionTimers) clearTimeout(timer);
      selectionTimers.clear();
      document.removeEventListener('dblclick', onDoubleClick);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKeyDown);
      chrome.runtime.onMessage.removeListener(onMessage);
      translatorPromise?.then((translator) => translator.destroy()).catch(() => undefined);
      translatorPromise = null;
      host.remove();
    });
  },
});
