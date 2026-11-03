// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ThemeProvider } from '@mui/material';
import { AppSettingsSchema } from '@lexiside/shared';
import { SettingsView } from '../entrypoints/sidepanel/views/SettingsView';
import { createLexiTheme } from '../entrypoints/sidepanel/theme';

const runtime = vi.hoisted(() => ({ send: vi.fn(), deepseek: true, doubao: true }));
vi.mock('./runtime', () => ({ sendRuntime: runtime.send, runtimeErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));
vi.mock('./backup-directory', () => ({ getBackupDirectory: async () => undefined, saveBackupCandidate: vi.fn() }));

const settings = AppSettingsSchema.parse({ ttsProvider: 'doubao', theme: 'dark' });
const mount = (focusRequest?: { target: 'deepseek' | 'doubao'; id: number }) => render(<ThemeProvider theme={createLexiTheme('dark')}><SettingsView settings={settings} onSettingsChange={vi.fn()} focusRequest={focusRequest} /></ThemeProvider>);
beforeEach(() => {
  runtime.deepseek = true; runtime.doubao = true; runtime.send.mockReset();
  runtime.send.mockImplementation(async (request: { type: string }) => {
    switch (request.type) {
      case 'GET_DEEPSEEK_STATUS': return { configured: runtime.deepseek, model: 'deepseek-flash' };
      case 'GET_DOUBAO_STATUS': return { configured: runtime.doubao };
      case 'GET_DEEPSEEK_MODELS': return ['deepseek-flash'];
      case 'GET_TTS_VOICES': return [];
      case 'GET_SPEECH_CACHE_STATUS': return { count: 1, bytes: 1024, ttlDays: 30, expiredCount: 0, maxEntries: 100000, maxBytes: 1024 ** 3 };
      case 'GET_STORAGE_USAGE': return { totalBytes: 2048, categories: [{ id: 'library', label: '词库', count: 2, bytes: 1024 }] };
      case 'GET_LOCAL_BACKUP_STATUS': return { configured: false, busy: false };
      default: throw new Error(`Unexpected request: ${request.type}`);
    }
  });
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  vi.stubGlobal('chrome', { tabs: { query: async () => [{ url: 'https://example.test' }], onActivated: event(), onUpdated: event() } });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('settings navigation and progressive disclosure', () => {
  it('opens with four status summaries, keeping forms and destructive controls out of the overview', async () => {
    mount();
    const navigation = await screen.findByRole('navigation', { name: '设置分类' });
    await waitFor(() => expect(navigation).toHaveTextContent('DeepSeek Key 已保存'));
    expect(navigation.querySelectorAll('button')).toHaveLength(4);
    expect(screen.queryByLabelText('DeepSeek API Key')).not.toBeInTheDocument();
    expect(screen.queryByText('清除全部词库')).not.toBeInTheDocument();
    expect(runtime.send).not.toHaveBeenCalledWith({ type: 'GET_DEEPSEEK_MODELS' });
    expect(runtime.send.mock.calls.every(([request]) => !request.type.startsWith('SAVE_') && request.type !== 'UPDATE_SETTINGS')).toBe(true);
  });

  it('keeps AI disclosure independent from voice tuning and provides a clear way back', async () => {
    mount();
    await screen.findByText(/DeepSeek Key 已保存/);
    fireEvent.click(screen.getByRole('button', { name: /翻译与 AI/ }));
    expect(await screen.findByRole('heading', { name: '翻译与 AI' })).toBeInTheDocument();
    expect(screen.queryByLabelText('DeepSeek API Key')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /上下文与缓存/ }));
    expect(await screen.findByLabelText('发送的上下文')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部设置' }));
    fireEvent.click(screen.getByRole('button', { name: /^朗读/ }));
    expect(await screen.findByLabelText('豆包音色')).toBeInTheDocument();
    expect(screen.queryByLabelText('声线偏好')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('豆包语音 API Key')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '试听当前音色' })).toBeEnabled();
  });

  it('expands unconfigured Key management and keeps existing credentials management collapsed', async () => {
    runtime.deepseek = false;
    mount();
    await screen.findByText(/DeepSeek Key 未设置/);
    fireEvent.click(screen.getByRole('button', { name: /翻译与 AI/ }));
    expect(await screen.findByLabelText('DeepSeek API Key')).toBeVisible();
    expect(screen.getByRole('button', { name: /DeepSeek Key 与连接/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it.each(['deepseek', 'doubao'] as const)('routes onboarding directly to the %s Key and focuses its input', async (target) => {
    mount({ target, id: 1 });
    const input = await screen.findByLabelText(target === 'deepseek' ? 'DeepSeek API Key' : '豆包语音 API Key');
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByRole('navigation', { name: '设置分类' })).not.toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'password');
  });

  it('shows storage counts while keeping cleanup behind its own disclosure and confirmation', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /数据与隐私/ }));
    expect(await screen.findByRole('table', { name: '本机存储使用情况' })).toHaveTextContent('词库');
    expect(screen.queryByRole('button', { name: '清除全部词库' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /清理与删除/ }));
    fireEvent.click(await screen.findByRole('button', { name: '清除全部词库' }));
    expect(await screen.findByRole('dialog', { name: '清除全部词库？' })).toBeVisible();
    expect(runtime.send).not.toHaveBeenCalledWith({ type: 'CLEAR_LIBRARY' });
  });

  it('shows the default context limit and saves a valid integer once on Enter or blur', async () => {
    let finishSave!: (value: unknown) => void;
    const originalSend = runtime.send.getMockImplementation()!;
    runtime.send.mockImplementation((request) => request.type === 'UPDATE_SETTINGS'
      ? new Promise((resolve) => { finishSave = resolve; }) : originalSend(request));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /数据与隐私/ }));
    const input = await screen.findByRole('spinbutton', { name: '每个词条保留的语境数' });
    expect(input).toHaveValue(3);
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '100');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(input).toHaveAttribute('readonly');
    expect(runtime.send.mock.calls.filter(([request]) => request.type === 'UPDATE_SETTINGS')).toHaveLength(1);
    expect(runtime.send).toHaveBeenCalledWith({ type: 'UPDATE_SETTINGS', settings: { ...settings, contextHistoryLimit: 5 } });
    await act(async () => finishSave({ ...settings, contextHistoryLimit: 5 }));
    expect(input).not.toHaveAttribute('readonly');
  });

  it.each(['0', '2.5', '101', ''])('keeps invalid context limit %s out of saved settings', async (value) => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /数据与隐私/ }));
    const input = await screen.findByRole('spinbutton', { name: '每个词条保留的语境数' });
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    expect(await screen.findByText('请输入 1–100 之间的整数。')).toBeVisible();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(runtime.send.mock.calls.some(([request]) => request.type === 'UPDATE_SETTINGS')).toBe(false);
  });

  it.each([
    ['语速', '0.75×'], ['语音服务', '系统语音'], ['豆包音色', 'Tim · 美式男声（亲切自然）'],
  ])('restores focus before hiding %s while saving, without allowing another selection', async (label, choice) => {
    // happy-dom permits focusing plain divs; Chrome requires an explicit tabindex.
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options) {
      if (this.tagName === 'DIV' && !this.hasAttribute('tabindex')) return;
      focus.call(this, options);
    });
    const unsafeHidden: string[] = [];
    const setAttribute = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (this: Element, name, value) {
      if (name === 'aria-hidden' && value === 'true' && this.classList.contains('MuiMenu-root') && this.contains(document.activeElement)) unsafeHidden.push(document.activeElement!.tagName);
      setAttribute.call(this, name, value);
    });
    let finishSave!: (value: unknown) => void;
    const originalSend = runtime.send.getMockImplementation()!;
    runtime.send.mockImplementation((request) => request.type === 'UPDATE_SETTINGS'
      ? new Promise((resolve) => { finishSave = resolve; }) : originalSend(request));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^朗读/ }));
    const trigger = await screen.findByRole('combobox', { name: label });
    trigger.focus(); fireEvent.mouseDown(trigger, { button: 0 });
    const option = await screen.findByRole('option', { name: choice });
    option.focus(); fireEvent.click(option);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    expect(unsafeHidden).toEqual([]);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.mouseDown(trigger, { button: 0 });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(runtime.send.mock.calls.filter(([request]) => request.type === 'UPDATE_SETTINGS')).toHaveLength(1);
    await act(async () => finishSave(settings));
    expect(trigger).not.toHaveAttribute('aria-disabled', 'true');
    expect(trigger).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  });
});
