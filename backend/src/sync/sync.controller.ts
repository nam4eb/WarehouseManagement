import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/authorization.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { DATABASE_POOL } from '../database/database.module.js';
import { PostgresMovementLedger } from '../inventory/postgres-ledger.js';

const commandSchema = z.object({
  type: z.literal('CREATE_MOVEMENT'),
  idempotencyKey: z.uuid(),
  productId: z.uuid(),
  serialItemId: z.uuid().optional(),
  sourceLocationId: z.uuid(),
  destinationLocationId: z.uuid(),
  quantity: z.number().positive(),
  reasonCode: z.string().trim().min(1).max(80),
  referenceType: z.string().max(80).optional(),
  referenceId: z.uuid().optional(),
  reversesMovementId: z.uuid().optional(),
  clientOccurredAt: z.iso.datetime(),
  correlationId: z.uuid().optional(),
  dependsOn: z.array(z.uuid()).max(20).default([]),
});

@Controller('sync')
@UseGuards(AuthGuard, PermissionGuard)
export class SyncController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: pg.Pool,
    private readonly ledger: PostgresMovementLedger,
  ) {}

  @Post('commands')
  @RequirePermission('inventory.move')
  async commands(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z.object({ commands: z.array(commandSchema).min(1).max(50) }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const keys = new Set(parsed.data.commands.map((item) => item.idempotencyKey));
    if (keys.size !== parsed.data.commands.length)
      throw new BadRequestException('Duplicate idempotency key in batch');
    const dependencyKeys = [...new Set(parsed.data.commands.flatMap((item) => item.dependsOn))];
    const prior = dependencyKeys.length
      ? await this.pool.query<{ idempotency_key: string }>(
          `SELECT idempotency_key FROM sync_commands
           WHERE organization_id=$1 AND idempotency_key=ANY($2::uuid[]) AND status='SUCCEEDED'`,
          [request.user.organizationId, dependencyKeys],
        )
      : { rows: [] };
    const completed = new Set<string>(prior.rows.map((row) => row.idempotency_key));
    const results: Array<Record<string, unknown>> = [];
    for (const item of parsed.data.commands) {
      const unresolved = item.dependsOn.filter((key) => !completed.has(key));
      if (unresolved.length) {
        results.push({
          idempotencyKey: item.idempotencyKey,
          status: 'BLOCKED_DEPENDENCY',
          unresolved,
        });
        continue;
      }
      const [sourceWarehouse, destinationWarehouse] = await Promise.all([
        this.ledger.locationWarehouse(item.sourceLocationId),
        this.ledger.locationWarehouse(item.destinationLocationId),
      ]);
      const allowed = (warehouse: string | undefined) =>
        !!warehouse &&
        (request.user.warehouseIds.includes('*') || request.user.warehouseIds.includes(warehouse));
      if (!allowed(sourceWarehouse) || !allowed(destinationWarehouse)) {
        results.push({
          idempotencyKey: item.idempotencyKey,
          status: 'REJECTED',
          code: 'WAREHOUSE_SCOPE',
        });
        continue;
      }
      try {
        const payload = {
          idempotencyKey: item.idempotencyKey,
          productId: item.productId,
          serialItemId: item.serialItemId,
          sourceLocationId: item.sourceLocationId,
          destinationLocationId: item.destinationLocationId,
          quantity: item.quantity,
          reasonCode: item.reasonCode,
          referenceType: item.referenceType,
          referenceId: item.referenceId,
          reversesMovementId: item.reversesMovementId,
          clientOccurredAt: item.clientOccurredAt,
          correlationId: item.correlationId,
        };
        const movement = await this.ledger.execute({
          ...payload,
          organizationId: request.user.organizationId,
          actorId: request.user.sub,
          deviceId: request.user.deviceId,
          correlationId: payload.correlationId ?? randomUUID(),
        });
        completed.add(item.idempotencyKey);
        results.push({
          idempotencyKey: item.idempotencyKey,
          status: 'SUCCEEDED',
          movementId: movement.id,
        });
      } catch (error) {
        results.push({
          idempotencyKey: item.idempotencyKey,
          status: 'REJECTED',
          code: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        });
      }
    }
    return { results };
  }

  @Get('status/:idempotencyKey')
  @RequirePermission('inventory.read')
  async status(@Param('idempotencyKey') key: string, @Req() request: AuthenticatedRequest) {
    if (!z.uuid().safeParse(key).success) throw new BadRequestException('Invalid idempotency key');
    const result = await this.pool.query(
      `SELECT idempotency_key,command_type,status,result_reference,client_occurred_at,received_at
       FROM sync_commands WHERE organization_id=$1 AND idempotency_key=$2`,
      [request.user.organizationId, key],
    );
    return result.rows[0] ?? { idempotency_key: key, status: 'NOT_FOUND' };
  }
}
