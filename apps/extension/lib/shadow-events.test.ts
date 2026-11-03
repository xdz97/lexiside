import { describe, expect, it } from 'vitest';
import { eventPathContains } from './shadow-events';

describe('eventPathContains', () => {
  it('recognizes an event that originated inside a shadow surface after retargeting', () => {
    const button = {} as EventTarget;
    const shadowRoot = {} as EventTarget;
    const host = {} as EventTarget;
    const documentTarget = {} as EventTarget;
    const event = {
      composedPath: () => [button, shadowRoot, host, documentTarget],
    };

    expect(eventPathContains(event, host, shadowRoot)).toBe(true);
  });

  it('rejects an event that originated on the host page', () => {
    const host = {} as EventTarget;
    const pageElement = {} as EventTarget;
    const event = { composedPath: () => [pageElement] };

    expect(eventPathContains(event, host)).toBe(false);
  });
});

