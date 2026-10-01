/**
 * WHY: `sessionStorage` / `localStorage` throw in private mode, with blocked cookies, in sandboxed
 * iframes and when the quota is full — sometimes on ACCESS (`window.localStorage` itself throws).
 * This wrapper NEVER throws: on any failure it silently switches to an in-memory map, so the
 * tracker keeps working for the life of the page (ids just do not survive a reload).
 */
export class SafeStorage {
  private readonly memory = new Map<string, string>();
  private useMemory = false;

  constructor(private readonly resolve: () => Storage | undefined) {}

  /** WHY: one read path; falls back to memory forever after the first storage failure. */
  get(key: string): string | null {
    if (!this.useMemory) {
      try {
        const storage = this.resolve();
        if (storage) return storage.getItem(key);
        this.useMemory = true;
      } catch {
        this.useMemory = true;
      }
    }
    return this.memory.get(key) ?? null;
  }

  /** WHY: always mirrors into memory, so a later storage failure does not lose the current value. */
  set(key: string, value: string): void {
    this.memory.set(key, value);
    if (this.useMemory) return;
    try {
      const storage = this.resolve();
      if (storage) storage.setItem(key, value);
      else this.useMemory = true;
    } catch {
      this.useMemory = true;
    }
  }
}

/** WHY: accessing `window.sessionStorage` can itself throw, so resolve lazily inside the try. */
export function browserSessionStorage(): SafeStorage {
  return new SafeStorage(() => (typeof window === 'undefined' ? undefined : window.sessionStorage));
}

/** WHY: same as above for the per-device store. */
export function browserLocalStorage(): SafeStorage {
  return new SafeStorage(() => (typeof window === 'undefined' ? undefined : window.localStorage));
}
