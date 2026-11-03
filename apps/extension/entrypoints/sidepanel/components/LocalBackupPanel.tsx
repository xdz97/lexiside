import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography } from '@mui/material';
import { FolderOpen } from 'lucide-react';
import { getBackupDirectory, saveBackupCandidate } from '../../../lib/backup-directory';
import type { LocalBackupStatus } from '../../../lib/local-backup';
import type { DeepSeekStatus } from '../../../lib/deepseek';
import type { DoubaoStatus } from '../../../lib/doubao-voices';
import { runtimeErrorMessage, sendRuntime } from '../../../lib/runtime';
import { SettingsDisclosure } from './SettingsLayout';

interface Props { active?: boolean; compact?: boolean; onChanged?: () => void; onConnected?: () => void }
export function LocalBackupPanel({ active = true, compact = false, onChanged, onConnected }: Props) {
  const [status, setStatus] = useState<LocalBackupStatus | null>(null);
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const refresh = async () => {
    try {
      const [next, handle] = await Promise.all([
        sendRuntime<LocalBackupStatus>({ type: 'GET_LOCAL_BACKUP_STATUS' }), getBackupDirectory(),
      ]);
      setStatus(next); setDirectory(handle);
    }
    catch (reason) { setError(runtimeErrorMessage(reason)); }
  };
  useEffect(() => { if (active) void refresh(); }, [active]);
  useEffect(() => {
    if (!active || !status?.busy) return;
    const timer = setTimeout(() => { void refresh(); }, 1000);
    return () => clearTimeout(timer);
  }, [active, status]);
  useEffect(() => {
    if (!active) return;
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [active]);

  const authorize = async () => {
    setError(''); setMessage(''); setBusy(true);
    try {
      if (!directory) throw new Error('未能读取已保存的目录，请重新选择原目录。');
      // The saved handle is already loaded. Request directly from this click,
      // before any asynchronous lookup can consume transient user activation.
      const permission = await directory.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') return;
      setStatus(await sendRuntime<LocalBackupStatus>({ type: 'RUN_LOCAL_BACKUP' }));
      setMessage('目录已重新授权，并已更新备份。');
      onChanged?.();
    } catch (reason) { setError(runtimeErrorMessage(reason)); }
    finally { setBusy(false); void refresh(); }
  };

  const choose = async () => {
    setError(''); setMessage(''); setBusy(true);
    try {
      if (!window.showDirectoryPicker) throw new Error('当前浏览器不支持目录备份，请使用 Chrome，或在词库页面导出 JSON 备份。');
      // Keep the picker directly in the click handler so user activation is retained.
      const directory = await window.showDirectoryPicker({ id: 'lexiside-data', mode: 'readwrite', startIn: 'documents' });
      let restore = false;
      try { await directory.getFileHandle('lexiside-backup.json'); restore = true; }
      catch (reason) { if (!(reason instanceof Error && reason.name === 'NotFoundError')) throw reason; }
      await saveBackupCandidate(directory);
      const result = await sendRuntime<{ restoredWords: number; restoredAudio: number; skippedAudio: number }>({ type: 'CONNECT_LOCAL_BACKUP', restore });
      // Finish the first snapshot before reporting success, including for a new folder.
      await sendRuntime({ type: 'RUN_LOCAL_BACKUP' });
      setMessage(restore ? `已恢复并连接目录：词条 ${result.restoredWords} 条、音频 ${result.restoredAudio} 条${result.skippedAudio ? `，跳过 ${result.skippedAudio} 条过期或缺失音频` : ''}。` : '已连接目录并完成首次备份。');
      onChanged?.(); onConnected?.();
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === 'AbortError')) setError(runtimeErrorMessage(reason));
    } finally { setBusy(false); void refresh(); }
  };
  const operate = async (type: 'RUN_LOCAL_BACKUP' | 'DISCONNECT_LOCAL_BACKUP' | 'DELETE_LOCAL_BACKUP') => {
    setBusy(true); setError(''); setMessage('');
    try {
      setStatus(await sendRuntime<LocalBackupStatus>({ type }));
      setDeleteOpen(false);
      setMessage(type === 'RUN_LOCAL_BACKUP' ? '本机目录备份已更新。' : type === 'DELETE_LOCAL_BACKUP' ? '已删除目录中的拾词备份，并停止备份。' : '已停止备份，目录中的文件已保留。');
      onChanged?.();
    } catch (reason) { setError(runtimeErrorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <Stack spacing={1.25}>
    <Typography variant="body2">{compact ? '选择原目录恢复数据，或选择空目录开始自动备份。' : '选择本机目录后，词库、历史、设置和有效音频会在数据变化后自动备份。API Key 不写入备份。'}</Typography>
    <Typography variant="caption" color="text.secondary">{status?.configured ? `目录：${status.directoryName} · ${status.lastBackupAt ? `上次备份 ${new Date(status.lastBackupAt).toLocaleString()}` : '尚未完成备份'}` : '尚未选择备份目录'}</Typography>
    {status?.configured && status.permission !== 'granted' && !error && !status.error && <Alert severity={status.permission === 'denied' ? 'warning' : 'info'}>
      {status.permission === 'denied'
        ? 'Chrome 当前未允许访问此目录。可点击“重新授权”；若仍被拒绝，请重新选择原目录并允许读写。'
        : '目录已记住，Chrome 需要再次确认读写权限。点击“重新授权”即可继续备份，当前扩展内的数据不受影响。'}
    </Alert>}
    {(error || status?.error) && <Alert severity="error">{error || status?.error}</Alert>}
    {message && <Alert severity="success" role="status">{message}</Alert>}
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {status?.configured && status.permission !== 'granted' && <Button variant="contained" disabled={busy || status.busy || !directory} onClick={() => void authorize()}>重新授权</Button>}
      <Button variant="outlined" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <FolderOpen size={16} />} disabled={busy || status?.busy} onClick={() => void choose()}>{busy ? '正在处理…' : status?.configured ? '重新选择目录' : '选择数据目录'}</Button>
      {status?.configured && !compact && <>
        <Button disabled={busy || status.busy || status.permission !== 'granted'} onClick={() => void operate('RUN_LOCAL_BACKUP')}>立即备份</Button>
      </>}
    </Stack>
    {!compact && <SettingsDisclosure id="backup-management" title="备份管理与卸载说明" summary="保留文件、停止备份或删除目录备份">
      <Typography variant="caption" color="text.secondary">卸载前可点“立即备份”保留数据，或先删除目录备份再卸载。重装后首次打开只提示一次，选择原目录即可检测并恢复；Chrome 需要你重新授权，无法自动扫描本机目录。词库 JSON 导出仍可单独使用。</Typography>
      {status?.configured && <Stack spacing={1}>
        <Button variant="outlined" disabled={busy || status.busy} onClick={() => void operate('DISCONNECT_LOCAL_BACKUP')}>停止备份，保留文件</Button>
        <Button color="error" disabled={busy || status.busy || status.permission !== 'granted'} onClick={() => setDeleteOpen(true)}>删除目录备份</Button>
      </Stack>}
    </SettingsDisclosure>}
    <Dialog open={deleteOpen} onClose={() => { if (!busy) setDeleteOpen(false); }}>
      <DialogTitle>删除目录中的拾词备份？</DialogTitle>
      <DialogContent><Typography variant="body2">将删除“{status?.directoryName}”中拾词的备份索引及其记录的音频，并停止备份。此操作无法撤销。扩展内当前数据和目录内其他文件会保留。</Typography></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setDeleteOpen(false)}>取消</Button><Button color="error" disabled={busy} onClick={() => void operate('DELETE_LOCAL_BACKUP')}>确认删除备份</Button></DialogActions>
    </Dialog>
  </Stack>;
}

export type ApiSetupTarget = 'deepseek' | 'doubao';
type KeyState = 'checking' | 'configured' | 'missing' | 'error';
const keyLabels: Record<KeyState, string> = { checking: '正在检查…', configured: '已设置', missing: '未设置', error: '读取失败' };

export function FirstRunRecovery({ onOpenSettings }: { onOpenSettings: (target: ApiSetupTarget) => void }) {
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState<Record<ApiSetupTarget, KeyState>>({ deepseek: 'checking', doubao: 'checking' });
  const refreshKeys = async () => {
    setKeys({ deepseek: 'checking', doubao: 'checking' });
    const [deepseek, doubao] = await Promise.allSettled([
      sendRuntime<DeepSeekStatus>({ type: 'GET_DEEPSEEK_STATUS' }),
      sendRuntime<DoubaoStatus>({ type: 'GET_DOUBAO_STATUS' }),
    ]);
    const state = (result: PromiseSettledResult<{ configured: boolean }>): KeyState =>
      result.status === 'rejected' ? 'error' : result.value.configured ? 'configured' : 'missing';
    setKeys({ deepseek: state(deepseek), doubao: state(doubao) });
  };
  useEffect(() => { void sendRuntime<boolean>({ type: 'CLAIM_RECOVERY_PROMPT' }).then(setOpen).catch(() => undefined); }, []);
  useEffect(() => { if (open) void refreshKeys(); }, [open]);
  const navigate = (target: ApiSetupTarget) => { setOpen(false); onOpenSettings(target); };
  const configured = keys.deepseek === 'configured' && keys.doubao === 'configured';
  return <Dialog open={open} onClose={() => setOpen(false)} disableRestoreFocus fullWidth maxWidth="sm" aria-labelledby="first-run-title">
    <DialogTitle id="first-run-title">开始使用拾词</DialogTitle>
    <DialogContent><Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">恢复已有数据，或完成下面的基础设置。这条引导只出现一次，都可以稍后在设置中完成。</Typography>
      <Box component="section" aria-labelledby="first-run-backup"><Stack spacing={1}>
        <Typography id="first-run-backup" variant="subtitle1">本机数据目录 · 可选</Typography>
        <LocalBackupPanel active={open} compact onConnected={() => void refreshKeys()} />
      </Stack></Box>
      <Divider />
      <Box component="section" aria-labelledby="first-run-keys"><Stack spacing={1.5}>
        <Typography id="first-run-keys" variant="subtitle1">API Key</Typography>
        {(['deepseek', 'doubao'] as const).map((target) => <Stack key={target} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{target === 'deepseek' ? 'DeepSeek' : '豆包语音 · 可选'}</Typography>
            <Typography variant="caption" color="text.secondary">{target === 'deepseek' ? '用于学习分析和翻译回退。' : '用于 AI 朗读；未设置时可用系统语音。'}</Typography>
            <Typography variant="caption" component="div" role="status" color={keys[target] === 'configured' ? 'success.main' : keys[target] === 'error' ? 'error.main' : 'text.secondary'}>{keyLabels[keys[target]]}</Typography>
          </Box>
          {(keys[target] === 'missing' || keys[target] === 'error') && <Button size="small" variant="outlined" sx={{ flexShrink: 0 }} onClick={() => navigate(target)} aria-label={`设置${target === 'deepseek' ? ' DeepSeek' : '豆包语音'} API Key`}>去设置</Button>}
          {keys[target] === 'checking' && <CircularProgress size={16} aria-label={`正在检查${target === 'deepseek' ? ' DeepSeek' : '豆包语音'} Key`} />}
        </Stack>)}
        {(keys.deepseek === 'error' || keys.doubao === 'error') && <Stack spacing={0.5}>
          <Typography variant="caption" color="error.main">部分配置未能读取，可以重试或前往设置查看。</Typography>
          <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => void refreshKeys()}>重新检测</Button>
        </Stack>}
        <Typography variant="caption" color="text.secondary">API Key 不包含在备份中，重装恢复后需重新填写。这里只检查是否已保存，不会调用收费服务。</Typography>
      </Stack></Box>
    </Stack></DialogContent>
    <DialogActions><Button onClick={() => setOpen(false)}>{configured ? '开始使用' : '稍后设置'}</Button></DialogActions>
  </Dialog>;
}
