import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Database, Trash2, Volume2, LoaderCircle } from 'lucide-react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import { ContextHistoryLimitSchema, MAX_CONTEXT_HISTORY_LIMIT, type AppSettings, type TtsVoiceInfo, type StorageUsage } from '@lexiside/shared';
import { LocalBackupPanel, type ApiSetupTarget } from '../components/LocalBackupPanel';
import interLicenseUrl from '@fontsource-variable/inter/LICENSE?url';
import { runtimeErrorMessage, sendRuntime } from '../../../lib/runtime';
import type { DeepSeekStatus } from '../../../lib/deepseek';
import type { LocalBackupStatus } from '../../../lib/local-backup';
import { SettingsOverview, SettingsHeader, SettingsSection as Section, SettingsDisclosure as Disclosure, type SettingsCategory, type SettingsPage } from '../components/SettingsLayout';
import { DOUBAO_VOICES, type DoubaoStatus, type SpeechResult, type SpeechCacheStatus } from '../../../lib/doubao-voices';

interface SettingsViewProps {
  active?: boolean;
  focusRequest?: { target: ApiSetupTarget; id: number } | null;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3;
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
};

export function SettingsView({ settings, onSettingsChange, active = true, focusRequest }: SettingsViewProps) {
  const deepseekInput = useRef<HTMLInputElement>(null);
  const doubaoInput = useRef<HTMLInputElement>(null);
  const handledFocus = useRef<number | null>(null);
  const [page, setPage] = useState<SettingsPage | null>(null);
  const [deepseekKeyOpen, setDeepseekKeyOpen] = useState<boolean | null>(null);
  const [doubaoKeyOpen, setDoubaoKeyOpen] = useState<boolean | null>(null);
  const modelsRequested = useRef(false);
  const [backupStatus, setBackupStatus] = useState<LocalBackupStatus | null>(null);
  const [backupStatusError, setBackupStatusError] = useState(false);
  const [cacheMessage, setCacheMessage] = useState('');
  const [translatorStatus, setTranslatorStatus] = useState<'checking' | 'available' | 'downloadable' | 'unavailable'>('checking');
  const [apiStatus, setApiStatus] = useState<'loading' | 'saved' | 'ready' | 'unconfigured' | 'error'>('loading');
  const [apiMessage, setApiMessage] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiModel, setApiModel] = useState('deepseek-flash');
  const [apiModels, setApiModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState('');
  const [clearTarget, setClearTarget] = useState<'history' | 'library' | null>(null);
  const [error, setError] = useState('');
  const [hostname, setHostname] = useState('');
  const [ttsVoices, setTtsVoices] = useState<TtsVoiceInfo[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [doubaoKey, setDoubaoKey] = useState('');
  const [doubaoConfigured, setDoubaoConfigured] = useState<boolean | null>(null);
  const [doubaoBusy, setDoubaoBusy] = useState(false);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [speechMessage, setSpeechMessage] = useState('');
  const [speechError, setSpeechError] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [contextLimitDraft, setContextLimitDraft] = useState(String(settings.contextHistoryLimit));
  const [contextLimitError, setContextLimitError] = useState('');
  const contextLimitSaving = useRef(false);
  const [audioCache, setAudioCache] = useState<SpeechCacheStatus | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [storageError, setStorageError] = useState('');
  const [storageLoading, setStorageLoading] = useState(false);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const voiceControlsBusy = speechBusy || doubaoBusy || settingsBusy;
  const rateControlBusy = speechBusy || settingsBusy;

  useEffect(() => { setContextLimitDraft(String(settings.contextHistoryLimit)); }, [settings.contextHistoryLimit]);

  useEffect(() => {
    if (!active || !focusRequest || handledFocus.current === focusRequest.id) return;
    const targetPage = focusRequest.target === 'deepseek' ? 'ai' : 'speech';
    if (page !== targetPage) { setPage(targetPage); return; }
    if (focusRequest.target === 'deepseek' && deepseekKeyOpen !== true) { setDeepseekKeyOpen(true); return; }
    if (focusRequest.target === 'doubao' && doubaoKeyOpen !== true) { setDoubaoKeyOpen(true); return; }
    const input = focusRequest.target === 'deepseek' ? deepseekInput.current : doubaoInput.current;
    if (!input || input.disabled) return;
    input.scrollIntoView({ block: 'center' });
    input.focus({ preventScroll: true });
    handledFocus.current = focusRequest.id;
  }, [active, focusRequest, page, deepseekKeyOpen, doubaoKeyOpen, apiStatus, doubaoConfigured]);

  const refreshAudioCache = async () => {
    setStorageLoading(true); setStorageError('');
    void sendRuntime<LocalBackupStatus>({ type: 'GET_LOCAL_BACKUP_STATUS' }).then((status) => { setBackupStatus(status); setBackupStatusError(false); }).catch(() => setBackupStatusError(true));
    try {
      const [audio, usage] = await Promise.all([sendRuntime<SpeechCacheStatus>({ type: 'GET_SPEECH_CACHE_STATUS' }), sendRuntime<StorageUsage>({ type: 'GET_STORAGE_USAGE' })]);
      setAudioCache(audio); setStorageUsage(usage);
    } catch (reason) { setStorageError(`无法读取本机存储：${runtimeErrorMessage(reason)}`); }
    finally { setStorageLoading(false); }
  };

  const clearAudioCache = async () => {
    setCacheBusy(true);
    try {
      setAudioCache(await sendRuntime<SpeechCacheStatus>({ type: 'CLEAR_SPEECH_CACHE' }));
      setClearCacheOpen(false);
      setCacheMessage('语音缓存已清空，下次未缓存的朗读会重新合成。');
      await refreshAudioCache();
    } catch (reason) { setStorageError(runtimeErrorMessage(reason)); }
    finally { setCacheBusy(false); }
  };

  const saveSpeechKey = async (remove = false) => {
    setDoubaoKeyOpen(true);
    setDoubaoBusy(true);
    setSpeechError('');
    setSpeechMessage('');
    try {
      const status = await sendRuntime<DoubaoStatus>({ type: 'SAVE_DOUBAO_KEY', apiKey: remove ? '' : doubaoKey });
      setDoubaoConfigured(status.configured);
      setDoubaoKey('');
      setSpeechMessage(remove ? '豆包 Key 已移除，已缓存的音频仍可播放；未缓存的朗读将使用系统语音。' : '豆包 Key 已保存。试听优先播放缓存，未缓存时会请求豆包验证连接和音色。');
    } catch (reason) {
      setSpeechError(runtimeErrorMessage(reason));
    } finally { setDoubaoBusy(false); }
  };

  const previewSpeech = async () => {
    setSpeechBusy(true);
    setSpeechMessage('');
    setSpeechError('');
    try {
      const result = await sendRuntime<SpeechResult | { cancelled: true }>({ type: 'PREVIEW_SPEECH', provider: settings.ttsProvider });
      if (!('cancelled' in result)) setSpeechMessage(`已开始试听：${result.voiceName}。`);
    } catch (reason) {
      setSpeechError(runtimeErrorMessage(reason));
    } finally { setSpeechBusy(false); void refreshAudioCache(); }
  };

  const stopPreview = async () => {
    try {
      await sendRuntime({ type: 'STOP_SPEAKING' });
      setSpeechMessage('已停止朗读。');
    } catch (reason) { setSpeechError(runtimeErrorMessage(reason)); }
  };

  const refreshModels = async () => {
    setModelsLoading(true);
    setModelError('');
    try {
      setApiModels(await sendRuntime<string[]>({ type: 'GET_DEEPSEEK_MODELS' }));
    } catch (reason) {
      setModelError(runtimeErrorMessage(reason));
    } finally {
      setModelsLoading(false);
    }
  };

  const changeModel = async (model: string) => {
    setApiBusy(true);
    setModelError('');
    try {
      const saved = await sendRuntime<DeepSeekStatus>({ type: 'SAVE_DEEPSEEK_MODEL', model });
      setApiModel(saved.model);
      setApiStatus(saved.configured ? 'saved' : 'unconfigured');
      setApiMessage(`模型已切换为 ${saved.model}，后续翻译和学习分析将使用该模型。`);
    } catch (reason) {
      setModelError(runtimeErrorMessage(reason));
    } finally {
      setApiBusy(false);
    }
  };

  const checkApi = async () => {
    setDeepseekKeyOpen(true);
    setApiBusy(true);
    setApiMessage('');
    try {
      if (apiKey.trim()) {
        const saved = await sendRuntime<DeepSeekStatus>({ type: 'SAVE_DEEPSEEK_KEY', apiKey });
        setHasApiKey(saved.configured);
        setApiKey('');
      }
      const checked = await sendRuntime<DeepSeekStatus & { models: string[] }>({ type: 'CHECK_DEEPSEEK' });
      setApiModel(checked.model);
      setApiModels(checked.models);
      setModelError('');
      setApiStatus('ready');
      setApiMessage(`连接成功，可使用 ${checked.model}。实际调用需要账户有可用余额。`);
    } catch (reason) {
      setApiStatus('error');
      setApiMessage(runtimeErrorMessage(reason));
    } finally {
      setApiBusy(false);
    }
  };

  const clearApiKey = async () => {
    setApiBusy(true);
    try {
      await sendRuntime<DeepSeekStatus>({ type: 'SAVE_DEEPSEEK_KEY', apiKey: '' });
      setHasApiKey(false);
      setApiModels([]);
      setModelError('');
      setApiKey('');
      setApiStatus('unconfigured');
      setApiMessage('API Key 已移除。');
    } catch (reason) {
      setApiStatus('error');
      setApiMessage(runtimeErrorMessage(reason));
    } finally {
      setApiBusy(false);
    }
  };

  useEffect(() => {
    const refreshHostname = () => {
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        try { setHostname(tab?.url ? new URL(tab.url).hostname : ''); } catch { setHostname(''); }
      });
    };
    refreshHostname();
    chrome.tabs.onActivated.addListener(refreshHostname);
    chrome.tabs.onUpdated.addListener(refreshHostname);
    if ('Translator' in globalThis) {
      void Translator.availability({ sourceLanguage: 'en', targetLanguage: 'zh' })
        .then((status) => setTranslatorStatus(status === 'available' ? 'available' : status === 'downloadable' ? 'downloadable' : 'unavailable'))
        .catch(() => setTranslatorStatus('unavailable'));
    } else setTranslatorStatus('unavailable');
    void sendRuntime<DeepSeekStatus>({ type: 'GET_DEEPSEEK_STATUS' })
      .then((result) => {
        setHasApiKey(result.configured);
        setApiModel(result.model);
        setApiStatus(result.configured ? 'saved' : 'unconfigured');
      })
      .catch((reason) => {
        setApiStatus('error');
        setApiMessage(runtimeErrorMessage(reason));
      });
    void sendRuntime<DoubaoStatus>({ type: 'GET_DOUBAO_STATUS' })
      .then((status) => setDoubaoConfigured(status.configured))
      .catch((reason) => { setDoubaoConfigured(false); setSpeechError(runtimeErrorMessage(reason)); });
    return () => {
      chrome.tabs.onActivated.removeListener(refreshHostname);
      chrome.tabs.onUpdated.removeListener(refreshHostname);
    };
  }, []);

  useEffect(() => {
    if (active && page === 'ai' && hasApiKey && !modelsRequested.current) {
      modelsRequested.current = true;
      void refreshModels();
    }
  }, [active, page, hasApiKey]);

  useEffect(() => {
    if (!active || (focusRequest && handledFocus.current !== focusRequest.id)) return;
    document.getElementById(page ? 'settings-detail-title' : 'settings-home-title')?.focus();
  }, [active, page]);

  useEffect(() => {
    if (!active) return;
    void refreshAudioCache();
    const refresh = () => { void refreshAudioCache(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [active]);

  useEffect(() => {
    setVoicesLoading(true);
    void sendRuntime<TtsVoiceInfo[]>({ type: 'GET_TTS_VOICES', lang: settings.voice })
      .then(setTtsVoices)
      .catch((reason) => setError(`读取系统声线失败：${runtimeErrorMessage(reason)}`))
      .finally(() => setVoicesLoading(false));
  }, [settings.voice, settings.voiceGenderPreference]);

  const update = async (patch: Partial<AppSettings>) => {
    setSettingsBusy(true);
    try {
      const next = await sendRuntime<AppSettings>({ type: 'UPDATE_SETTINGS', settings: { ...settings, ...patch } });
      onSettingsChange(next);
    } catch (reason) {
      setError(runtimeErrorMessage(reason));
    } finally { setSettingsBusy(false); }
  };

  const saveContextLimit = async () => {
    if (settingsBusy || contextLimitSaving.current) return;
    const parsed = ContextHistoryLimitSchema.safeParse(contextLimitDraft.trim() ? Number(contextLimitDraft) : NaN);
    if (!parsed.success) {
      setContextLimitError(`请输入 1–${MAX_CONTEXT_HISTORY_LIMIT} 之间的整数。`);
      return;
    }
    setContextLimitError('');
    if (parsed.data === settings.contextHistoryLimit) return;
    contextLimitSaving.current = true;
    try { await update({ contextHistoryLimit: parsed.data }); }
    finally { contextLimitSaving.current = false; }
  };

  const siteEnabled = !hostname || !settings.disabledSites.includes(hostname);
  const toggleSite = (enabled: boolean) => {
    if (!hostname) return;
    const disabledSites = enabled
      ? settings.disabledSites.filter((site) => site !== hostname)
      : [...new Set([...settings.disabledSites, hostname])];
    void update({ disabledSites });
  };

  const openPage = (next: SettingsPage | null) => {
    setPage(next);
    window.scrollTo({ top: 0 });
  };
  const themeLabel = { system: '跟随系统', light: '浅色', dark: '深色' }[settings.theme];
  const modeLabel = { auto: '自动分析', manual: '手动分析', off: '分析已关闭' }[settings.deepseekMode];
  const voiceLabel = settings.ttsProvider === 'doubao'
    ? DOUBAO_VOICES.find((voice) => voice.id === settings.doubaoVoice)?.name.split(' · ')[0] ?? '自选音色'
    : settings.voice === 'en-US' ? '美式英语' : '英式英语';
  const backupNeedsAttention = backupStatusError || Boolean(backupStatus?.configured && (backupStatus.permission !== 'granted' || backupStatus.error));
  const dataNeedsAttention = backupNeedsAttention || Boolean(storageError) || Boolean(audioCache?.warning);
  const categories: SettingsCategory[] = [
    { id: 'general', title: '使用偏好', description: '划词、当前网站、主题与字体', summary: `${themeLabel} · ${settings.uiFont === 'inter' ? 'Inter 字体' : '系统字体'}` },
    { id: 'ai', title: '翻译与 AI', description: 'DeepSeek Key、模型与学习分析', summary: `${apiStatus === 'loading' ? '正在读取配置' : hasApiKey ? 'DeepSeek Key 已保存' : apiStatus === 'error' ? '配置读取异常' : 'DeepSeek Key 未设置'} · ${modeLabel}`, badge: apiStatus === 'error' ? '需检查' : apiStatus !== 'loading' && !hasApiKey ? '待配置' : undefined, attention: apiStatus === 'error' || (apiStatus !== 'loading' && !hasApiKey) },
    { id: 'speech', title: '朗读', description: '音色、语速、试听与语音 Key', summary: `${settings.ttsProvider === 'doubao' ? '豆包' : '系统语音'} · ${voiceLabel} · ${settings.speechRate}×`, badge: settings.ttsProvider === 'doubao' && doubaoConfigured === false ? '待配置' : undefined, attention: settings.ttsProvider === 'doubao' && doubaoConfigured === false },
    { id: 'data', title: '数据与隐私', description: '语境保留、目录备份与存储管理', summary: `每词 ${settings.contextHistoryLimit} 条语境 · ${storageUsage ? formatBytes(storageUsage.totalBytes) : storageError ? '用量读取失败' : '正在读取用量'} · ${backupStatusError ? '备份状态读取失败' : backupStatus?.configured ? backupNeedsAttention ? '备份需处理' : '已连接备份目录' : '可设置目录备份'}`, badge: dataNeedsAttention ? '需处理' : undefined, attention: dataNeedsAttention },
  ];
  const current = categories.find((category) => category.id === page);
  const deepseekExpanded = deepseekKeyOpen ?? (apiStatus === 'error' || (apiStatus !== 'loading' && !hasApiKey));
  const doubaoExpanded = doubaoKeyOpen ?? (settings.ttsProvider === 'doubao' && doubaoConfigured === false);

  return <Stack spacing={2} sx={{ p: 2, pb: 4 }}>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {!page && <SettingsOverview categories={categories} onOpen={openPage} />}
    {current && <SettingsHeader title={current.title} description={current.description} onBack={() => openPage(null)} />}
    {page === 'general' && <>
      <Section title="网页与划词">
        {hostname && <FormControlLabel control={<Switch checked={siteEnabled} disabled={settingsBusy} onChange={(_, checked) => toggleSite(checked)} />} label={`在 ${hostname} 启用`} sx={{ overflowWrap: 'anywhere' }} />}
        <FormControl fullWidth size="small"><InputLabel id="double-click-label">双击单词</InputLabel><Select labelId="double-click-label" label="双击单词" value={settings.doubleClickMode} onChange={(event) => void update({ doubleClickMode: event.target.value as AppSettings['doubleClickMode'] })}><MenuItem value="immediate">立即翻译</MenuItem><MenuItem value="button">先显示按钮</MenuItem><MenuItem value="off">关闭</MenuItem></Select></FormControl>
        <FormControl fullWidth size="small"><InputLabel id="phrase-label">划选短语</InputLabel><Select labelId="phrase-label" label="划选短语" value={settings.phraseSelectionMode} onChange={(event) => void update({ phraseSelectionMode: event.target.value as AppSettings['phraseSelectionMode'] })}><MenuItem value="button">显示翻译按钮</MenuItem><MenuItem value="immediate">立即翻译</MenuItem><MenuItem value="off">关闭</MenuItem></Select></FormControl>
        <FormControl fullWidth size="small"><InputLabel id="side-panel-selection-label">侧栏划词</InputLabel><Select labelId="side-panel-selection-label" label="侧栏划词" value={settings.sidePanelSelectionMode} onChange={(event) => void update({ sidePanelSelectionMode: event.target.value as AppSettings['sidePanelSelectionMode'] })}><MenuItem value="immediate">立即翻译</MenuItem><MenuItem value="button">先显示「释」按钮</MenuItem><MenuItem value="off">关闭</MenuItem></Select></FormControl>
      </Section>
      <Section title="外观">
        <FormControl fullWidth size="small"><InputLabel id="theme-label">主题</InputLabel><Select labelId="theme-label" label="主题" value={settings.theme} onChange={(event) => void update({ theme: event.target.value as AppSettings['theme'] })}><MenuItem value="system">跟随系统</MenuItem><MenuItem value="light">浅色</MenuItem><MenuItem value="dark">深色</MenuItem></Select></FormControl>
        <FormControl fullWidth size="small"><InputLabel id="ui-font-label">界面字体</InputLabel><Select labelId="ui-font-label" label="界面字体" value={settings.uiFont} onChange={(event) => void update({ uiFont: event.target.value as AppSettings['uiFont'] })}><MenuItem value="system">系统字体（推荐）</MenuItem><MenuItem value="inter">Inter</MenuItem></Select><FormHelperText>Inter 离线提供，中文使用系统字体。<Link href={interLicenseUrl} target="_blank" rel="noreferrer">字体许可</Link></FormHelperText></FormControl>
      </Section>
    </>}
    {page === 'ai' && <>
      <Section title="翻译与学习分析">
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {translatorStatus === 'available' ? <CheckCircle2 size={18} color="currentColor" aria-hidden="true" /> : translatorStatus === 'checking' ? <LoaderCircle size={18} aria-hidden="true" /> : <CircleAlert size={18} color="currentColor" aria-hidden="true" />}
          <Box><Typography variant="body2" sx={{ fontWeight: 600 }}>本地翻译</Typography><Typography variant="caption" color="text.secondary">{{ checking: '正在检查…', available: '已就绪，可离线翻译', downloadable: '首次使用需下载语言包', unavailable: '当前不可用，配置 API Key 后可使用 DeepSeek 翻译' }[translatorStatus]}</Typography></Box>
        </Stack>
        <FormControl fullWidth size="small">
          <InputLabel id="deepseek-label">DeepSeek 分析</InputLabel>
          <Select labelId="deepseek-label" label="DeepSeek 分析" value={settings.deepseekMode} onChange={(event) => void update({ deepseekMode: event.target.value as AppSettings['deepseekMode'] })}>
            <MenuItem value="auto">自动分析</MenuItem><MenuItem value="manual">点击提炼时分析（推荐）</MenuItem><MenuItem value="off">关闭</MenuItem>
          </Select>
          <FormHelperText>分析时会将原句发送给模型；相邻句和页面信息按设置决定是否发送。</FormHelperText>
        </FormControl>
          <FormControl fullWidth size="small" error={Boolean(modelError)} disabled={apiBusy || modelsLoading || apiStatus === 'loading'}>
            <InputLabel id="deepseek-model-label">DeepSeek 模型</InputLabel>
            <Select labelId="deepseek-model-label" label="DeepSeek 模型" value={apiModel} onChange={(event) => void changeModel(event.target.value)}>
              {[...new Set([apiModel, ...apiModels])].map((model) => <MenuItem key={model} value={model}>{model}</MenuItem>)}
            </Select>
            <FormHelperText>{modelError || (modelsLoading ? '正在读取可用模型…' : hasApiKey ? '选中后自动保存；不同模型的学习分析分别缓存。' : '保存 Key 并检查连接后，可获取账户的可用模型。')}</FormHelperText>
          </FormControl>
          <Button size="small" sx={{ alignSelf: 'flex-start' }} disabled={!hasApiKey || apiBusy || modelsLoading || apiStatus === 'loading'} onClick={() => void refreshModels()}>
            {modelsLoading ? '正在刷新…' : '刷新模型列表'}
          </Button>
      </Section>
      <Disclosure id="deepseek-key" title="DeepSeek Key 与连接" summary={apiKey.trim() ? '有待保存的新 Key' : apiStatus === 'loading' ? '正在读取配置…' : hasApiKey ? 'Key 已保存在本机，点击管理' : '尚未配置，展开填写 API Key'} expanded={deepseekExpanded} onChange={setDeepseekKeyOpen}>
        <Stack spacing={1.5} component="form" onSubmit={(event) => { event.preventDefault(); void checkApi(); }}>
          <Typography variant="caption" color="text.secondary">扩展直接连接 DeepSeek 官方 API。填入自己的 API Key 后，可选择模型用于学习分析和翻译回退。</Typography>
          <TextField
            label="DeepSeek API Key"
            inputRef={deepseekInput}
            type="password"
            size="small"
            fullWidth
            value={apiKey}
            disabled={apiBusy || apiStatus === 'loading'}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={hasApiKey ? '已保存；填写新 Key 可替换' : '粘贴 API Key'}
            autoComplete="off"
            helperText={hasApiKey ? 'Key 已保存在本机。留空时使用已保存的 Key。' : 'Key 仅保存在本机扩展存储中，不随词库备份导出。'}
          />
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button type="submit" size="small" variant="outlined" disabled={apiBusy || apiStatus === 'loading' || (!apiKey.trim() && !hasApiKey)} startIcon={apiBusy ? <LoaderCircle size={16} /> : undefined}>
              {apiBusy ? '正在检查…' : apiKey.trim() ? '保存并检查连接' : '检查连接'}
            </Button>
            {hasApiKey && <Button size="small" color="error" disabled={apiBusy} onClick={() => void clearApiKey()}>移除 Key</Button>}
          </Stack>
          <Box role="status" aria-live="polite">
            {apiMessage
              ? <Alert severity={apiStatus === 'error' ? 'error' : apiStatus === 'ready' ? 'success' : 'info'} sx={{ overflowWrap: 'anywhere' }}>{apiMessage}</Alert>
              : <Typography variant="caption" color="text.secondary">{apiStatus === 'loading' ? '正在读取配置…' : hasApiKey ? 'Key 已保存，可检查连接。' : '尚未配置 API Key，学习分析暂不可用。'}</Typography>}
          </Box>

        </Stack>
      </Disclosure>
          <Stack direction="row" useFlexGap spacing={2} sx={{ flexWrap: 'wrap' }}>
            <Link href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" variant="caption">DeepSeek Key 管理</Link>
            <Link href="https://platform.deepseek.com/usage" target="_blank" rel="noopener noreferrer" variant="caption">DeepSeek 余额与用量</Link>
          </Stack>
      <Disclosure id="analysis-options" title="上下文与缓存" summary="调整发送给模型的内容与分析缓存条数">

            <FormControl fullWidth size="small">
              <InputLabel id="context-label">发送的上下文</InputLabel>
              <Select labelId="context-label" label="发送的上下文" value={settings.contextRange} onChange={(event) => void update({ contextRange: event.target.value as AppSettings['contextRange'] })}>
                <MenuItem value="sentence">仅原句</MenuItem><MenuItem value="adjacent">前后各一句</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id="analysis-cache-label">学习分析缓存</InputLabel>
              <Select
                labelId="analysis-cache-label"
                label="学习分析缓存"
                value={settings.analysisCacheSize}
                onChange={(event) => void update({ analysisCacheSize: Number(event.target.value) })}
              >
                <MenuItem value={0}>关闭</MenuItem>
                <MenuItem value={3}>3 条</MenuItem>
                <MenuItem value={7}>7 条（推荐）</MenuItem>
                <MenuItem value={15}>15 条</MenuItem>
                <MenuItem value={30}>30 条</MenuItem>
              </Select>
              <FormHelperText>重复查询同一原句时，可更快显示学习内容。</FormHelperText>
            </FormControl>

        <FormControlLabel control={<Switch checked={settings.sharePageMetadata} onChange={(_, checked) => void update({ sharePageMetadata: checked })} />} label="向模型发送页面标题和来源域名" />
      </Disclosure>
    </>}
    {page === 'speech' && <>
      <Section title="朗读偏好">
        <FormControl fullWidth size="small">
          <InputLabel id="tts-provider-label">语音服务</InputLabel>
          {/* Keep disabled triggers programmatically focusable for MUI's menu focus restoration. */}
          <Select labelId="tts-provider-label" label="语音服务" value={settings.ttsProvider} disabled={voiceControlsBusy} readOnly={voiceControlsBusy} SelectDisplayProps={{ tabIndex: voiceControlsBusy ? -1 : 0 }} onChange={(event) => {
            setSpeechMessage(''); setSpeechError('');
            void sendRuntime({ type: 'STOP_SPEAKING' }).catch((reason) => setSpeechError(runtimeErrorMessage(reason)));
            void update({ ttsProvider: event.target.value as AppSettings['ttsProvider'] });
          }}>
            <MenuItem value="doubao">豆包 AI 语音（联网）</MenuItem>
            <MenuItem value="system">系统语音</MenuItem>
          </Select>
          <FormHelperText>使用豆包时，调用或播放失败会自动改用系统语音；试听会直接显示错误。</FormHelperText>
        </FormControl>
        {settings.ttsProvider === 'doubao' && <>
          <FormControl fullWidth size="small">
            <InputLabel id="doubao-voice-label">豆包音色</InputLabel>
            <Select labelId="doubao-voice-label" label="豆包音色" value={settings.doubaoVoice} disabled={voiceControlsBusy} readOnly={voiceControlsBusy} SelectDisplayProps={{ tabIndex: voiceControlsBusy ? -1 : 0 }} onChange={(event) => {
              setSpeechMessage(''); setSpeechError('');
              void sendRuntime({ type: 'STOP_SPEAKING' }).catch((reason) => setSpeechError(runtimeErrorMessage(reason)));
              void update({ doubaoVoice: event.target.value });
            }}>
              {!DOUBAO_VOICES.some((voice) => voice.id === settings.doubaoVoice) && <MenuItem value={settings.doubaoVoice}>{settings.doubaoVoice}</MenuItem>}
              {DOUBAO_VOICES.map((voice) => <MenuItem key={voice.id} value={voice.id}>{voice.name}</MenuItem>)}
            </Select>
            <FormHelperText>英文学习优先选英文音色。可用音色以账户权限为准；音色选择后自动保存。</FormHelperText>
          </FormControl>
          <Typography variant="caption" color="text.secondary">优先播放缓存；首次合成会将朗读文本发给火山引擎并产生用量。语音为 AI 合成。</Typography>
        </>}
        {settings.ttsProvider === 'system' && <>
            <FormControl fullWidth size="small"><InputLabel id="voice-label">系统英语口音</InputLabel><Select labelId="voice-label" label="系统英语口音" value={settings.voice} onChange={(event) => void update({ voice: event.target.value as AppSettings['voice'], voiceName: 'auto' })}><MenuItem value="en-US">美式英语</MenuItem><MenuItem value="en-GB">英式英语</MenuItem></Select></FormControl>
        </>}
        <FormControl fullWidth size="small"><InputLabel id="rate-label">语速</InputLabel><Select labelId="rate-label" label="语速" value={settings.speechRate} disabled={rateControlBusy} readOnly={rateControlBusy} SelectDisplayProps={{ tabIndex: rateControlBusy ? -1 : 0 }} onChange={(event) => void update({ speechRate: Number(event.target.value) as AppSettings['speechRate'] })}><MenuItem value={0.75}>0.75×</MenuItem><MenuItem value={1}>1.0×</MenuItem><MenuItem value={1.25}>1.25×</MenuItem></Select></FormControl>
        <FormControl fullWidth size="small"><InputLabel id="scope-label">朗读范围</InputLabel><Select labelId="scope-label" label="朗读范围" value={settings.speechScope} onChange={(event) => void update({ speechScope: event.target.value as AppSettings['speechScope'] })}><MenuItem value="sentence">原句（重音更自然）</MenuItem><MenuItem value="word">仅选中内容</MenuItem></Select></FormControl>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={speechBusy ? <CircularProgress size={17} color="inherit" /> : <Volume2 size={17} />} disabled={speechBusy || doubaoBusy || settingsBusy || cacheBusy || (settings.ttsProvider === 'doubao' && (doubaoConfigured === null || Boolean(doubaoKey.trim())))} onClick={() => void previewSpeech()}>
            {speechBusy ? '正在准备试听…' : '试听当前音色'}
          </Button>
          <Button onClick={() => void stopPreview()}>停止朗读</Button>
        </Stack>
        {settings.ttsProvider === 'doubao' && doubaoKey.trim() && <Typography variant="caption" color="text.secondary">请先保存 Key，再试听。</Typography>}
      </Section>
        {speechError && <Alert severity="error">{speechError}</Alert>}
        {speechMessage && <Alert severity="success" role="status">{speechMessage}</Alert>}
      <Disclosure id="doubao-key" title="豆包语音 Key" summary={doubaoKey.trim() ? '有待保存的新 Key' : doubaoConfigured === null ? '正在读取配置…' : doubaoConfigured ? 'Key 已保存在本机，点击管理' : '可选；配置后可切换为豆包 AI 语音'} expanded={doubaoExpanded} onChange={setDoubaoKeyOpen}>
        {settings.ttsProvider !== 'doubao' && <Typography variant="body2" color="text.secondary">保存 Key 后，将语音服务切换为「豆包 AI 语音」即可使用和试听。</Typography>}
          <TextField
            label="豆包语音 API Key" type="password" size="small" fullWidth
            inputRef={doubaoInput}
            value={doubaoKey} disabled={doubaoBusy || speechBusy || doubaoConfigured === null}
            autoComplete="off" placeholder={doubaoConfigured ? '已保存，填写新 Key 可替换' : '填写火山语音控制台的 API Key'}
            onChange={(event) => setDoubaoKey(event.target.value)}
            helperText={doubaoConfigured ? 'Key 已保存在本机，不显示原值，也不包含在词库备份中。' : '需开通“语音合成 2.0 字符版”；此处使用语音服务的 API Key。'}
          />
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button variant="outlined" disabled={!doubaoKey.trim() || doubaoBusy || speechBusy} onClick={() => void saveSpeechKey()} startIcon={doubaoBusy ? <CircularProgress size={16} color="inherit" /> : undefined}>保存 Key</Button>
            <Button color="error" disabled={!doubaoConfigured || doubaoBusy || speechBusy} onClick={() => void saveSpeechKey(true)}>移除 Key</Button>
          </Stack>

      </Disclosure>
          <Stack direction="row" useFlexGap spacing={2} sx={{ flexWrap: 'wrap' }}>
            <Link href="https://console.volcengine.com/speech/new/setting/apikeys" target="_blank" rel="noopener noreferrer" variant="caption">豆包 Key 管理</Link>
            <Link href="https://console.volcengine.com/speech/new/usage-statistics?projectName=default" target="_blank" rel="noopener noreferrer" variant="caption">豆包用量统计</Link>
            <Link href="https://console.volcengine.com/finance/account-overview/" target="_blank" rel="noopener noreferrer" variant="caption">余额与账单</Link>
          </Stack>
      <Disclosure id="system-voice-options" title={settings.ttsProvider === 'doubao' ? '系统备用语音' : '系统声线细调'} summary="口音、声线偏好与可用声线">
        {settings.ttsProvider === 'doubao' && <>
            <FormControl fullWidth size="small"><InputLabel id="voice-label">系统英语口音</InputLabel><Select labelId="voice-label" label="系统英语口音" value={settings.voice} onChange={(event) => void update({ voice: event.target.value as AppSettings['voice'], voiceName: 'auto' })}><MenuItem value="en-US">美式英语</MenuItem><MenuItem value="en-GB">英式英语</MenuItem></Select></FormControl>
        </>}

                <FormControl fullWidth size="small">
                  <InputLabel id="voice-gender-label">声线偏好</InputLabel>
                  <Select
                    labelId="voice-gender-label"
                    label="声线偏好"
                    value={settings.voiceGenderPreference}
                    onChange={(event) => void update({
                      voiceGenderPreference: event.target.value as AppSettings['voiceGenderPreference'],
                      voiceName: 'auto',
                    })}
                  >
                    <MenuItem value="auto">自动（推荐）</MenuItem>
                    <MenuItem value="female">优先女声</MenuItem>
                    <MenuItem value="male">优先男声</MenuItem>
                  </Select>
                  <FormHelperText>仅影响自动选择；无法识别性别时会回退到同口音的高质量声线。</FormHelperText>
                </FormControl>
                <FormControl fullWidth size="small">
                  <InputLabel id="voice-name-label">声线</InputLabel>
                  <Select
                    labelId="voice-name-label"
                    label="声线"
                    value={ttsVoices.some((voice) => voice.voiceName === settings.voiceName) ? settings.voiceName : 'auto'}
                    onChange={(event) => void update({ voiceName: event.target.value })}
                  >
                    <MenuItem value="auto">自动选择（推荐）</MenuItem>
                    {ttsVoices.map((voice) => (
                      <MenuItem key={`${voice.voiceName}:${voice.lang}`} value={voice.voiceName}>
                        {voice.voiceName}{voice.recommended ? '（推荐）' : ''} · {voice.gender === 'female' ? '女声' : voice.gender === 'male' ? '男声' : '性别未知'} · {voice.lang} · {voice.remote ? '联网' : '离线'}
                      </MenuItem>
                    ))}
                  </Select>
                  {voicesLoading && <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>正在读取系统声线…</Typography>}
                  {!voicesLoading && <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>联网声线由浏览器语音服务处理朗读文本；如需完全离线，请选择标注为“离线”的声线。</Typography>}
                </FormControl>
      </Disclosure>
    </>}
    {page === 'data' && <>
      <Section title="词库语境">
        <TextField
          fullWidth size="small" type="number" label="每个词条保留的语境数"
          value={contextLimitDraft} error={Boolean(contextLimitError)}
          onChange={(event) => { setContextLimitDraft(event.target.value); setContextLimitError(''); }}
          onBlur={() => void saveContextLimit()}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveContextLimit(); } }}
          slotProps={{ htmlInput: { min: 1, max: MAX_CONTEXT_HISTORY_LIMIT, step: 1, readOnly: settingsBusy, 'aria-busy': settingsBusy } }}
          helperText={contextLimitError || `默认 3 条，可设为 1–${MAX_CONTEXT_HISTORY_LIMIT} 条。移开焦点或按回车保存。`}
        />
        <Typography variant="body2" color="text.secondary">按保存顺序保留最近 N 条；超出时删除最早保存的语境，重复保存不改变顺序。调小后立即移除超额语境，调大不会恢复已删除记录。</Typography>
      </Section>
      <Section title="目录备份与恢复"><LocalBackupPanel active={active && page === 'data'} onChanged={() => void refreshAudioCache()} /></Section>
      <Section title="存储用量">
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="body2">数据占用 · {storageUsage ? formatBytes(storageUsage.totalBytes) : '正在读取…'}</Typography>
          <Button size="small" disabled={storageLoading || cacheBusy} onClick={() => void refreshAudioCache()}>{storageLoading ? '正在刷新…' : '刷新用量'}</Button>
        </Stack>
        {storageError && <Alert severity="error">{storageError}</Alert>}
        <Table size="small" aria-label="本机存储使用情况">
          <TableHead><TableRow><TableCell>数据</TableCell><TableCell align="right">条目数</TableCell><TableCell align="right">占用</TableCell></TableRow></TableHead>
          <TableBody>{storageUsage?.categories.map((item) => <TableRow key={item.id}><TableCell component="th" scope="row">{item.label}</TableCell><TableCell align="right">{item.count == null ? '—' : item.count.toLocaleString()}</TableCell><TableCell align="right">{formatBytes(item.bytes)}</TableCell></TableRow>)}</TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary">按数据内容估算，实际磁盘占用还包含数据库索引等开销；外部目录备份另占空间。</Typography>
        <Typography variant="caption" color="text.secondary">音频保留 30 天，最多 10 万条 / 1 GiB；过期或久未使用的音频会自动回收。</Typography>
        {Boolean(audioCache?.expiredCount) && <Typography variant="caption" color="text.secondary">还有 {audioCache!.expiredCount.toLocaleString()} 条过期音频等待后续使用时回收，已计入占用；这些音频不会播放或备份。</Typography>}
        {audioCache?.warning && <Alert severity="warning">{audioCache.warning}</Alert>}
      </Section>

      {cacheMessage && <Alert severity="success" onClose={() => setCacheMessage('')}>{cacheMessage}</Alert>}
      <Section title="历史与隐私">
        <FormControlLabel control={<Switch checked={settings.historyEnabled} disabled={settingsBusy} onChange={(_, checked) => void update({ historyEnabled: checked })} />} label="保存最近 200 条查询历史" />
        <Typography variant="body2" color="text.secondary">词库、历史、设置和 Key 保存在本机。Key 不进入词库或目录备份。</Typography>
      </Section>
      <Disclosure id="privacy-details" title="数据如何使用" summary="查看哪些内容会发送给模型与语音服务">
        <Typography variant="body2" color="text.secondary">Chrome 本地翻译可离线使用。学习分析和翻译回退请求 DeepSeek；豆包朗读请求火山引擎；系统联网声线由浏览器语音服务处理朗读文本。模型上下文和页面信息共享可在「翻译与 AI」中调整。</Typography>
      </Disclosure>
      <Disclosure id="delete-data" title="清理与删除" summary="清除历史、音频缓存或全部词库，操作前需要确认">
        <Typography variant="body2" color="text.secondary">建议先确认备份已完成，再删除需要保留的数据。</Typography>
        <Button variant="outlined" color="error" onClick={() => setClearCacheOpen(true)} disabled={cacheBusy || speechBusy || !audioCache?.count}>清空语音缓存</Button>
        <Button variant="outlined" startIcon={<Database size={16} aria-hidden="true" />} onClick={() => setClearTarget('history')}>清除历史</Button>
        <Button variant="outlined" color="error" startIcon={<Trash2 size={16} aria-hidden="true" />} onClick={() => setClearTarget('library')}>清除全部词库</Button>
      </Disclosure>
    </>}
      <Dialog open={clearCacheOpen} onClose={() => { if (!cacheBusy) setClearCacheOpen(false); }}>
        <DialogTitle>清空语音缓存？</DialogTitle>
        <DialogContent><Typography variant="body2">已保存的音频将从本机删除，下次朗读需要重新合成并产生用量。词库和 API Key 会保留。</Typography></DialogContent>
        <DialogActions>
          <Button disabled={cacheBusy} onClick={() => setClearCacheOpen(false)}>取消</Button>
          <Button disabled={cacheBusy} color="error" variant="contained" onClick={() => void clearAudioCache()}>{cacheBusy ? '正在清空…' : '确认清空'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(clearTarget)} onClose={() => setClearTarget(null)}>
        <DialogTitle>{clearTarget === 'library' ? '清除全部词库？' : '清除查询历史？'}</DialogTitle>
        <DialogContent><Typography variant="body2">{clearTarget === 'library' ? '全部词条、笔记和语境将从本机删除，且无法恢复。' : '最近查询记录将被删除，词库内容不受影响。'}</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setClearTarget(null)}>取消</Button>
          <Button color="error" variant="contained" onClick={async () => { try { await sendRuntime({ type: clearTarget === 'library' ? 'CLEAR_LIBRARY' : 'CLEAR_HISTORY' }); setClearTarget(null); void refreshAudioCache(); } catch (reason) { setError(runtimeErrorMessage(reason)); } }}>确认清除</Button>
        </DialogActions>
      </Dialog>
  </Stack>;
}
