// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Button, FormControl, InputLabel, Menu, MenuItem, Select, ThemeProvider } from '@mui/material';
import { createLexiTheme } from '../entrypoints/sidepanel/theme';

let hiddenWithFocus: string[];
beforeEach(() => {
  hiddenWithFocus = [];
  const setAttribute = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (this: Element, name: string, value: string) {
    if (name === 'aria-hidden' && value === 'true' && this.classList.contains('MuiMenu-root') && this.contains(this.ownerDocument.activeElement)) hiddenWithFocus.push(this.ownerDocument.activeElement!.tagName);
    return setAttribute.call(this, name, value);
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, width: 160, height: 40, right: 160, bottom: 40, toJSON: () => ({}) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function SelectExample() {
  const [value, setValue] = useState('one');
  return <ThemeProvider theme={createLexiTheme('light')}><FormControl>
    <InputLabel id="choice-label">选择</InputLabel>
    <Select labelId="choice-label" label="选择" value={value} onChange={(event) => setValue(event.target.value)}>
      <MenuItem value="one">第一项</MenuItem><MenuItem value="two">第二项</MenuItem>
    </Select>
  </FormControl></ThemeProvider>;
}

it.each(['select', 'escape', 'backdrop', 'tab'])('keeps focus outside the hidden menu when closing by %s', async (method) => {
  render(<SelectExample />);
  const trigger = screen.getByRole('combobox', { name: '选择' });
  trigger.focus(); fireEvent.mouseDown(trigger, { button: 0 });
  const first = await screen.findByRole('option', { name: '第一项' });
  first.focus();
  if (method === 'select') fireEvent.click(screen.getByRole('option', { name: '第二项' }));
  if (method === 'escape') fireEvent.keyDown(first, { key: 'Escape' });
  if (method === 'tab') fireEvent.keyDown(first, { key: 'Tab' });
  if (method === 'backdrop') fireEvent.click(document.querySelector('.MuiBackdrop-root')!);
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(hiddenWithFocus).toEqual([]);
});

function MenuExample() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <ThemeProvider theme={createLexiTheme('light')}>
    <Button onClick={(event) => setAnchor(event.currentTarget)}>导入 / 导出</Button>
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
      <MenuItem onClick={() => setAnchor(null)}>导出 JSON 备份</MenuItem>
    </Menu>
  </ThemeProvider>;
}
it('returns focus to the library menu trigger after a menu action', async () => {
  render(<MenuExample />);
  const trigger = screen.getByRole('button', { name: '导入 / 导出' });
  trigger.focus(); fireEvent.click(trigger);
  const item = await screen.findByRole('menuitem'); item.focus(); fireEvent.click(item);
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(hiddenWithFocus).toEqual([]);
});
