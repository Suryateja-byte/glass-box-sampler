import type { EngineEvent, EngineListener } from './types';

/**
 * A synchronous emitter.
 *
 * Synchronous on purpose: the frame-time gate requires that moving a slider
 * repaints within one frame, and any microtask hop between an input event and
 * the render layer marking itself dirty risks pushing the paint into the frame
 * after next. Listeners here only set dirty flags -- the actual DOM writing is
 * batched by the frame scheduler -- so doing this work inline is cheap and
 * keeps the input-to-paint path a straight line.
 */
export class Emitter {
  private readonly listeners = new Set<EngineListener>();

  on(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
