import { useRef, useState } from 'react';
import { Alert, CircularProgress, IconButton, Portal, Snackbar, Tooltip, type SxProps, type Theme } from '@mui/material';
import { Volume2 } from 'lucide-react';
import type { AppSettings } from '@lexiside/shared';
import type { SpeechResult } from '../../../lib/doubao-voices';
import { runtimeErrorMessage, sendRuntime } from '../../../lib/runtime';
import { quietActionIconSx } from './actionIconStyles';

interface Props {
  text: string; context?: string; scope: AppSettings['speechScope']; label: string;
  size?: 'small' | 'medium'; iconSize?: number; sx?: SxProps<Theme>;
}
export function SpeechButton({ text, context, scope, label, size = 'medium', iconSize = 18, sx = [] }: Props) {
  const identity = JSON.stringify([text, context, scope]);
  const pending = useRef<{ identity: string; token: symbol } | null>(null);
  const [busyIdentity, setBusyIdentity] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ identity: string; message: string; severity: 'error' | 'info' } | null>(null);
  const busy = busyIdentity === identity;
  const activate = async () => {
    if (pending.current?.identity === identity) return;
    const operation = { identity, token: Symbol() };
    pending.current = operation;
    setBusyIdentity(identity); setNotice(null);
    try {
      const result = await sendRuntime<SpeechResult | { cancelled: true }>({ type: 'SPEAK', text, context, scope });
      if (pending.current === operation && !('cancelled' in result) && result.fallbackReason) {
        setNotice({ identity, message: `已改用系统语音：${result.fallbackReason}`, severity: 'info' });
      }
    } catch (error) {
      if (pending.current === operation) setNotice({ identity, message: `朗读失败：${runtimeErrorMessage(error)}`, severity: 'error' });
    } finally {
      if (pending.current === operation) { pending.current = null; setBusyIdentity(null); }
    }
  };
  return <>
    <Tooltip title={busy ? '正在准备朗读…' : label}>
      <span style={{ display: 'inline-flex' }} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
        <IconButton size={size} disabled={busy} aria-label={label} aria-busy={busy} onClick={(event) => { event.stopPropagation(); void activate(); }}
          sx={[quietActionIconSx, {
            transition: 'background-color 100ms ease, border-color 100ms ease, color 100ms ease, transform 100ms ease',
            '&:active': { transform: 'scale(0.94)', bgcolor: 'action.selected', borderColor: 'primary.main', color: 'primary.main' },
            '&.Mui-disabled': { bgcolor: 'action.selected', borderColor: 'primary.main', color: 'primary.main' },
            '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:active': { transform: 'none' } },
          }, ...(Array.isArray(sx) ? sx : [sx])]}>
          {busy ? <CircularProgress size={iconSize} thickness={3.5} color="inherit" aria-label="正在准备朗读" sx={{ '@media (prefers-reduced-motion: reduce)': { animation: 'none', '& circle': { animation: 'none' } } }} /> : <Volume2 size={iconSize} aria-hidden="true" />}
        </IconButton>
      </span>
    </Tooltip>
    <Portal><Snackbar open={notice?.identity === identity} autoHideDuration={6000} onClose={() => setNotice(null)}>
      <Alert severity={notice?.severity ?? 'error'} onClose={() => setNotice(null)} sx={{ width: '100%', overflowWrap: 'anywhere' }}>{notice?.message}</Alert>
    </Snackbar></Portal>
  </>;
}
