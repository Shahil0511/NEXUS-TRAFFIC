/**
 * Injectable clock so services and guards are testable with a fixed "now".
 * A real port: SystemClock in production, FixedClock in tests.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  set(next: Date): void {
    this.current = next;
  }
}
