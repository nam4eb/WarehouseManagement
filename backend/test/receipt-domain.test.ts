import { describe, expect, it } from 'vitest';
import { canTransitionReceipt, receiptVariance } from '../src/inbound/receipt.domain.js';

describe('receipt domain', () => {
  it('allows only explicit receipt state transitions', () => {
    expect(canTransitionReceipt('DRAFT', 'RECEIVING')).toBe(true);
    expect(canTransitionReceipt('RECEIVING', 'CONFIRMED')).toBe(true);
    expect(canTransitionReceipt('CONFIRMED', 'RECEIVING')).toBe(false);
    expect(canTransitionReceipt('CANCELLED', 'RECEIVING')).toBe(false);
  });
  it('classifies receipt variance', () => {
    expect(receiptVariance(10, 9)).toBe('SHORT');
    expect(receiptVariance(10, 10)).toBe('MATCH');
    expect(receiptVariance(10, 11)).toBe('OVER');
  });
});
