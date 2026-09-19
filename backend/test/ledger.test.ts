import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryMovementLedger, rebuildBalances } from '../src/inventory/ledger.js';
import type { MovementCommand } from '../src/inventory/domain.js';

function command(overrides: Partial<MovementCommand> = {}): MovementCommand {
  return {
    idempotencyKey: randomUUID(),
    organizationId: 'org',
    productId: 'product',
    sourceLocationId: 'warehouse',
    destinationLocationId: 'trip',
    quantity: 1,
    reasonCode: 'LOAD',
    actorId: 'actor',
    deviceId: 'device',
    clientOccurredAt: '2026-09-18T00:00:00.000Z',
    correlationId: randomUUID(),
    ...overrides,
  };
}

describe('movement ledger invariants', () => {
  it('returns the same result when one offline command is retried ten times', () => {
    const ledger = new InMemoryMovementLedger();
    ledger.seedBalance(command({}), 'warehouse', 25);
    const input = command({ quantity: 25 });
    const results = Array.from({ length: 10 }, () => ledger.execute(input));
    expect(new Set(results.map((item) => item.id))).toHaveLength(1);
    expect(ledger.snapshot().movements).toHaveLength(1);
    expect([...ledger.snapshot().balances.values()]).toEqual([0, 25]);
  });

  it('rejects reusing an idempotency key with a changed payload', () => {
    const ledger = new InMemoryMovementLedger();
    ledger.seedBalance(command({}), 'warehouse', 2);
    const input = command();
    ledger.execute(input);
    expect(() => ledger.execute({ ...input, quantity: 2 })).toThrow(/different payload/);
  });

  it('accepts a retry with a new transport correlation id', () => {
    const ledger = new InMemoryMovementLedger();
    ledger.seedBalance(command({}), 'warehouse', 1);
    const input = command();
    const first = ledger.execute(input);
    const retry = ledger.execute({ ...input, correlationId: randomUUID() });
    expect(retry.id).toBe(first.id);
    expect(ledger.snapshot().movements).toHaveLength(1);
  });

  it('allows only one device to move a serialized item', () => {
    const ledger = new InMemoryMovementLedger();
    ledger.seedBalance(command({}), 'warehouse', 1);
    ledger.seedSerial('serial-1', 'warehouse');
    ledger.execute(command({ serialItemId: 'serial-1' }));
    expect(() =>
      ledger.execute(command({ serialItemId: 'serial-1', deviceId: 'device-2' })),
    ).toThrow(/source location/);
    expect(ledger.snapshot().movements).toHaveLength(1);
  });

  it('records a linked correction instead of mutating history', () => {
    const ledger = new InMemoryMovementLedger();
    ledger.seedBalance(command({}), 'warehouse', 1);
    const original = ledger.execute(command());
    const reversal = ledger.execute(
      command({
        sourceLocationId: 'trip',
        destinationLocationId: 'warehouse',
        reasonCode: 'CORRECTION',
        reversesMovementId: original.id,
      }),
    );
    expect(reversal.reversesMovementId).toBe(original.id);
    expect(ledger.snapshot().movements).toHaveLength(2);
  });

  it('models load 25, deliver 22 and reconciles the expected return of 3', () => {
    const ledger = new InMemoryMovementLedger();
    ledger.seedBalance(command({}), 'staging', 25);
    ledger.execute(
      command({ sourceLocationId: 'staging', destinationLocationId: 'trip', quantity: 25 }),
    );
    ledger.execute(
      command({
        sourceLocationId: 'trip',
        destinationLocationId: 'customer',
        quantity: 22,
        reasonCode: 'DELIVERY',
      }),
    );
    ledger.execute(
      command({
        sourceLocationId: 'trip',
        destinationLocationId: 'return-quarantine',
        quantity: 3,
        reasonCode: 'TRIP_RETURN',
      }),
    );
    const balances = ledger.snapshot().balances;
    expect(balances.get('org:product:trip')).toBe(0);
    expect(balances.get('org:product:return-quarantine')).toBe(3);
  });

  it('exposes a mismatch when only 2 of 3 expected items are returned', () => {
    const ledger = new InMemoryMovementLedger();
    ledger.seedBalance(command({}), 'trip', 3);
    ledger.execute(
      command({
        sourceLocationId: 'trip',
        destinationLocationId: 'return-quarantine',
        quantity: 2,
        reasonCode: 'TRIP_RETURN',
      }),
    );
    expect(ledger.snapshot().balances.get('org:product:trip')).toBe(1);
  });

  it('rebuilds movement deltas deterministically', () => {
    const ledger = new InMemoryMovementLedger();
    ledger.seedBalance(command({}), 'warehouse', 5);
    ledger.execute(command({ quantity: 2 }));
    const rebuilt = rebuildBalances(ledger.snapshot().movements);
    expect(rebuilt.get('org:product:warehouse')).toBe(-2);
    expect(rebuilt.get('org:product:trip')).toBe(2);
  });
});
