// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LibraryView } from '../entrypoints/sidepanel/views/LibraryView';
import { savedItem } from '../tests/helpers/reencounter-fixtures';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./runtime', () => ({ sendRuntime: send, runtimeErrorMessage: (error: Error) => error.message }));

beforeEach(() => {
  send.mockReset();
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    storage: { local: { getBytesInUse: async () => 0 } },
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps each saved meaning beside its own sentence and opens HTTP(S) sources in a new tab', async () => {
  send.mockResolvedValue([{ ...savedItem, occurrences: [savedItem.occurrences[0], {
    ...savedItem.occurrences[0], id: 'another', sentence: 'They leverage their experience.',
    meaningInContext: '借助经验', pageUrl: 'http://example.org/experience', pageTitle: 'Another article',
  }] }]);
  render(<LibraryView />);
  fireEvent.click((await screen.findByText('leverage')).closest('[aria-expanded]')!);
  for (const [sentence, meaning, title, url] of [
    ['We leverage existing tools.', '利用现有工具', 'Earlier article', 'https://example.com/earlier'],
    ['They leverage their experience.', '借助经验', 'Another article', 'http://example.org/experience'],
  ] as const) {
    const record = within(screen.getByText(sentence).parentElement!);
    expect(record.getByText(`当时的含义：${meaning}`)).toBeVisible();
    const link = record.getByRole('link', { name: title });
    expect(link).toHaveAttribute('href', url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
});

it('shows legacy and imported records without empty meaning labels or unsafe source links', async () => {
  send.mockResolvedValue([{ ...savedItem, occurrences: ['javascript:alert(1)', 'file:///private/data', 'invalid'].map((pageUrl, index) => ({
    ...savedItem.occurrences[0], id: String(index), sentence: `Legacy sentence ${index}`,
    meaningInContext: '', pageUrl, pageTitle: index === 0 ? '<img src=x onerror=alert(1)>' : '', siteName: '',
  })) }]);
  render(<LibraryView />);
  fireEvent.click((await screen.findByText('leverage')).closest('[aria-expanded]')!);
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.queryByText(/当时的含义：/)).not.toBeInTheDocument();
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  expect(screen.getAllByText('原网页')).toHaveLength(2);
  expect(document.querySelector('img')).toBeNull();
});

it('keeps speech separate from the accordion toggle and gives its details a unique target', async () => {
  send.mockImplementation(async (request) => request.type === 'LIST_LIBRARY' ? [savedItem] : { provider: 'system', text: 'leverage' });
  render(<LibraryView />);
  const speech = await screen.findByRole('button', { name: '朗读词条 leverage' });
  const toggle = (await screen.findByText('leverage')).closest('[aria-expanded]')!;
  expect(toggle).not.toContainElement(speech);
  expect(document.querySelector('button button')).toBeNull();
  fireEvent.click(speech);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'SPEAK', text: 'leverage' }));
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(document.querySelectorAll(`#${toggle.getAttribute('aria-controls')}`)).toHaveLength(1);
});
