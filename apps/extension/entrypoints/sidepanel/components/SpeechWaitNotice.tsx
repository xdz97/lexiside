import { useEffect, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';
import { SPEECH_WAIT_TIP_TEXT } from '../../../lib/speech-wait';

export function SpeechWaitNotice() {
  const [notice, setNotice] = useState<{ count: number } | null>(null);
  useEffect(() => {
    const listener = (message: { type?: string; count?: number }) => {
      if (message.type === 'SPEECH_WAIT_TIP' && Number.isInteger(message.count) && message.count! >= 3 && message.count! <= 5) {
        setNotice({ count: message.count! });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  return <Snackbar key={notice?.count} open={Boolean(notice)} autoHideDuration={12000} onClose={(_, reason) => { if (reason !== 'clickaway') setNotice(null); }}>
    <Alert severity="info" role="status" onClose={() => setNotice(null)} sx={{ width: '100%' }}>{SPEECH_WAIT_TIP_TEXT}</Alert>
  </Snackbar>;
}
