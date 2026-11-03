import { useRef, useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { hasSavedContext, previousSavedOccurrence, type LearningItem, type SelectionContext } from '@lexiside/shared';
import { safeSourceUrl } from '../../../lib/reencounter';
import { runtimeErrorMessage, sendRuntime } from '../../../lib/runtime';

export function SavedContextNotice({ item, context, onSaved }: {
  item: LearningItem;
  context: SelectionContext;
  onSaved?: (item: LearningItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [meaning, setMeaning] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const noticeRef = useRef<HTMLElement>(null);
  const occurrence = previousSavedOccurrence(item, context);
  const saved = hasSavedContext(item, context);
  const source = occurrence && safeSourceUrl(occurrence.pageUrl);

  const save = async () => {
    if (saving || saved || !meaning.trim()) return;
    setSaving(true);
    setError('');
    try {
      const result = await sendRuntime<LearningItem>({
        type: 'APPEND_SAVED_CONTEXT', itemId: item.id, context: { ...context, translation: meaning.trim() },
      });
      onSaved?.(result);
      setEditing(false);
      noticeRef.current?.focus({ preventScroll: true });
    } catch (reason) {
      setError(runtimeErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="aside" ref={noticeRef} tabIndex={-1} aria-label={`已收藏的 ${item.displayText}`} sx={{ p: 1.25, bgcolor: 'action.hover', borderRadius: 1, minWidth: 0, overflowWrap: 'anywhere', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>
      <Stack spacing={0.75}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>你曾收藏过 {item.displayText}{item.partOfSpeech ? ` · ${item.partOfSpeech}` : ''}</Typography>
        {occurrence && <>
          <Typography variant="body2" lang="en" sx={{ userSelect: 'text' }}>{occurrence.sentence}</Typography>
          {occurrence.meaningInContext && <Typography variant="body2" color="text.secondary">当时的含义：{occurrence.meaningInContext}</Typography>}
          <Typography variant="caption" color="text.secondary">
            {source ? <Box component="a" href={source} target="_blank" rel="noopener noreferrer" sx={{ color: 'primary.main' }}>{occurrence.pageTitle || occurrence.siteName || '原网页'}</Box> : occurrence.pageTitle || occurrence.siteName || '原网页'}
            {' · '}{new Date(occurrence.capturedAt).toLocaleDateString()}{' · '}{item.occurrenceCount} 个语境
          </Typography>
        </>}
        {onSaved && (saved ? <Typography variant="caption" color="text.secondary" role="status">当前语境已保存</Typography> : editing ? (
          <Box component="form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <TextField autoFocus fullWidth size="small" label="确认当前语境的含义" value={meaning} disabled={saving} onChange={(event) => setMeaning(event.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
            <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
              <Button type="submit" size="small" disabled={saving || !meaning.trim()} aria-busy={saving}>{saving ? '正在保存…' : '确认保存'}</Button>
              <Button size="small" color="inherit" disabled={saving} onClick={() => setEditing(false)}>取消</Button>
            </Stack>
          </Box>
        ) : <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => { setMeaning(context.translation.slice(0, 500)); setEditing(true); }}>保存当前语境</Button>)}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Box>
  );
}
