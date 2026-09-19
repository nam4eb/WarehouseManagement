export type UUID = string;

export interface MovementCommand {
  idempotencyKey: UUID;
  organizationId: UUID;
  productId: UUID;
  serialItemId?: UUID;
  sourceLocationId: UUID;
  destinationLocationId: UUID;
  quantity: number;
  reasonCode: string;
  referenceType?: string;
  referenceId?: UUID;
  reversesMovementId?: UUID;
  actorId: UUID;
  deviceId: UUID;
  clientOccurredAt: string;
  correlationId: UUID;
}

export interface StockMovement extends MovementCommand {
  id: UUID;
  occurredAt: string;
}

export class InventoryRuleError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export function validateMovement(command: MovementCommand): void {
  if (!Number.isFinite(command.quantity) || command.quantity <= 0) {
    throw new InventoryRuleError('Quantity must be positive', 'INVALID_QUANTITY');
  }
  if (command.sourceLocationId === command.destinationLocationId) {
    throw new InventoryRuleError('Source and destination must differ', 'SAME_LOCATION');
  }
  if (command.serialItemId && command.quantity !== 1) {
    throw new InventoryRuleError('Serialized movement quantity must equal 1', 'SERIAL_QUANTITY');
  }
  if (!command.reasonCode.trim()) {
    throw new InventoryRuleError('A reason code is required', 'REASON_REQUIRED');
  }
}
