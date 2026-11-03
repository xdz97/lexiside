import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BookOpen, Settings2, Sparkles } from 'lucide-react';
import {
  Box,
  CssBaseline,
  CircularProgress,
  GlobalStyles,
  Tab,
  Tabs,
  ThemeProvider,
  Typography,
  useMediaQuery,
} from '@mui/material';
import type { AppSettings } from '@lexiside/shared';
import interFontUrl from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import { sendRuntime } from '../../lib/runtime';
import { createLexiTheme } from './theme';
import { FirstRunRecovery, type ApiSetupTarget } from './components/LocalBackupPanel';
import { InlineLookup } from './components/InlineLookup';
import { SpeechWaitNotice } from './components/SpeechWaitNotice';

const CurrentView = lazy(() => import('./views/CurrentView').then((module) => ({ default: module.CurrentView })));
const LibraryView = lazy(() => import('./views/LibraryView').then((module) => ({ default: module.LibraryView })));
const SettingsView = lazy(() => import('./views/SettingsView').then((module) => ({ default: module.SettingsView })));

const TAB_LABELS = ['当前', '词库', '设置'];

export default function App() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [tab, setTab] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [visited, setVisited] = useState<Set<number>>(new Set([0]));
  const [settingsFocus, setSettingsFocus] = useState<{ target: ApiSetupTarget; id: number } | null>(null);

  const switchTab = (next: number) => {
    setVisited((value) => new Set(value).add(next));
    setTab(next);
  };

  useEffect(() => {
    void sendRuntime<AppSettings>({ type: 'GET_SETTINGS' }).then(setSettings);
    const onSettingsUpdated = (message: { type?: string; settings?: AppSettings }) => {
      if (message.type === 'SETTINGS_UPDATED' && message.settings) setSettings(message.settings);
    };
    chrome.runtime.onMessage.addListener(onSettingsUpdated);
    void chrome.windows.getCurrent().then((window) => {
      if (window.id != null) return sendRuntime({ type: 'SIDE_PANEL_READY', windowId: window.id });
      return undefined;
    }).catch(() => undefined);
    return () => chrome.runtime.onMessage.removeListener(onSettingsUpdated);
  }, []);

  const mode = settings?.theme === 'dark' || (settings?.theme !== 'light' && prefersDark) ? 'dark' : 'light';
  const uiFont = settings?.uiFont ?? 'system';
  const theme = useMemo(() => createLexiTheme(mode, uiFont), [mode, uiFont]);

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyles
        styles={{
          '@font-face': {
            fontFamily: 'Inter Variable',
            fontStyle: 'normal',
            fontDisplay: 'swap',
            fontWeight: '100 900',
            src: `url(${interFontUrl}) format('woff2-variations')`,
            unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
          },
        }}
      />
      <CssBaseline />
      <SpeechWaitNotice />
      <Box sx={{ minWidth: 300, minHeight: '100vh', bgcolor: 'background.default' }}>
        <Box
          component="header"
          sx={{
            height: 52,
            px: 2,
            display: 'flex',
            alignItems: 'center',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ width: 26, height: 26, borderRadius: '7px', bgcolor: 'primary.main', color: '#fff', display: 'grid', placeItems: 'center', mr: 1.25 }} aria-hidden="true">
            <Sparkles size={15} strokeWidth={2.2} />
          </Box>
          <Typography component="h1" sx={{ fontWeight: 650, fontSize: 16, letterSpacing: '-0.01em' }}>
            拾词
          </Typography>
          <Typography sx={{ ml: 0.75, color: 'text.secondary', fontSize: 12 }}>LexiSide</Typography>
        </Box>

        <Tabs
          value={tab}
          onChange={(_, value: number) => switchTab(value)}
          variant="fullWidth"
          aria-label="拾词主要页面"
          sx={{ position: 'sticky', top: 0, zIndex: 3, bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider', minHeight: 44 }}
        >
          <Tab icon={<Sparkles size={16} />} iconPosition="start" label="当前" />
          <Tab icon={<BookOpen size={16} />} iconPosition="start" label="词库" />
          <Tab icon={<Settings2 size={16} />} iconPosition="start" label="设置" />
        </Tabs>

        {TAB_LABELS.map((label, index) => (
          <Box key={label} role="tabpanel" aria-label={label} hidden={tab !== index}>
            {visited.has(index) && <Suspense fallback={<Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} aria-label="正在加载页面" /></Box>}>
              {index === 0 && <CurrentView />}
              {index === 1 && <LibraryView initialQuery={libraryQuery} />}
              {index === 2 && settings && <SettingsView active={tab === 2} focusRequest={settingsFocus} settings={settings} onSettingsChange={setSettings} />}
            </Suspense>}
          </Box>
        ))}
        {settings && <FirstRunRecovery onOpenSettings={(target) => {
          setSettingsFocus((previous) => ({ target, id: (previous?.id ?? 0) + 1 }));
          switchTab(2);
        }} />}
        <InlineLookup mode={settings?.sidePanelSelectionMode ?? 'immediate'} onOpenLibrary={(query) => { setLibraryQuery(query); switchTab(1); }} />
      </Box>
    </ThemeProvider>
  );
}
