import {
  AnalysisResultSchema,
  SelectionContextSchema,
  filterAnalysis,
  findSavedSelection,
  type AnalysisResult,
  type CurrentLookup,
  type LearningCandidate,
  type LearningItem,
  type RuntimeRequest,
  type RuntimeResponse,
  type SelectionContext,
} from '@lexiside/shared';
import { analyzeWithDeepSeek, translateWithDeepSeek, getDeepSeekStatus, saveDeepSeekKey, checkDeepSeek, listDeepSeekModels, saveDeepSeekModel } from '../lib/deepseek';
import {
  addHistory,
  appendSavedContext,
  bundleToCsv,
  clearHistory,
  clearLibrary,
  deleteItem,
  exportBundle,
  getCachedAnalysis,
  getLibrary,
  getSettings,
  importBackup,
  importItems,
  putCachedAnalysis,
  saveCandidate,
  setSettings,
  updateItem,
} from './background/storage';
import { listEnglishVoices } from '../lib/tts';
import { getDoubaoStatus, saveDoubaoKey } from '../lib/doubao';
import { speak, stopSpeech } from '../lib/speech';
import { speechCache } from '../lib/speech-cache';
import { getStorageUsage } from '../lib/storage-usage';
import { onLocalDataChanged } from '../lib/local-data-events';
import { claimRecoveryPrompt, connectLocalBackup, disconnectLocalBackup, getLocalBackupStatus, runLocalBackup, scheduleLocalBackup } from '../lib/local-backup';
import { analysisCacheMaterial, modelAnalysisContext } from '../lib/analysis-cache';
import { InFlightByKey } from '../lib/analysis-in-flight';
import { md5 } from '../lib/md5';

const currentByTab = new Map<number, CurrentLookup>();
const analysisTimers = new Map<number, ReturnType<typeof setTimeout>>();
const analysisInFlight = new InFlightByKey<AnalysisResult>();
const latestLookupRequestByTab = new Map<number, string>();
const openSidePanelWindows = new Set<number>();
const currentWriteTails = new Map<number, Promise<void>>();

const ok = <T>(data: T): RuntimeResponse<T> => ({ ok: true, data });
const fail = (error: unknown): RuntimeResponse<never> => ({
  ok: false,
  error: error instanceof Error ? error.message : String(error),
});

function analysisCacheKey(context: SelectionContext, model: string): string {
  return md5(`deepseek-api-v2:${model}:${analysisCacheMaterial(context)}`);
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function broadcastSidePanelState(windowId: number, open: boolean): void {
  void chrome.tabs.query({ windowId }).then((tabs) => Promise.all(
    tabs.flatMap((tab) => tab.id == null
      ? []
      : [chrome.tabs.sendMessage(tab.id, { type: 'SIDE_PANEL_STATE_CHANGED', open }).catch(() => undefined)]),
  ));
}

function publishLibraryUpdated(): void {
  void chrome.runtime.sendMessage({ type: 'LIBRARY_UPDATED' }).catch(() => undefined);
  void chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).then((tabs) => Promise.all(
    tabs.flatMap((tab) => tab.id == null ? [] : [chrome.tabs.sendMessage(tab.id, { type: 'LIBRARY_UPDATED' }).catch(() => undefined)]),
  )).catch(() => undefined);
}

function queueCurrentWrite(tabId: number, operation: () => Promise<void>): Promise<void> {
  const result = (currentWriteTails.get(tabId) ?? Promise.resolve()).then(operation);
  const tail = result.catch(() => undefined);
  currentWriteTails.set(tabId, tail);
  void tail.then(() => {
    if (currentWriteTails.get(tabId) === tail) currentWriteTails.delete(tabId);
  });
  return result;
}

async function publishCurrent(tabId: number, current: CurrentLookup): Promise<void> {
  await queueCurrentWrite(tabId, async () => {
    if (!await tabStillOnPage(tabId, current.context.pageUrl)) return;
    currentByTab.set(tabId, current);
    await chrome.storage.session.set({ [`current:${tabId}`]: current });
    void chrome.runtime.sendMessage({ type: 'CURRENT_UPDATED', current }).catch(() => undefined);
    void chrome.tabs.sendMessage(tabId, { type: 'CURRENT_UPDATED', current }).catch(() => undefined);
  });
}

async function tabStillOnPage(tabId: number, pageUrl: string): Promise<boolean> {
  try {
    return (await chrome.tabs.get(tabId)).url === pageUrl;
  } catch {
    return false;
  }
}

function clearCurrent(tabId: number): void {
  currentByTab.delete(tabId);
  latestLookupRequestByTab.delete(tabId);
  const timer = analysisTimers.get(tabId);
  if (timer) clearTimeout(timer);
  analysisTimers.delete(tabId);
  void queueCurrentWrite(tabId, () => chrome.storage.session.remove(`current:${tabId}`)).catch(() => undefined);
  void chrome.runtime.sendMessage({ type: 'CURRENT_CLEARED', tabId }).catch(() => undefined);
}

async function getCurrent(tabId?: number): Promise<CurrentLookup | null> {
  const resolved = tabId ?? (await activeTabId());
  if (resolved == null) return null;
  const memory = currentByTab.get(resolved);
  if (!memory) await currentWriteTails.get(resolved);
  const stored = memory ? undefined : await chrome.storage.session.get(`current:${resolved}`);
  const current = memory ?? (stored?.[`current:${resolved}`] as CurrentLookup | undefined);
  if (!current) return null;
  if (await tabStillOnPage(resolved, current.context.pageUrl)) return current;
  clearCurrent(resolved);
  return null;
}

function scheduleAnalysis(tabId: number, context: SelectionContext): void {
  const previous = analysisTimers.get(tabId);
  if (previous) clearTimeout(previous);
  analysisTimers.set(
    tabId,
    setTimeout(() => {
      analysisTimers.delete(tabId);
      void analyzeSelection(tabId, context);
    }, 500),
  );
}

async function analyzeSelection(tabId: number, context: SelectionContext): Promise<void> {
  const current = await getCurrent(tabId);
  if (!current || current.context.requestId !== context.requestId) return;
  const { model } = await getDeepSeekStatus();
  try {
    const settings = await getSettings();
    const modelContext = modelAnalysisContext(context, settings);
    const cacheKey = analysisCacheKey(modelContext, model);
    if (settings.analysisCacheSize > 0) {
      const cached = await getCachedAnalysis(cacheKey);
      if (cached) {
        const latest = await getCurrent(tabId);
        if (!latest || latest.context.requestId !== context.requestId) return;
        if ((await getDeepSeekStatus()).model !== model) return;
        await publishCurrent(tabId, { ...latest, analysisState: 'ready', analysis: cached });
        return;
      }
    }
    const beforeLoading = await getCurrent(tabId);
    if (!beforeLoading || beforeLoading.context.requestId !== context.requestId) return;
    await publishCurrent(tabId, { ...beforeLoading, analysisState: 'loading', error: undefined });
    const analysis = await analysisInFlight.run(cacheKey, async () => {
      const result = await analyzeWithDeepSeek(modelContext, model);
      const parsed = filterAnalysis(AnalysisResultSchema.parse(result));
      if (settings.analysisCacheSize > 0) {
        await putCachedAnalysis(cacheKey, parsed, settings.analysisCacheSize);
      }
      return parsed;
    });
    const latest = await getCurrent(tabId);
    if (!latest || latest.context.requestId !== context.requestId) return;
    if ((await getDeepSeekStatus()).model !== model) return;
    await publishCurrent(tabId, { ...latest, analysisState: 'ready', analysis });
  } catch (error) {
    const latest = await getCurrent(tabId);
    if (!latest || latest.context.requestId !== context.requestId) return;
    if ((await getDeepSeekStatus()).model !== model) return;
    await publishCurrent(tabId, {
      ...latest,
      analysisState: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function saveBasic(context: SelectionContext): Promise<LearningItem> {
  const word = /^[A-Za-z][A-Za-z'-]*$/.test(context.selectedText.trim());
  const candidate: LearningCandidate = word
    ? {
        type: 'word',
        value: {
          text: context.selectedText.trim(),
          lemma: context.selectedText.trim().toLowerCase(),
          partOfSpeech: '',
          phonetic: '',
          meaningZh: context.translation,
          definitionEn: '',
          meaningInContext: context.translation,
          collocations: [],
          confidence: 1,
        },
      }
    : {
        type: 'phrase',
        value: {
          text: context.selectedText.trim(),
          meaningZh: context.translation,
          usage: '',
          confidence: 1,
        },
      };
  return saveCandidate(candidate, context);
}

export default defineBackground(() => {
  onLocalDataChanged(scheduleLocalBackup);
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && ['library', 'history', 'settings'].some((key) => key in changes)) scheduleLocalBackup();
  });
  void chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: 'translate', title: '用拾词翻译', contexts: ['selection'] });
      chrome.contextMenus.create({ id: 'analyze', title: '翻译并分析表达', contexts: ['selection'] });
      chrome.contextMenus.create({ id: 'save', title: '保存到拾词', contexts: ['selection'] });
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id || !info.selectionText) return;
    if (info.menuItemId === 'analyze') void chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
    void chrome.tabs.sendMessage(tab.id, {
      type: 'CONTEXT_ACTION',
      action: info.menuItemId,
      selectedText: info.selectionText,
    });
  });

  chrome.sidePanel.onOpened.addListener((info) => {
    openSidePanelWindows.add(info.windowId);
    broadcastSidePanelState(info.windowId, true);
  });

  chrome.sidePanel.onClosed.addListener((info) => {
    openSidePanelWindows.delete(info.windowId);
    broadcastSidePanelState(info.windowId, false);
  });

  chrome.commands.onCommand.addListener((command) => {
    void activeTabId().then((tabId) => {
      if (tabId == null) return;
      return chrome.tabs.sendMessage(tabId, {
        type: command === 'save-selection' ? 'COMMAND_SAVE' : 'COMMAND_TRANSLATE',
      });
    });
  });

  chrome.tabs.onRemoved.addListener(clearCurrent);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading'
      || (changeInfo.url && currentByTab.get(tabId)?.context.pageUrl !== changeInfo.url)) {
      clearCurrent(tabId);
    }
  });

  chrome.runtime.onMessage.addListener(
    (request: RuntimeRequest, sender, sendResponse: (response: RuntimeResponse) => void) => {
      // Internal audio messages belong exclusively to the offscreen document.
      if ('target' in request) return false;
      if (sender.id !== chrome.runtime.id) {
        sendResponse(fail('拒绝来自未知来源的消息'));
        return false;
      }
      if (['GET_DEEPSEEK_STATUS', 'SAVE_DEEPSEEK_KEY', 'CHECK_DEEPSEEK', 'GET_DEEPSEEK_MODELS', 'SAVE_DEEPSEEK_MODEL'].includes(request.type)
        && sender.url !== chrome.runtime.getURL('sidepanel.html')) {
        sendResponse(fail('请在拾词侧栏设置中配置 DeepSeek API'));
        return false;
      }
      if (['GET_DOUBAO_STATUS', 'SAVE_DOUBAO_KEY', 'PREVIEW_SPEECH', 'GET_SPEECH_CACHE_STATUS', 'CLEAR_SPEECH_CACHE',
        'GET_STORAGE_USAGE', 'GET_LOCAL_BACKUP_STATUS', 'CLAIM_RECOVERY_PROMPT', 'CONNECT_LOCAL_BACKUP',
        'RUN_LOCAL_BACKUP', 'DISCONNECT_LOCAL_BACKUP', 'DELETE_LOCAL_BACKUP'].includes(request.type)
        && sender.url !== chrome.runtime.getURL('sidepanel.html')) {
        sendResponse(fail('请在拾词侧栏设置中配置和试听语音'));
        return false;
      }
      if (request.type === 'TOGGLE_SIDE_PANEL') {
        const tabId = sender.tab?.id;
        const windowId = sender.tab?.windowId;
        if (tabId == null || windowId == null) {
          sendResponse(fail('无法确定当前标签页'));
          return false;
        }
        const open = !openSidePanelWindows.has(windowId);
        const operation = open
          ? chrome.sidePanel.open({ tabId })
          : chrome.sidePanel.close({ windowId });
        void operation
          .then(() => {
            if (open) openSidePanelWindows.add(windowId);
            else openSidePanelWindows.delete(windowId);
            broadcastSidePanelState(windowId, open);
            sendResponse(ok({ open }));
          })
          .catch((error) => sendResponse(fail(error)));
        return true;
      }

      void (async (): Promise<RuntimeResponse> => {
        try {
          switch (request.type) {
            case 'RECORD_LOOKUP': {
              const context = SelectionContextSchema.parse(request.payload.context);
              const tabId = sender.tab?.id ?? request.payload.tabId;
              if (tabId == null) throw new Error('无法确定当前标签页');
              latestLookupRequestByTab.set(tabId, context.requestId);
              const settings = await getSettings();
              const { model } = await getDeepSeekStatus();
              const autoAnalyze = settings.deepseekMode === 'auto';
              const cached = settings.deepseekMode !== 'off' && settings.analysisCacheSize > 0
                ? await getCachedAnalysis(analysisCacheKey(modelAnalysisContext(context, settings), model))
                : null;
              const current: CurrentLookup = {
                ...request.payload,
                tabId,
                context,
                analysisState: cached ? 'ready' : autoAnalyze ? 'loading' : request.payload.analysisState,
                analysis: cached ?? undefined,
                error: cached ? undefined : request.payload.error,
              };
              if (latestLookupRequestByTab.get(tabId) !== context.requestId) return ok(current);
              if (!await tabStillOnPage(tabId, context.pageUrl)) return ok(current);
              await publishCurrent(tabId, current);
              await addHistory({
                id: crypto.randomUUID(),
                selectedText: context.selectedText,
                translation: context.translation,
                sourceLanguage: 'en',
                targetLanguage: 'zh',
                provider: current.translationProvider,
                pageTitle: context.pageTitle,
                pageUrl: context.pageUrl,
                createdAt: new Date().toISOString(),
              });
              if (latestLookupRequestByTab.get(tabId) === context.requestId && autoAnalyze && !cached) {
                scheduleAnalysis(tabId, context);
              }
              return ok(current);
            }
            case 'GET_CURRENT':
              return ok(await getCurrent(request.tabId));
            case 'GET_SIDE_PANEL_STATE':
              return ok({ open: sender.tab?.windowId != null && openSidePanelWindows.has(sender.tab.windowId) });
            case 'TRANSLATE_FALLBACK': {
              return ok(await translateWithDeepSeek(request.text));
            }
            case 'GET_DEEPSEEK_STATUS':
              return ok(await getDeepSeekStatus());
            case 'SAVE_DEEPSEEK_KEY':
              return ok(await saveDeepSeekKey(request.apiKey));
            case 'CHECK_DEEPSEEK':
              return ok(await checkDeepSeek());
            case 'GET_DEEPSEEK_MODELS':
              return ok(await listDeepSeekModels());
            case 'SAVE_DEEPSEEK_MODEL': {
              const previous = await getDeepSeekStatus();
              const status = await saveDeepSeekModel(request.model);
              if (previous.model !== status.model) {
                const active = await activeTabId();
                const tabs = new Set([...currentByTab.keys(), ...(active == null ? [] : [active])]);
                const settings = await getSettings();
                for (const tabId of tabs) {
                  const current = await getCurrent(tabId);
                  if (!current) continue;
                  await publishCurrent(tabId, { ...current, analysisState: 'idle', analysis: undefined, error: undefined });
                  if (settings.deepseekMode === 'auto') scheduleAnalysis(tabId, current.context);
                }
              }
              return ok(status);
            }
            case 'REQUEST_ANALYSIS': {
              const settings = await getSettings();
              if (settings.deepseekMode === 'off') throw new Error('DeepSeek 分析已在设置中关闭');
              const tabId = sender.tab?.id ?? (await activeTabId());
              if (tabId == null) throw new Error('无法确定当前标签页');
              void analyzeSelection(tabId, SelectionContextSchema.parse(request.context));
              return ok(null);
            }
            case 'SAVE_CANDIDATE': {
              const item = await saveCandidate(request.candidate, SelectionContextSchema.parse(request.context));
              publishLibraryUpdated();
              return ok(item);
            }
            case 'SAVE_BASIC_SELECTION': {
              const item = await saveBasic(SelectionContextSchema.parse(request.context));
              publishLibraryUpdated();
              return ok(item);
            }
            case 'GET_SAVED_MATCHES': {
              if (typeof request.text !== 'string' || request.text.length > 2000
                || (request.lemma != null && (typeof request.lemma !== 'string' || request.lemma.length > 120))) {
                throw new Error('查询内容无效');
              }
              return ok(findSavedSelection(await getLibrary(), request.text, request.lemma).slice(0, 3));
            }
            case 'APPEND_SAVED_CONTEXT': {
              const item = await appendSavedContext(request.itemId, SelectionContextSchema.parse(request.context));
              publishLibraryUpdated();
              return ok(item);
            }
            case 'LIST_LIBRARY': {
              const query = request.query?.trim().toLowerCase() ?? '';
              const items = (await getLibrary()).filter((item) => {
                const typeMatches = !request.itemType || request.itemType === 'all' || item.type === request.itemType;
                const haystack = [
                  item.displayText,
                  item.meaningZh,
                  item.note,
                  ...item.occurrences.flatMap((entry) => [entry.pageTitle, entry.siteName]),
                ]
                  .join(' ')
                  .toLowerCase();
                return typeMatches && (!query || haystack.includes(query));
              });
              return ok(items);
            }
            case 'DELETE_ITEM':
              await deleteItem(request.itemId);
              publishLibraryUpdated();
              return ok(null);
            case 'UPDATE_ITEM': {
              const item = await updateItem(request.item);
              publishLibraryUpdated();
              return ok(item);
            }
            case 'GET_SETTINGS':
              return ok(await getSettings());
            case 'SIDE_PANEL_READY':
              openSidePanelWindows.add(request.windowId);
              broadcastSidePanelState(request.windowId, true);
              return ok(null);
            case 'UPDATE_SETTINGS':
              {
                const updated = await setSettings(request.settings);
                void chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: updated }).catch(() => undefined);
                publishLibraryUpdated();
                return ok(updated);
              }
            case 'GET_TTS_VOICES': {
              const settings = await getSettings();
              const voices = await chrome.tts.getVoices();
              return ok(listEnglishVoices(voices, request.lang ?? settings.voice, settings.voiceGenderPreference));
            }
            case 'GET_DOUBAO_STATUS':
              return ok(await getDoubaoStatus());
            case 'SAVE_DOUBAO_KEY':
              await stopSpeech();
              return ok(await saveDoubaoKey(request.apiKey));
            case 'GET_SPEECH_CACHE_STATUS':
              return ok(await speechCache.status());
            case 'GET_STORAGE_USAGE':
              return ok(await getStorageUsage(await speechCache.status()));
            case 'GET_LOCAL_BACKUP_STATUS':
              return ok(await getLocalBackupStatus());
            case 'CLAIM_RECOVERY_PROMPT':
              return ok(await claimRecoveryPrompt());
            case 'CONNECT_LOCAL_BACKUP': {
              if (typeof request.restore !== 'boolean') throw new Error('无效的恢复选项');
              const result = await connectLocalBackup(request.restore);
              const settings = await getSettings();
              void chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings }).catch(() => undefined);
              publishLibraryUpdated();
              return ok(result);
            }
            case 'RUN_LOCAL_BACKUP':
              await runLocalBackup();
              return ok(await getLocalBackupStatus());
            case 'DISCONNECT_LOCAL_BACKUP':
              await disconnectLocalBackup();
              return ok(await getLocalBackupStatus());
            case 'DELETE_LOCAL_BACKUP':
              await disconnectLocalBackup(true);
              return ok(await getLocalBackupStatus());
            case 'CLEAR_SPEECH_CACHE':
              await stopSpeech();
              await speechCache.clear();
              return ok(await speechCache.status());
            case 'PREVIEW_SPEECH': {
              if (!['system', 'doubao'].includes(request.provider)) throw new Error('不支持的语音服务');
              return ok(await speak('The app records your progress and helps you learn something new every day.', getSettings(), {
                preview: true, provider: request.provider,
                onSlowPreparation: (tip) => { void chrome.runtime.sendMessage(tip).catch(() => undefined); },
              }));
            }
            case 'SPEAK': {
              return ok(await speak(request.text, getSettings(), {
                context: request.context, scope: request.scope,
                onSlowPreparation: (tip) => {
                  const delivery = sender.tab?.id != null ? chrome.tabs.sendMessage(sender.tab.id, tip) : chrome.runtime.sendMessage(tip);
                  void delivery.catch(() => undefined);
                },
              }));
            }
            case 'STOP_SPEAKING':
              await stopSpeech();
              return ok(null);
            case 'EXPORT_DATA': {
              const bundle = await exportBundle();
              return ok(
                request.format === 'json'
                  ? JSON.stringify(bundle, null, 2)
                  : bundleToCsv(bundle),
              );
            }
            case 'IMPORT_DATA': {
              const count = await importItems(request.items);
              publishLibraryUpdated();
              return ok(count);
            }
            case 'IMPORT_BACKUP': {
              const count = await importBackup(request.bundle, request.mode);
              publishLibraryUpdated();
              if (request.mode === 'replace') {
                const settings = await getSettings();
                void chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings }).catch(() => undefined);
              }
              return ok(count);
            }
            case 'CLEAR_HISTORY':
              await clearHistory();
              return ok(null);
            case 'CLEAR_LIBRARY':
              await clearLibrary();
              publishLibraryUpdated();
              return ok(null);
            default:
              return fail('不支持的请求');
          }
        } catch (error) {
          return fail(error);
        }
      })().then(sendResponse);
      return true;
    },
  );
});
