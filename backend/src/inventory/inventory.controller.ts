import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/authorization.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { PostgresMovementLedger } from './postgres-ledger.js';

const schema = z.object({
  productId: z.uuid(),
  serialItemId: z.uuid().optional(),
  sourceLocationId: z.uuid(),
  destinationLocationId: z.uuid(),
  quantity: z.number().positive(),
  reasonCode: z.string().min(1).max(80),
  referenceType: z.string().max(80).optional(),
  referenceId: z.uuid().optional(),
  reversesMovementId: z.uuid().optional(),
  clientOccurredAt: z.iso.datetime(),
});

@Controller('inventory/movements')
@UseGuards(AuthGuard, PermissionGuard)
export class InventoryController {
  constructor(private readonly ledger: PostgresMovementLedger) {}

  @Get()
  @RequirePermission('inventory.read')
  async list(
    @Query('serialItemId') serialItemId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (serialItemId && !z.uuid().safeParse(serialItemId).success)
      throw new BadRequestException('Invalid serialItemId');
    return this.ledger.listMovements(
      request.user.organizationId,
      request.user.warehouseIds,
      serialItemId,
    );
  }
  @Post()
  @RequirePermission('inventory.move')
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (!z.uuid().safeParse(key).success)
      throw new BadRequestException('Valid Idempotency-Key required');
    const [sourceWarehouse, destinationWarehouse] = await Promise.all([
      this.ledger.locationWarehouse(parsed.data.sourceLocationId),
      this.ledger.locationWarehouse(parsed.data.destinationLocationId),
    ]);
    const allowed = (warehouse: string | undefined) =>
      !!warehouse &&
      (request.user.warehouseIds.includes('*') || request.user.warehouseIds.includes(warehouse));
    if (!allowed(sourceWarehouse) || !allowed(destinationWarehouse))
      throw new BadRequestException('Movement location is outside warehouse scope');
    return this.ledger.execute({
      ...parsed.data,
      idempotencyKey: key!,
      organizationId: request.user.organizationId,
      actorId: request.user.sub,
      deviceId: request.user.deviceId,
      correlationId: z.uuid().safeParse(correlation).success ? correlation! : randomUUID(),
    });
  }
}

@Controller('inventory/balances')
@UseGuards(AuthGuard, PermissionGuard)
export class BalanceController {
  constructor(private readonly ledger: PostgresMovementLedger) {}
  @Get()
  @RequirePermission('inventory.read')
  list(@Query('productId') productId: string | undefined, @Req() request: AuthenticatedRequest) {
    if (productId && !z.uuid().safeParse(productId).success)
      throw new BadRequestException('Invalid productId');
    return this.ledger.listBalances(
      request.user.organizationId,
      request.user.warehouseIds,
      productId,
    );
  }
}
