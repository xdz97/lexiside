import { describe, expect, it, vi } from 'vitest';
import { InFlightByKey } from './analysis-in-flight';

describe('InFlightByKey', () => {
  it('joins an active request for the same sentence without starting another', async () => {
    const inFlight = new InFlightByKey<string>();
    let finish!: (value: string) => void;
    const request = new Promise<string>((resolve) => { finish = resolve; });
    const start = vi.fn(() => request);

    const first = inFlight.run('sentence-a', start);
    const second = inFlight.run('sentence-a', start);
    expect(first).toBe(second);
    await Promise.resolve();
    expect(start).toHaveBeenCalledOnce();

    finish('result');
    expect(await Promise.all([first, second])).toEqual(['result', 'result']);
    await Promise.resolve();
    expect(await inFlight.run('sentence-a', async () => 'next result')).toBe('next result');
  });
});
