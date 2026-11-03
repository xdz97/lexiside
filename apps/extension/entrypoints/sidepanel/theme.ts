import { createTheme, type PaletteMode } from '@mui/material/styles';
import type { AppSettings } from '@lexiside/shared';

const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif';

export const createLexiTheme = (mode: PaletteMode, uiFont: AppSettings['uiFont'] = 'system') => {
  const fontFamily = uiFont === 'inter' ? `"Inter Variable", ${SYSTEM_FONT}` : SYSTEM_FONT;

  return createTheme({
    palette: {
      mode,
      primary: { main: mode === 'light' ? '#4F46E5' : '#8B8CF8' },
      success: { main: mode === 'light' ? '#168A4B' : '#53C989' },
      error: { main: mode === 'light' ? '#C43D3D' : '#EF7777' },
      background: {
        default: mode === 'light' ? '#FFFFFF' : '#171A21',
        paper: mode === 'light' ? '#FFFFFF' : '#20242D',
      },
      text: {
        primary: mode === 'light' ? '#172033' : '#F2F4F7',
        secondary: mode === 'light' ? '#667085' : '#AAB2C0',
      },
      action: {
        selected: mode === 'light' ? 'rgba(79, 70, 229, 0.12)' : 'rgba(139, 140, 248, 0.2)',
      },
      divider: mode === 'light' ? '#E3E7EE' : '#343A46',
    },
    typography: {
      fontFamily,
      fontSize: 14,
      body1: { fontSize: 14, lineHeight: 1.6 },
      body2: { fontSize: 13, lineHeight: 1.55 },
      subtitle1: { fontSize: 15, fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiButtonBase: {
        defaultProps: { disableRipple: true },
        styleOverrides: {
          root: {
            transition: 'background-color 140ms ease, color 140ms ease, border-color 140ms ease',
            '&:focus-visible': { outline: '2px solid currentColor', outlineOffset: 2 },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { minHeight: 40, borderRadius: 6 } },
      },
      MuiIconButton: {
        styleOverrides: { root: {
          width: 40, height: 40, borderRadius: 6,
          transition: 'background-color 100ms ease, color 100ms ease, transform 100ms ease',
          '&:active:not(.Mui-disabled)': { transform: 'scale(.94)', bgcolor: 'action.selected', color: 'primary.main', boxShadow: 'inset 0 0 0 1px currentColor' },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:active:not(.Mui-disabled)': { transform: 'none' } },
        } },
      },
      MuiTab: {
        styleOverrides: { root: { minHeight: 44, minWidth: 0, padding: '8px 12px' } },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
      MuiTooltip: {
        defaultProps: { enterDelay: 500, arrow: true },
      },
    },
  });
};
