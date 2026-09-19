import { describe, expect, it } from 'vitest';
import { retryDelaySeconds, shouldDeadLetter } from '../src/outbox/outbox.domain.js';

describe('outbox retry policy', () => {
  it('backs off exponentially and caps at five minutes', () => {
    expect(retryDelaySeconds(1)).toBe(2);
    expect(retryDelaySeconds(5)).toBe(32);
    expect(retryDelaySeconds(20)).toBe(300);
  });

  it('dead-letters after ten failed deliveries', () => {
    expect(shouldDeadLetter(9)).toBe(false);
    expect(shouldDeadLetter(10)).toBe(true);
  });
});
