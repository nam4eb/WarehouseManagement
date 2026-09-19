import { describe, expect, it } from 'vitest';
import { canTransitionTrip, remainingQuantity } from '../src/delivery/trip.domain.js';

describe('trip lifecycle', () => {
  it('only allows controlled custody transitions', () => {
    expect(canTransitionTrip('DRAFT', 'READY_TO_LOAD')).toBe(true);
    expect(canTransitionTrip('LOADING', 'DEPARTED')).toBe(false);
    expect(canTransitionTrip('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionTrip('RECONCILIATION_REQUIRED', 'COMPLETED_WITH_EXCEPTION')).toBe(true);
  });

  it('calculates unresolved custody without becoming negative', () => {
    expect(remainingQuantity(25, 22, 2)).toBe(1);
    expect(remainingQuantity(25, 22, 3)).toBe(0);
    expect(remainingQuantity(1, 2, 0)).toBe(0);
  });
});
