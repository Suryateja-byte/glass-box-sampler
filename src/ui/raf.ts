/**
 * The frame scheduler: the only code in the app that writes to hot DOM.
 *
 * Handlers never touch the DOM directly. They mark a dirty flag and return, and
 * one flush per animation frame does all the writing. That gives three things
 * the frame-time gate depends on:
 *
 *   - Several events landing in the same frame (a slider move plus a committed
 *     token) cost one write pass, not several.
 *   - Reads and writes cannot interleave, so nothing can force a synchronous
 *     layout mid-frame.
 *   - A requestAnimationFrame scheduled during input dispatch runs in that same
 *     frame, before style and paint -- so a slider drag is visible in the frame
 *     it happened in, which is the whole claim being tested.
 *
 * There is deliberately no debounce or throttle. The frame itself is the
 * throttle; adding another would introduce exactly the input lag this design
 * exists to avoid.
 */

export const Dirty = {
  Bars: 1 << 0,
  Stats: 1 << 1,
  Stream: 1 << 2,
  Trail: 1 << 3,
  Controls: 1 << 4,
  All: 0b11111,
} as const;

type Writer = { mask: number; write: () => void };

export class FrameScheduler {
  private readonly writers: Writer[] = [];
  private dirty = 0;
  private handle = 0;

  register(mask: number, write: () => void): void {
    this.writers.push({ mask, write });
  }

  mark(mask: number): void {
    this.dirty |= mask;
    if (this.handle === 0) {
      this.handle = requestAnimationFrame(this.flush);
    }
  }

  /** Forces a synchronous flush. Used at teardown and by the test hooks, never
   *  on the input path. */
  flushNow(): void {
    if (this.handle !== 0) {
      cancelAnimationFrame(this.handle);
    }
    this.flush();
  }

  private readonly flush = (): void => {
    this.handle = 0;
    const dirty = this.dirty;
    this.dirty = 0;
    if (dirty === 0) return;
    for (const writer of this.writers) {
      if ((dirty & writer.mask) !== 0) writer.write();
    }
  };
}
