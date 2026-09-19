import { describe, expect, it } from 'vitest';
import { expandBundle } from '../src/catalog/bundle.domain.js';

describe('bundle component rules', () => {
  it('expands an air-conditioner set into indoor and outdoor components', () => {
    expect(
      expandBundle(2, [
        { productId: 'indoor', role: 'INDOOR', quantityPerBundle: 1 },
        { productId: 'outdoor', role: 'OUTDOOR', quantityPerBundle: 1 },
      ]),
    ).toEqual([
      { productId: 'indoor', role: 'INDOOR', requiredQuantity: 2 },
      { productId: 'outdoor', role: 'OUTDOOR', requiredQuantity: 2 },
    ]);
  });
  it('rejects ambiguous duplicate component roles', () => {
    expect(() =>
      expandBundle(1, [
        { productId: 'a', role: 'INDOOR', quantityPerBundle: 1 },
        { productId: 'b', role: 'INDOOR', quantityPerBundle: 1 },
      ]),
    ).toThrow(/Duplicate component role/);
  });
});
