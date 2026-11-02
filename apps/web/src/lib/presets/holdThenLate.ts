/**
 * Waits for `work` at most `holdMs`. In time: resolves with its value. Too slow: resolves with `fallback` so the caller
 * can go on, and `work` keeps running; when it finishes, `onLate` gets the value it would have returned. A failure
 * counts as `fallback` in time, and as nothing at all once late.
 */
export function holdThenLate<T>(work: Promise<T>, holdMs: number, fallback: T, onLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve) => {
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      resolve(fallback);
    }, holdMs);
    work.then(
      (value) => {
        if (late) {
          onLate?.(value);
          return;
        }
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (late) return;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
