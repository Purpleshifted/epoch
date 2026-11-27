/**
 * lifeEvents.ts — the record's lines, as they appear on the screen, offered to whoever listens (the life's recording
 * takes them as markers: useLifeRecording). One function to call where a line is made (SessionHud), one to listen;
 * no React, no state kept — a line that nobody listens to is simply gone.
 */

export interface LifeEvent {
  /** witness.ts LogKey, or a phase of the life ("life.begin", "ended"). */
  kind: string;
  /** The line as the screen said it (the melody's place marked `♪`). */
  text: string;
  /** witness.ts LogLevel (0 fact · 1 notable · 2 important). */
  level: number;
  /** Session seconds the line carries (the life's clock), where it has one. */
  lifeT?: number;
  /** The id of whom the line is about (its `{}`), where it names someone: who asked, whom I answered. */
  who?: string;
  /** The ids of those the line gathers (a story's voices), and its count (the voices; the bond's conversations). */
  with?: string[];
  n?: number;
}

const listeners = new Set<(e: LifeEvent) => void>();

export function emitLifeEvent(e: LifeEvent): void {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch {
      /* a listener's trouble is its own */
    }
  }
}

export function onLifeEvent(fn: (e: LifeEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
