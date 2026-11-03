import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, Plus, X } from 'lucide-react';
import { Alert, Box, Button, CircularProgress, IconButton, Paper, Popper, Stack, Tooltip, Typography } from '@mui/material';
import { hasSavedContext, normalizeLearningText, type AppSettings, type LearningItem, type SelectionContext } from '@lexiside/shared';
import { runtimeErrorMessage, sendRuntime } from '../../../lib/runtime';
import { withLocalTranslationTimeout } from '../../../lib/local-translation';
import { SpeechButton } from './SpeechButton';
import { actionIconSx } from './actionIconStyles';
import { SavedContextNotice } from './SavedContextNotice';

type LookupPhase = 'action' | 'loading' | 'ready' | 'error';

interface LookupState {
  phase: LookupPhase;
  context: SelectionContext;
  rect: DOMRect;
  source: HTMLElement;
  translation?: string;
  phonetic?: string;
  saved?: boolean;
  savedItem?: LearningItem;
  error?: string;
}

interface InlineLookupProps {
  mode: AppSettings['sidePanelSelectionMode'];
  onOpenLibrary: (query: string) => void;
}

const translationCache = new Map<string, string>();
let translatorPromise: Promise<TranslatorInstance> | null = null;

async function translate(text: string): Promise<string> {
  if ('Translator' in globalThis) {
    try {
      translatorPromise ??= Translator.create({ sourceLanguage: 'en', targetLanguage: 'zh' })
        .catch((error) => {
          translatorPromise = null;
          throw error;
        });
      return await withLocalTranslationTimeout(translatorPromise.then((translator) => translator.translate(text)));
    } catch {
      // Use the existing basic translation fallback when the local language pack is unavailable.
    }
  }
  return sendRuntime<string>({ type: 'TRANSLATE_FALLBACK', requestId: crypto.randomUUID(), text });
}

function lookupSource(node: Node | null): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node?.parentElement;
  return element?.closest<HTMLElement>('[data-lexi-lookup-text]') ?? null;
}

function selectedLookup(): LookupState | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().replace(/\s+/g, ' ').trim();
  if (!text || text.length > 240 || !/[A-Za-z]/.test(text)) return null;

  const source = lookupSource(selection.anchorNode);
  if (!source || source !== lookupSource(selection.focusNode)) return null;
  const origin = source.closest<HTMLElement>('[data-lexi-source-url]');
  const pageUrl = origin?.dataset.lexiSourceUrl;
  if (!pageUrl) return null;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const sentence = source.textContent?.replace(/\s+/g, ' ').trim() || text;
  return {
    phase: 'action',
    rect,
    source,
    context: {
      requestId: crypto.randomUUID(),
      selectedText: text,
      sentence,
      contextBefore: '',
      contextAfter: '',
      translation: '',
      pageTitle: origin?.dataset.lexiSourceTitle ?? '',
      pageUrl,
      siteName: origin?.dataset.lexiSourceSite ?? '',
      lookupOrigin: source.dataset.lexiLookupOrigin === 'web' ? 'web' : 'definition',
      capturedAt: new Date().toISOString(),
    },
  };
}

export function InlineLookup({ mode, onOpenLibrary }: InlineLookupProps) {
  const [lookup, setLookup] = useState<LookupState | null>(null);
  const requestId = useRef(0);
  const lastSelection = useRef<{ source: HTMLElement; text: string; anchorNode: Node | null; anchorOffset: number; focusNode: Node | null; focusOffset: number } | null>(null);

  const close = (restoreFocus = false) => {
    requestId.current += 1;
    lastSelection.current = null;
    if (restoreFocus) lookup?.source.focus({ preventScroll: true });
    setLookup(null);
  };

  useEffect(() => {
    const showAction = (event: MouseEvent | KeyboardEvent) => {
      if (mode === 'off') return;
      if (event instanceof KeyboardEvent) {
        if (!['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      } else if (!(event.target instanceof Element && event.target.closest('[data-lexi-lookup-text]'))) {
        return;
      }
      const next = selectedLookup();
      if (!next) return;
      const selection = window.getSelection();
      const signature = {
        source: next.source,
        text: next.context.selectedText,
        anchorNode: selection?.anchorNode ?? null,
        anchorOffset: selection?.anchorOffset ?? 0,
        focusNode: selection?.focusNode ?? null,
        focusOffset: selection?.focusOffset ?? 0,
      };
      const previous = lastSelection.current;
      if (previous
        && previous.source === signature.source
        && previous.text === signature.text
        && previous.anchorNode === signature.anchorNode
        && previous.anchorOffset === signature.anchorOffset
        && previous.focusNode === signature.focusNode
        && previous.focusOffset === signature.focusOffset) return;
      lastSelection.current = signature;
      requestId.current += 1;
      if (mode === 'immediate') void resolve(next);
      else setLookup(next);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-lexi-lookup-overlay]')) return;
      requestId.current += 1;
      lastSelection.current = null;
      setLookup(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!document.querySelector('[data-lexi-lookup-overlay]')) return;
      requestId.current += 1;
      lastSelection.current = null;
      setLookup((current) => {
        current?.source.focus({ preventScroll: true });
        return null;
      });
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-lexi-lookup-overlay]')) return;
      requestId.current += 1;
      lastSelection.current = null;
      setLookup(null);
    };
    document.addEventListener('mouseup', showAction);
    document.addEventListener('keyup', showAction);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mouseup', showAction);
      document.removeEventListener('keyup', showAction);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'off') return;
    requestId.current += 1;
    lastSelection.current = null;
    setLookup(null);
  }, [mode]);

  useEffect(() => () => {
    requestId.current += 1;
    translatorPromise?.then((translator) => translator.destroy()).catch(() => undefined);
    translatorPromise = null;
  }, []);

  const anchor = useMemo(() => lookup && ({ getBoundingClientRect: () => lookup.rect }), [lookup]);

  const resolve = async (state: LookupState) => {
    const currentRequest = ++requestId.current;
    setLookup({ ...state, phase: 'loading' });
    try {
      const key = normalizeLearningText(state.context.selectedText);
      const library = await sendRuntime<LearningItem[]>({ type: 'GET_SAVED_MATCHES', text: state.context.selectedText });
      const savedItem = library[0];
      const translation = savedItem?.meaningZh || translationCache.get(key) || await translate(state.context.selectedText);
      if (currentRequest !== requestId.current) return;
      if (!translationCache.has(key)) {
        translationCache.set(key, translation);
        if (translationCache.size > 100) translationCache.delete(translationCache.keys().next().value!);
      }
      setLookup({
        ...state,
        phase: 'ready',
        translation,
        phonetic: savedItem?.phonetic,
        saved: Boolean(savedItem && hasSavedContext(savedItem, state.context)),
        savedItem,
      });
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setLookup({ ...state, phase: 'error', error: runtimeErrorMessage(error) });
    }
  };

  const save = async (state: LookupState) => {
    if (!state.translation || state.saved) return;
    try {
      await sendRuntime<LearningItem>({
        type: 'SAVE_BASIC_SELECTION',
        context: { ...state.context, translation: state.translation },
      });
      setLookup((current) => current?.context.requestId === state.context.requestId
        ? { ...current, saved: true }
        : current);
    } catch (error) {
      setLookup((current) => current?.context.requestId === state.context.requestId
        ? { ...current, error: runtimeErrorMessage(error) }
        : current);
    }
  };

  return (
    <Popper
      open={Boolean(lookup)}
      anchorEl={anchor || undefined}
      placement="bottom-start"
      sx={{ zIndex: (theme) => theme.zIndex.tooltip + 1 }}
      modifiers={[{ name: 'offset', options: { offset: [0, 8] } }, { name: 'preventOverflow', options: { padding: 8 } }]}
    >
      {lookup && (
        <Box data-lexi-lookup-overlay="true">
          {lookup.phase === 'action' ? (
            <Button
              variant="contained"
              size="small"
              aria-label={`释义 ${lookup.context.selectedText}`}
              onClick={() => void resolve(lookup)}
              sx={{ minWidth: 44, minHeight: 36, boxShadow: 3 }}
            >
              释
            </Button>
          ) : (
            <Paper role="dialog" aria-label={`${lookup.context.selectedText} 的释义`} variant="outlined" sx={{ p: 1.5, width: 'min(336px, calc(100vw - 16px))', maxHeight: 'min(70vh, 360px)', overflowY: 'auto', boxShadow: 4, borderColor: 'divider' }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography lang="en" sx={{ fontWeight: 650, minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                    {lookup.context.selectedText}
                  </Typography>
                  <IconButton size="small" aria-label="关闭释义" onClick={() => close(true)}><X size={17} /></IconButton>
                </Stack>
                {lookup.phonetic && <Typography lang="en" variant="caption" color="text.secondary">{lookup.phonetic}</Typography>}
                {lookup.phase === 'loading' && <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status"><CircularProgress size={16} /><Typography variant="body2">正在查询释义…</Typography></Stack>}
                {lookup.phase === 'error' && <Alert severity="warning" action={<Button size="small" onClick={() => void resolve(lookup)}>重试</Button>}>{lookup.error}</Alert>}
                {lookup.phase === 'ready' && (
                  <>
                    <Typography variant="body2">{lookup.translation}</Typography>
                    {lookup.savedItem && <SavedContextNotice key={`${lookup.context.requestId}:${lookup.savedItem.id}`} item={lookup.savedItem} context={{ ...lookup.context, translation: lookup.translation ?? '' }} onSaved={(item) => {
                      setLookup((current) => current?.context.requestId === lookup.context.requestId ? { ...current, savedItem: item, saved: true } : current);
                    }} />}
                    {lookup.error && <Alert severity="warning">{lookup.error}</Alert>}
                    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                      <SpeechButton label={`朗读词条 ${lookup.context.selectedText}`} text={lookup.context.selectedText} scope="word" />
                      {!lookup.savedItem && <Tooltip title={lookup.saved ? '已保存' : '保存到词库'}><span><IconButton aria-label={lookup.saved ? '已保存到词库' : `保存 ${lookup.context.selectedText} 到词库`} disabled={lookup.saved} sx={actionIconSx} onClick={() => void save(lookup)}>{lookup.saved ? <Check size={18} /> : <Plus size={18} />}</IconButton></span></Tooltip>}
                      {(lookup.saved || lookup.savedItem) && <Tooltip title="在词库查看"><IconButton aria-label={`在词库查看 ${lookup.context.selectedText}`} sx={actionIconSx} onClick={() => { onOpenLibrary(lookup.savedItem?.displayText ?? lookup.context.selectedText); setLookup(null); }}><BookOpen size={18} /></IconButton></Tooltip>}
                    </Stack>
                  </>
                )}
              </Stack>
            </Paper>
          )}
        </Box>
      )}
    </Popper>
  );
}
