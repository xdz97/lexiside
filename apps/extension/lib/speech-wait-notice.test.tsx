// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SpeechWaitNotice } from '../entrypoints/sidepanel/components/SpeechWaitNotice';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('offers a dismissible suggestion without automatically changing settings or starting another request', () => {
  let listener!: (message: { type: string; count: number }) => void;
  const remove = vi.fn(); const send = vi.fn();
  vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: (value: typeof listener) => { listener = value; }, removeListener: remove }, sendMessage: send } });
  const view = render(<SpeechWaitNotice />);
  act(() => listener({ type: 'SPEECH_WAIT_TIP', count: 2 }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  act(() => listener({ type: 'SPEECH_WAIT_TIP', count: 3 }));
  expect(screen.getByRole('status')).toHaveTextContent('选择本地声线');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  act(() => listener({ type: 'SPEECH_WAIT_TIP', count: 4 }));
  expect(screen.getByRole('status')).toHaveTextContent('设置 → 朗读');
  expect(send).not.toHaveBeenCalled();
  view.unmount(); expect(remove).toHaveBeenCalledWith(listener);
});
