import { describe, expect, it } from 'vitest';
import { assertMakerChecker, canTransitionCount, variance } from '../src/inventory/count.domain.js';

describe('inventory count governance', () => {
  it('supports blind count, submit, recount and approval transitions', () => {
    expect(canTransitionCount('DRAFT', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionCount('IN_PROGRESS', 'SUBMITTED')).toBe(true);
    expect(canTransitionCount('SUBMITTED', 'RECOUNT_REQUIRED')).toBe(true);
    expect(canTransitionCount('RECOUNT_REQUIRED', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionCount('SUBMITTED', 'ADJUSTED')).toBe(false);
  });

  it('calculates signed variance', () => {
    expect(variance(25, 22)).toBe(-3);
    expect(variance(2, 5)).toBe(3);
  });

  it('enforces maker-checker', () => {
    expect(() => assertMakerChecker('maker', 'maker')).toThrow(
      'MAKER_CANNOT_APPROVE_OWN_ADJUSTMENT',
    );
    expect(() => assertMakerChecker('maker', 'checker')).not.toThrow();
  });
});
