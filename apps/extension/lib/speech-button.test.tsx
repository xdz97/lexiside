// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SpeechButton } from '../entrypoints/sidepanel/components/SpeechButton';
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./runtime', () => ({ sendRuntime: send, runtimeErrorMessage: (error: Error) => error.message }));
beforeEach(() => { send.mockReset(); });
afterEach(cleanup);

describe('speech button request feedback', () => {
  it('shows a fixed-size spinner immediately, prevents repeated clicks, and unlocks once playback starts', async () => {
    let resolve!: (result: unknown) => void;
    send.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<SpeechButton label="朗读原句" text="Hello world." scope="sentence" />);
    const button = screen.getByRole('button', { name: '朗读原句' });
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(button);
    expect(button).toBeDisabled(); expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar', { name: '正在准备朗读' })).toBeVisible();
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ provider: 'doubao', voiceName: 'test', text: 'Hello world.' }));
    expect(button).toBeEnabled(); expect(button).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.click(button); expect(send).toHaveBeenCalledTimes(2);
    await act(async () => resolve({ cancelled: true }));
  });

  it('reports failure, enables retry, and does not trigger the surrounding accordion action', async () => {
    send.mockRejectedValue(new Error('播放器不可用'));
    const parent = vi.fn();
    render(<div onClick={parent}><SpeechButton label="朗读词条 hello" text="hello" scope="word" /></div>);
    fireEvent.click(screen.getByRole('button', { name: '朗读词条 hello' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('朗读失败：播放器不可用');
    expect(screen.getByRole('button', { name: '朗读词条 hello' })).toBeEnabled();
    expect(parent).not.toHaveBeenCalled();
  });

  it('does not let a stale result clear the loading state for newly selected text', async () => {
    const completions: Array<(result: unknown) => void> = [];
    send.mockImplementation(() => new Promise((done) => completions.push(done)));
    const view = render(<SpeechButton label="朗读原句" text="old" scope="sentence" />);
    fireEvent.click(screen.getByRole('button', { name: '朗读原句' }));
    view.rerender(<SpeechButton label="朗读原句" text="new" scope="sentence" />);
    expect(screen.getByRole('button', { name: '朗读原句' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '朗读原句' }));
    await act(async () => completions[0]!({ cancelled: true }));
    expect(screen.getByRole('button', { name: '朗读原句' })).toBeDisabled();
    await act(async () => completions[1]!({ provider: 'doubao', text: 'new' }));
    expect(screen.getByRole('button', { name: '朗读原句' })).toBeEnabled();
  });

  it('shows the real fallback result without leaving the button stuck', async () => {
    send.mockResolvedValue({ provider: 'system', text: 'hello', fallbackReason: '网络不可用' });
    render(<SpeechButton label="朗读词条 hello" text="hello" scope="word" />);
    fireEvent.click(screen.getByRole('button', { name: '朗读词条 hello' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('已改用系统语音：网络不可用');
    await waitFor(() => expect(screen.getByRole('button', { name: '朗读词条 hello' })).toBeEnabled());
  });
});
