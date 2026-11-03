let handler: (() => void) | undefined;
export function onLocalDataChanged(callback: () => void): void { handler = callback; }
export function localDataChanged(): void { handler?.(); }
