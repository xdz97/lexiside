import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, ExternalLink, Plus, RotateCw, Sparkles } from 'lucide-react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  analysisCandidates,
  findSavedCandidate,
  findSavedSelection,
  hasSavedContext,
  learningItemKey,
  type AppSettings,
  type CurrentLookup,
  type LearningCandidate,
  type LearningItem,
} from '@lexiside/shared';
import { runtimeErrorMessage, sendRuntime } from '../../../lib/runtime';
import { SpeechButton } from '../components/SpeechButton';
import { LearningDetails } from '../components/LearningDetails';
import { actionIconSx } from '../components/actionIconStyles';
import { SavedContextNotice } from '../components/SavedContextNotice';
import { selectionLemma } from '../../../lib/reencounter';

interface CandidateCardProps {
  candidate: LearningCandidate;
  context: CurrentLookup['context'];
  saved: boolean;
  savedItem?: LearningItem;
  showSavedNotice: boolean;
  saving: boolean;
  onSave: () => Promise<void>;
}

interface HighlightedSentenceProps {
  sentence: string;
  selectedText: string;
}

function HighlightedSentence({ sentence, selectedText }: HighlightedSentenceProps) {
  const selection = selectedText.trim();
  const index = selection.length < sentence.length
    ? sentence.toLocaleLowerCase().indexOf(selection.toLocaleLowerCase())
    : -1;

  if (index < 0) return sentence;

  return (
    <>
      {sentence.slice(0, index)}
      <Box
        component="mark"
        sx={{
          px: 0.25,
          mx: -0.25,
          color: 'inherit',
          bgcolor: 'action.selected',
          borderRadius: 0.5,
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
          fontWeight: 550,
        }}
      >
        {sentence.slice(index, index + selection.length)}
      </Box>
      {sentence.slice(index + selection.length)}
    </>
  );
}

function CandidateCard({ candidate, context, saved, savedItem, showSavedNotice, saving, onSave }: CandidateCardProps) {
  const [expanded, setExpanded] = useState(false);
  const text = candidate.value.text;
  const meaning = candidate.type === 'pattern' ? candidate.value.explanationZh : candidate.value.meaningZh;
  const category = candidate.type === 'word' ? '单词' : candidate.type === 'phrase' ? '表达' : '句型';
  const word = candidate.type === 'word' ? candidate.value : null;
  const phrase = candidate.type === 'phrase' ? candidate.value : null;
  const hasDetails = Boolean(
    word?.definitionEn
    || word?.meaningInContext
    || word?.collocations.length
    || phrase?.usage,
  );
  const saveLabel = saved ? '当前语境已保存' : saving ? `正在保存 ${text}` : savedItem ? `保存 ${text} 的当前语境` : `保存 ${text}`;

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography lang="en" sx={{ fontWeight: 650, overflowWrap: 'anywhere', flexBasis: '100%' }}>{text}</Typography>
            <Chip label={category} size="small" variant="outlined" sx={{ height: 22 }} />
            {word?.partOfSpeech && <Chip label={word.partOfSpeech} size="small" sx={{ height: 22 }} />}
            {word?.phonetic && <Typography lang="en" variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{word.phonetic}</Typography>}
          </Stack>
          <Typography sx={{ mt: 0.5 }}>{meaning}</Typography>
        </Box>
        <Stack direction="row" spacing={0.75}>
          <SpeechButton size="small" iconSize={17} label={`朗读词条 ${text}`} text={text} context={context.sentence} scope="word" />
          <Tooltip title={saveLabel}>
            <span>
              <IconButton aria-label={saveLabel} aria-busy={saving} disabled={saved || saving} size="small" sx={actionIconSx} onClick={() => void onSave()}>
                {saved ? <Check size={17} /> : <Plus size={17} />}
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {savedItem && showSavedNotice && <Box sx={{ mt: 1 }}><SavedContextNotice item={savedItem} context={context} /></Box>}

      {hasDetails && (
        <>
          <Button
            size="small"
            color="inherit"
            aria-expanded={expanded}
            endIcon={expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            sx={{ mt: 0.75, px: 0.5, color: 'text.secondary' }}
            onClick={() => setExpanded((value) => !value)}
          >
            {word ? '查看释义与搭配' : '查看用法说明'}
          </Button>
          <Collapse in={expanded} unmountOnExit>
            <Box sx={{ mt: 0.75, pt: 1.25, borderTop: 1, borderColor: 'divider' }}>
              <LearningDetails
                definitionEn={word?.definitionEn}
                meaningInContext={word?.meaningInContext}
                collocations={word?.collocations}
                usage={phrase?.usage}
              />
            </Box>
          </Collapse>
        </>
      )}
    </Paper>
  );
}

export function CurrentView() {
  const [current, setCurrent] = useState<CurrentLookup | null>(null);
  const [library, setLibrary] = useState<LearningItem[]>([]);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [deepseekMode, setDeepseekMode] = useState<AppSettings['deepseekMode'] | null>(null);
  const [analysisTakingLonger, setAnalysisTakingLonger] = useState(false);
  const [error, setError] = useState('');
  const activeTabId = useRef<number | undefined>(undefined);
  const loadRequest = useRef(0);
  const displayedRequestId = useRef<string | undefined>(undefined);
  displayedRequestId.current = current?.context.requestId;

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    activeTabId.current = undefined;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId.current = tab?.id;
    const next = tab?.id == null ? null : await sendRuntime<CurrentLookup | null>({ type: 'GET_CURRENT', tabId: tab.id });
    if (request === loadRequest.current) setCurrent(next);
  }, []);

  useEffect(() => {
    void load();
    void sendRuntime<AppSettings>({ type: 'GET_SETTINGS' })
      .then((settings) => setDeepseekMode(settings.deepseekMode))
      .catch(() => undefined);
    const listener = (message: { type?: string; current?: CurrentLookup; tabId?: number; settings?: AppSettings }) => {
      if (message.type === 'CURRENT_UPDATED' && message.current && message.current.tabId === activeTabId.current) {
        loadRequest.current += 1;
        setCurrent(message.current);
      }
      if (message.type === 'CURRENT_CLEARED' && message.tabId === activeTabId.current) setCurrent(null);
      if (message.type === 'SETTINGS_UPDATED' && message.settings) setDeepseekMode(message.settings.deepseekMode);
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.tabs.onActivated.addListener(load);
    chrome.tabs.onRemoved.addListener(load);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.tabs.onActivated.removeListener(load);
      chrome.tabs.onRemoved.removeListener(load);
      loadRequest.current += 1;
    };
  }, [load]);

  const candidates = useMemo(
    () => (current?.analysis ? analysisCandidates(current.analysis) : []),
    [current?.analysis],
  );

  useEffect(() => {
    setAnalysisTakingLonger(false);
    if (current?.analysisState !== 'loading') return;
    const timer = setTimeout(() => setAnalysisTakingLonger(true), 10_000);
    return () => clearTimeout(timer);
  }, [current?.context.requestId, current?.analysisState]);

  const keyOf = (candidate: LearningCandidate) => {
    const partOfSpeech = candidate.type === 'word' ? candidate.value.partOfSpeech : '';
    return learningItemKey(candidate.type, candidate.type === 'word' ? candidate.value.lemma : candidate.value.text, partOfSpeech);
  };

  useEffect(() => {
    let cancelled = false;
    let loadId = 0;
    setLibrary([]);
    const loadSaved = () => {
      if (!current) return;
      const id = ++loadId;
      void sendRuntime<LearningItem[]>({ type: 'LIST_LIBRARY' }).then((items) => {
        if (!cancelled && id === loadId) setLibrary(items);
      }).catch(() => undefined);
    };
    loadSaved();
    const onLibraryUpdated = (message: { type?: string }) => {
      if (message.type === 'LIBRARY_UPDATED') loadSaved();
    };
    chrome.runtime.onMessage.addListener(onLibraryUpdated);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(onLibraryUpdated);
    };
  }, [current?.context.requestId]);

  const updateSavedItem = (item: LearningItem) => setLibrary((items) => [item, ...items.filter((existing) => existing.id !== item.id)]);

  const save = async (candidate: LearningCandidate): Promise<boolean> => {
    if (!current) return false;
    const requestId = current.context.requestId;
    setError('');
    const key = `${requestId}:${keyOf(candidate)}`;
    setSaving((value) => new Set(value).add(key));
    try {
      const item = await sendRuntime<LearningItem>({ type: 'SAVE_CANDIDATE', candidate, context: current.context });
      if (displayedRequestId.current === requestId) updateSavedItem(item);
      return true;
    } catch (reason) {
      if (displayedRequestId.current === requestId) setError(runtimeErrorMessage(reason));
      return false;
    } finally {
      setSaving((value) => { const next = new Set(value); next.delete(key); return next; });
    }
  };

  if (!current) {
    return (
      <Stack spacing={1.5} sx={{ minHeight: 'calc(100vh - 96px)', px: 4, textAlign: 'center', alignItems: 'center', justifyContent: 'center' }}>
        <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: 'action.hover', color: 'primary.main', display: 'grid', placeItems: 'center' }}>
          <Sparkles size={22} />
        </Box>
        <Typography variant="subtitle1">从网页中拾取一个词</Typography>
        <Typography color="text.secondary" variant="body2">
          双击英文单词，或选中短语后点击“译”。翻译和学习内容会显示在这里。
        </Typography>
      </Stack>
    );
  }

  const { context } = current;
  const matches = findSavedSelection(library, context.selectedText, selectionLemma(current)).slice(0, 3);
  return (
    <Stack spacing={2.25} sx={{ p: 2, pb: 4 }} data-lexi-source-url={context.pageUrl} data-lexi-source-title={context.pageTitle} data-lexi-source-site={context.siteName}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Box component="section" aria-labelledby="original-heading">
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography id="original-heading" variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: '0.02em' }}>原文</Typography>
          <SpeechButton label="朗读原句" text={context.sentence} scope="sentence" />
        </Stack>
        <Typography
          lang="en"
          sx={{
            maxWidth: '72ch',
            fontSize: 15,
            lineHeight: 1.7,
            letterSpacing: '0.005em',
            overflowWrap: 'anywhere',
            userSelect: 'text',
          }}
          data-lexi-lookup-text="sentence"
          data-lexi-lookup-origin="web"
          tabIndex={-1}
        >
          <HighlightedSentence sentence={context.sentence} selectedText={context.selectedText} />
        </Typography>
      </Box>

      <Box component="section" aria-labelledby="translation-heading">
        <Typography id="translation-heading" variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: '0.02em' }}>所选内容的快速翻译</Typography>
        <Typography
          sx={{
            mt: 0.75,
            maxWidth: '72ch',
            fontSize: 14.5,
            lineHeight: 1.75,
            overflowWrap: 'anywhere',
          }}
        >
          {context.translation}
        </Typography>
      </Box>

      {matches.map((item) => <SavedContextNotice key={`${context.requestId}:${item.id}`} item={item} context={context} onSaved={(updated) => {
        if (displayedRequestId.current === context.requestId) updateSavedItem(updated);
      }} />)}

      <Divider />

      <Box component="section" aria-labelledby="learning-heading">
        <Stack direction="row" sx={{ mb: 1, alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography id="learning-heading" variant="subtitle1">值得积累</Typography>
        </Stack>

        {current.analysisState === 'loading' && deepseekMode !== 'off' && (
          <Stack spacing={1.25} aria-live="polite">
            <Skeleton variant="rounded" height={84} />
            <Skeleton variant="rounded" height={84} />
            {analysisTakingLonger && <Typography variant="body2" color="text.secondary">正在等待 DeepSeek 返回学习内容；可以继续阅读。</Typography>}
          </Stack>
        )}
        {(current.analysisState === 'unavailable' || current.analysisState === 'error') && deepseekMode !== 'off' && (
          <Alert
            severity="warning"
            action={
              <Button color="inherit" size="small" startIcon={<RotateCw size={15} />} onClick={() => void sendRuntime({ type: 'REQUEST_ANALYSIS', context })}>
                重试
              </Button>
            }
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>学习分析暂时不可用，基础翻译仍可正常使用。</Typography>
            {current.error && <Typography variant="body2" sx={{ mt: 0.5 }}>{current.error}</Typography>}
          </Alert>
        )}
        {current.analysisState === 'idle' && (deepseekMode === 'manual' || deepseekMode === 'auto') && (
          <Button variant="outlined" startIcon={<Sparkles size={16} />} onClick={() => void sendRuntime({ type: 'REQUEST_ANALYSIS', context })}>
            提炼学习内容
          </Button>
        )}
        {current.analysisState === 'idle' && deepseekMode === 'off' && (
          <Typography color="text.secondary" variant="body2">学习分析已关闭，可在设置中开启。</Typography>
        )}
        {current.analysisState === 'idle' && deepseekMode === 'manual' && (
          <Typography color="text.secondary" variant="caption">提炼时会将原句发送给模型；相邻句和页面信息按设置决定是否发送。</Typography>
        )}
        {current.analysisState === 'ready' && candidates.length === 0 && (
          <Typography color="text.secondary" variant="body2">这段内容暂时没有高置信度的学习候选。</Typography>
        )}
        <Stack spacing={1}>
          {candidates.map((candidate) => {
            const key = keyOf(candidate);
            const savedItem = findSavedCandidate(library, candidate);
            return (
              <CandidateCard
                key={`${context.requestId}:${key}`}
                candidate={candidate}
                context={context}
                saved={Boolean(savedItem && hasSavedContext(savedItem, context))}
                savedItem={savedItem}
                showSavedNotice={!matches.some((item) => item.id === savedItem?.id)}
                saving={saving.has(`${context.requestId}:${key}`)}
                onSave={async () => { await save(candidate); }}
              />
            );
          })}
        </Stack>
      </Box>

      <Divider />
      <Box component="section" aria-labelledby="source-heading">
        <Typography id="source-heading" variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>来源</Typography>
        <Button
          size="small"
          endIcon={<ExternalLink size={15} />}
          sx={{ mt: 0.5, px: 0, display: 'flex', maxWidth: '100%', justifyContent: 'flex-start' }}
          onClick={() => void chrome.tabs.create({ url: context.pageUrl })}
        >
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {context.pageTitle || context.siteName}
          </Box>
        </Button>
      </Box>
    </Stack>
  );
}
