import { describe, expect, it } from 'vitest';
import { canTransitionPicking, remainingToPick } from '../src/outbound/picking.domain.js';

describe('picking domain', () => {
  it('enforces the picking state machine', () => {
    expect(canTransitionPicking('OPEN', 'PICKING')).toBe(true);
    expect(canTransitionPicking('PICKING', 'COMPLETED')).toBe(true);
    expect(canTransitionPicking('COMPLETED', 'PICKING')).toBe(false);
  });
  it('never exposes a negative remaining quantity', () => {
    expect(remainingToPick(10, 4)).toBe(6);
    expect(remainingToPick(10, 12)).toBe(0);
  });
});
