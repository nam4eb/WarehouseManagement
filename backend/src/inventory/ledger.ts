import { createHash, randomUUID } from 'node:crypto';
import {
  InventoryRuleError,
  type MovementCommand,
  type StockMovement,
  validateMovement,
} from './domain.js';

interface StoredCommand {
  payloadHash: string;
  result: StockMovement;
}

export interface LedgerSnapshot {
  movements: readonly StockMovement[];
  balances: ReadonlyMap<string, number>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function payloadHash(command: MovementCommand): string {
  const stablePayload = {
    organizationId: command.organizationId,
    productId: command.productId,
    serialItemId: command.serialItemId,
    sourceLocationId: command.sourceLocationId,
    destinationLocationId: command.destinationLocationId,
    quantity: command.quantity,
    reasonCode: command.reasonCode,
    referenceType: command.referenceType,
    referenceId: command.referenceId,
    reversesMovementId: command.reversesMovementId,
    actorId: command.actorId,
    deviceId: command.deviceId,
    clientOccurredAt: command.clientOccurredAt,
  };
  return createHash('sha256').update(canonical(stablePayload)).digest('hex');
}

function balanceKey(organizationId: string, productId: string, locationId: string): string {
  return `${organizationId}:${productId}:${locationId}`;
}

export class InMemoryMovementLedger {
  private readonly movements: StockMovement[] = [];
  private readonly balances = new Map<string, number>();
  private readonly commands = new Map<string, StoredCommand>();
  private readonly serialLocations = new Map<string, string>();

  seedBalance(
    command: Pick<MovementCommand, 'organizationId' | 'productId'>,
    locationId: string,
    quantity: number,
  ): void {
    this.balances.set(balanceKey(command.organizationId, command.productId, locationId), quantity);
  }

  seedSerial(serialItemId: string, locationId: string): void {
    this.serialLocations.set(serialItemId, locationId);
  }

  execute(command: MovementCommand): StockMovement {
    validateMovement(command);
    const hash = payloadHash(command);
    const prior = this.commands.get(command.idempotencyKey);
    if (prior) {
      if (prior.payloadHash !== hash) {
        throw new InventoryRuleError(
          'Idempotency key was reused with a different payload',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      return prior.result;
    }
    if (
      command.reversesMovementId &&
      !this.movements.some((m) => m.id === command.reversesMovementId)
    ) {
      throw new InventoryRuleError('Original movement does not exist', 'REVERSAL_NOT_FOUND');
    }
    if (
      command.serialItemId &&
      this.serialLocations.get(command.serialItemId) !== command.sourceLocationId
    ) {
      throw new InventoryRuleError(
        'Serial is not at the source location',
        'SERIAL_LOCATION_CONFLICT',
      );
    }
    const sourceKey = balanceKey(
      command.organizationId,
      command.productId,
      command.sourceLocationId,
    );
    const destinationKey = balanceKey(
      command.organizationId,
      command.productId,
      command.destinationLocationId,
    );
    const source = this.balances.get(sourceKey) ?? 0;
    if (source < command.quantity) {
      throw new InventoryRuleError('Insufficient stock at source', 'INSUFFICIENT_STOCK');
    }
    const movement: StockMovement = {
      ...command,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
    this.balances.set(sourceKey, source - command.quantity);
    this.balances.set(destinationKey, (this.balances.get(destinationKey) ?? 0) + command.quantity);
    if (command.serialItemId)
      this.serialLocations.set(command.serialItemId, command.destinationLocationId);
    this.movements.push(movement);
    this.commands.set(command.idempotencyKey, { payloadHash: hash, result: movement });
    return movement;
  }

  snapshot(): LedgerSnapshot {
    return { movements: [...this.movements], balances: new Map(this.balances) };
  }
}

export function rebuildBalances(movements: readonly StockMovement[]): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const movement of movements) {
    const source = balanceKey(
      movement.organizationId,
      movement.productId,
      movement.sourceLocationId,
    );
    const destination = balanceKey(
      movement.organizationId,
      movement.productId,
      movement.destinationLocationId,
    );
    result.set(source, (result.get(source) ?? 0) - movement.quantity);
    result.set(destination, (result.get(destination) ?? 0) + movement.quantity);
  }
  return result;
}
