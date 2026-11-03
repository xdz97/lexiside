/**
 * Shadow DOM events are retargeted to the host when they cross the boundary.
 * Inspect the composed path instead of `event.target` to identify interactions
 * that started inside an injected surface.
 */
export function eventPathContains(
  event: Pick<Event, 'composedPath'>,
  ...targets: EventTarget[]
): boolean {
  const path = event.composedPath();
  return targets.some((target) => path.includes(target));
}

