import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Search, Trash2, Upload, X } from 'lucide-react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Menu,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { ExportBundleSchema, type ExportBundle, type LearningItem, type LearningItemType } from '@lexiside/shared';
import { runtimeErrorMessage, sendRuntime } from '../../../lib/runtime';
import { safeSourceUrl } from '../../../lib/reencounter';
import { LearningDetails } from '../components/LearningDetails';
import { SpeechButton } from '../components/SpeechButton';

type FilterType = 'all' | LearningItemType;

function downloadText(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface LibraryViewProps {
  initialQuery?: string;
}

export function LibraryView({ initialQuery = '' }: LibraryViewProps) {
  const [items, setItems] = useState<LearningItem[]>([]);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<FilterType>('all');
  const [editing, setEditing] = useState<LearningItem | null>(null);
  const [deleting, setDeleting] = useState<LearningItem | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [dataMenu, setDataMenu] = useState<HTMLElement | null>(null);
  const [pendingBackup, setPendingBackup] = useState<ExportBundle | null>(null);
  const [importing, setImporting] = useState(false);
  const [storageNearlyFull, setStorageNearlyFull] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadId = useRef(0);

  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);

  const load = async () => {
    const request = ++loadId.current;
    setLoading(true);
    setError('');
    try {
      const result = await sendRuntime<LearningItem[]>({ type: 'LIST_LIBRARY', query: deferredQuery, itemType: filter });
      if (request === loadId.current) setItems(result);
      try {
        const bytes = await chrome.storage.local.getBytesInUse(null);
        const quota = chrome.storage.local.QUOTA_BYTES || 10 * 1024 * 1024;
        if (request === loadId.current) setStorageNearlyFull(bytes > quota * 0.8);
      } catch { /* Usage display must not block the library. */ }
    } catch (reason) {
      if (request === loadId.current) setError(runtimeErrorMessage(reason));
    } finally {
      if (request === loadId.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const onLibraryUpdated = (message: { type?: string }) => {
      if (message.type === 'LIBRARY_UPDATED') void load();
    };
    chrome.runtime.onMessage.addListener(onLibraryUpdated);
    return () => {
      chrome.runtime.onMessage.removeListener(onLibraryUpdated);
      loadId.current += 1;
    };
  }, [deferredQuery, filter]);

  const exportData = async (format: 'json' | 'csv') => {
    setDataMenu(null);
    setFeedback('');
    setError('');
    try {
      const text = await sendRuntime<string>({ type: 'EXPORT_DATA', format });
      downloadText(text, `lexiside-${new Date().toISOString().slice(0, 10)}.${format}`, format === 'json' ? 'application/json' : 'text/csv');
      setFeedback(`已导出 ${format.toUpperCase()} 文件`);
    } catch (reason) {
      setError(`导出失败：${runtimeErrorMessage(reason)}`);
    }
  };

  const importData = async (file: File) => {
    setFeedback('');
    setError('');
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (Array.isArray(parsed)) {
        const count = await sendRuntime<number>({ type: 'IMPORT_DATA', items: parsed as LearningItem[] });
        await load();
        setFeedback(`已导入旧版词条列表，共 ${count} 条；此文件不含历史与设置`);
      } else {
        setPendingBackup(ExportBundleSchema.parse(parsed));
      }
    } catch (reason) {
      setError(`导入失败：${runtimeErrorMessage(reason)}`);
    }
  };

  const restoreBackup = async (mode: 'merge' | 'replace') => {
    if (!pendingBackup || importing) return;
    setImporting(true);
    setError('');
    try {
      const count = await sendRuntime<number>({ type: 'IMPORT_BACKUP', bundle: pendingBackup, mode });
      setPendingBackup(null);
      await load();
      setFeedback(mode === 'replace' ? `已完整恢复 ${count} 条词条、历史与设置` : `已合并 ${count} 条词条及备份中的历史；当前设置保持不变`);
    } catch (reason) {
      setError(`导入失败：${runtimeErrorMessage(reason)}`);
    } finally {
      setImporting(false);
    }
  };

  const thisWeek = items.filter((item) => Date.now() - new Date(item.createdAt).getTime() < 7 * 86_400_000).length;
  const learning = items.filter((item) => item.status !== 'mastered').length;

  return (
    <Stack spacing={1.5} sx={{ p: 2, pb: 4 }}>
      <TextField
        fullWidth
        size="small"
        label="搜索词库"
        placeholder="单词、表达、笔记或来源"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search size={17} /></InputAdornment>, endAdornment: query && <InputAdornment position="end"><IconButton size="small" aria-label="清除搜索" onClick={() => setQuery('')}><X size={16} /></IconButton></InputAdornment> } }}
      />
      <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap' }}>
        {([['all', '全部'], ['word', '单词'], ['phrase', '表达'], ['pattern', '用法']] as const).map(([value, label]) => (
          <Chip key={value} label={label} size="small" clickable color={filter === value ? 'primary' : 'default'} variant={filter === value ? 'filled' : 'outlined'} onClick={() => setFilter(value)} />
        ))}
      </Stack>
      <Stack direction="row" sx={{ py: 0.75, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2"><strong>{items.length}</strong> 条{query || filter !== 'all' ? '匹配' : '词条'}</Typography>
        <Typography variant="body2" color="text.secondary">本周新增 {thisWeek}</Typography>
        <Typography variant="body2" color="text.secondary">学习中 {learning}</Typography>
      </Stack>
      <Stack direction="row" spacing={1}>
        <Button variant="text" size="small" startIcon={<Download size={15} />} onClick={(event) => setDataMenu(event.currentTarget)}>导入 / 导出</Button>
        <Menu anchorEl={dataMenu} open={Boolean(dataMenu)} onClose={() => setDataMenu(null)}>
          <MenuItem onClick={() => { setDataMenu(null); inputRef.current?.click(); }}><Upload size={16} style={{ marginRight: 8 }} />从 JSON 备份导入</MenuItem>
          <MenuItem onClick={() => void exportData('json')}>导出 JSON 备份</MenuItem>
          <MenuItem onClick={() => void exportData('csv')}>导出 CSV 表格</MenuItem>
        </Menu>
        <input ref={inputRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importData(file); event.target.value = ''; }} />
      </Stack>
      {error && <Typography color="error" variant="body2" role="alert">{error}</Typography>}
      {feedback && <Typography color="success.main" variant="body2" role="status">{feedback}</Typography>}
      {storageNearlyFull && <Alert severity="warning">本地存储接近上限。请先导出 JSON 备份，再整理词库或清除查询历史。</Alert>}

      {loading ? (
        <Typography variant="body2" color="text.secondary" role="status" sx={{ py: 5, textAlign: 'center' }}>正在加载词库…</Typography>
      ) : error ? null : items.length === 0 ? (
        <Box sx={{ py: 7, textAlign: 'center' }}>
          <Typography variant="subtitle1">{query || filter !== 'all' ? '没有匹配的词条' : '词库还是空的'}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{query || filter !== 'all' ? '试试其他关键词或筛选条件。' : '从网页翻译结果或“当前”页保存内容。'}</Typography>
        </Box>
      ) : (
        <Stack spacing={0.75}>
          {items.map((item) => {
            const latestOccurrence = item.occurrences.at(-1);
            const hasDetails = Boolean(item.definitionEn || item.collocations.length || item.usage || latestOccurrence?.meaningInContext);
            const category = item.type === 'word' ? '单词' : item.type === 'phrase' ? '表达' : '句型';
            return (
            <Accordion key={item.id} variant="outlined" disableGutters slotProps={{ transition: { unmountOnExit: true } }} sx={{ '&::before': { display: 'none' } }}>
              <Box id={`library-summary-${item.id}`} aria-controls={`library-details-${item.id}`} sx={{ display: 'flex', alignItems: 'center' }}>
                <AccordionSummary
                  expandIcon={<ChevronDown size={18} />}
                  aria-controls={`library-details-${item.id}`}
                  id={`library-toggle-${item.id}`}
                  sx={{ flex: 1, minWidth: 0 }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                      <Typography lang="en" sx={{ fontWeight: 650, overflowWrap: 'anywhere', flexBasis: '100%' }}>{item.displayText}</Typography>
                      <Chip label={category} size="small" variant="outlined" sx={{ height: 22 }} />
                      {item.partOfSpeech && <Chip label={item.partOfSpeech} size="small" sx={{ height: 22 }} />}
                      {item.phonetic && <Typography lang="en" variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{item.phonetic}</Typography>}
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>{item.meaningZh}</Typography>
                    {hasDetails && (
                      <Typography variant="caption" color="primary.main">
                        {item.type === 'word' ? '查看释义与搭配' : item.type === 'phrase' ? '查看用法说明' : '查看详情'}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{item.occurrenceCount} 个语境 · {new Date(item.updatedAt).toLocaleDateString()}</Typography>
                  </Box>
                </AccordionSummary>
                <Box sx={{ mr: 1, display: 'inline-flex', flexShrink: 0 }}><SpeechButton size="small" label={`朗读词条 ${item.displayText}`} text={item.displayText} scope="word" /></Box>
              </Box>
              <AccordionDetails sx={{ pt: 0 }} data-lexi-source-url={latestOccurrence?.pageUrl} data-lexi-source-title={latestOccurrence?.pageTitle} data-lexi-source-site={latestOccurrence?.siteName}>
                {hasDetails && (
                  <Box sx={{ pb: 1.25 }}>
                    <LearningDetails
                      definitionEn={item.definitionEn}
                      meaningInContext={item.type === 'word' ? latestOccurrence?.meaningInContext : undefined}
                      collocations={item.collocations}
                      usage={item.type === 'phrase' ? item.usage || latestOccurrence?.meaningInContext : undefined}
                    />
                  </Box>
                )}
                {item.occurrences.length > 0 && <Typography variant="caption" color="text.secondary">语境记录</Typography>}
                {item.occurrences.map((occurrence) => {
                  const source = safeSourceUrl(occurrence.pageUrl);
                  const sourceLabel = occurrence.pageTitle || occurrence.siteName || '原网页';
                  return <Box key={occurrence.id} sx={{ py: 1, borderTop: 1, borderColor: 'divider', overflowWrap: 'anywhere' }}>
                    <Typography lang="en" variant="body2" tabIndex={-1} data-lexi-lookup-text="sentence" data-lexi-lookup-origin={occurrence.lookupOrigin} data-lexi-source-url={occurrence.pageUrl} data-lexi-source-title={occurrence.pageTitle} data-lexi-source-site={occurrence.siteName} sx={{ userSelect: 'text' }}>{occurrence.sentence}</Typography>
                    {occurrence.meaningInContext && <Typography variant="body2" color="text.secondary">当时的含义：{occurrence.meaningInContext}</Typography>}
                    <Typography variant="caption" color="text.secondary">
                      {occurrence.lookupOrigin === 'definition' ? '从释义查词 · ' : ''}
                      {source ? <Box component="a" href={source} target="_blank" rel="noopener noreferrer" sx={{ color: 'primary.main', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>{sourceLabel}</Box> : sourceLabel}
                    </Typography>
                  </Box>;
                })}
                <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'flex-end' }}>
                  <Button size="small" onClick={() => { setError(''); setEditing(item); }}>编辑</Button>
                  <Button size="small" color="error" startIcon={<Trash2 size={15} />} onClick={() => { setError(''); setDeleting(item); }}>删除</Button>
                </Stack>
              </AccordionDetails>
            </Accordion>
            );
          })}
        </Stack>
      )}

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} fullWidth maxWidth="xs">
        <DialogTitle>编辑词条</DialogTitle>
        {editing && (
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {error && <Typography color="error" variant="body2" role="alert">{error}</Typography>}
              <TextField label="中文含义" value={editing.meaningZh} onChange={(event) => setEditing({ ...editing, meaningZh: event.target.value })} />
              <TextField label="个人笔记" multiline minRows={3} value={editing.note} onChange={(event) => setEditing({ ...editing, note: event.target.value })} />
              <TextField select label="学习状态" value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as LearningItem['status'] })}>
                <MenuItem value="new">新加入</MenuItem>
                <MenuItem value="learning">学习中</MenuItem>
                <MenuItem value="mastered">已掌握</MenuItem>
              </TextField>
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setEditing(null)}>取消</Button>
          <Button variant="contained" onClick={async () => { if (!editing) return; try { await sendRuntime({ type: 'UPDATE_ITEM', item: editing }); setEditing(null); await load(); } catch (reason) { setError(runtimeErrorMessage(reason)); } }}>保存</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)}>
        <DialogTitle>删除“{deleting?.displayText}”？</DialogTitle>
        <DialogContent><Typography variant="body2">词条及其全部语境会从本机删除，此操作无法恢复。</Typography>{error && <Typography color="error" variant="body2" role="alert">{error}</Typography>}</DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>取消</Button>
          <Button color="error" variant="contained" onClick={async () => { if (!deleting) return; try { await sendRuntime({ type: 'DELETE_ITEM', itemId: deleting.id }); setDeleting(null); await load(); } catch (reason) { setError(runtimeErrorMessage(reason)); } }}>删除</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(pendingBackup)} onClose={() => { if (!importing) setPendingBackup(null); }} fullWidth maxWidth="xs">
        <DialogTitle>导入 JSON 备份</DialogTitle>
        <DialogContent>
          <Typography variant="body2">备份包含 {pendingBackup?.items.length ?? 0} 条词条、{pendingBackup?.history.length ?? 0} 条查询历史和设置。</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>合并会保留当前设置；完整恢复会替换当前词库、历史与设置。操作前建议先导出一份当前备份。</Typography>
          {error && <Typography variant="body2" color="error" role="alert" sx={{ mt: 1 }}>{error}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button disabled={importing} onClick={() => setPendingBackup(null)}>取消</Button>
          <Button disabled={importing} onClick={() => void restoreBackup('merge')}>合并</Button>
          <Button disabled={importing} color="warning" onClick={() => void restoreBackup('replace')}>完整恢复</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
