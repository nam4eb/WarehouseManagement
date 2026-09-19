import { ConflictException, Inject, Injectable } from '@nestjs/common';
import pg from 'pg';
import { DATABASE_POOL } from '../database/database.module.js';
import type { MovementCommand, StockMovement } from './domain.js';
import { validateMovement } from './domain.js';
import { payloadHash } from './ledger.js';

export interface MovementTransactionHooks {
  validate?: (client: pg.PoolClient) => Promise<void>;
  afterMovement?: (client: pg.PoolClient, movement: StockMovement) => Promise<void>;
}

@Injectable()
export class PostgresMovementLedger {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  async locationWarehouse(locationId: string): Promise<string | undefined> {
    const result = await this.pool.query<{ warehouse_id: string }>(
      'SELECT warehouse_id FROM locations WHERE id=$1',
      [locationId],
    );
    return result.rows[0]?.warehouse_id;
  }

  async listBalances(organizationId: string, warehouseIds: string[], productId?: string) {
    const all = warehouseIds.includes('*');
    const result = await this.pool.query(
      `SELECT b.product_id,p.sku,p.name,b.location_id,l.code location_code,l.type,b.quantity,b.version,b.updated_at
       FROM stock_balances b JOIN products p ON p.id=b.product_id JOIN locations l ON l.id=b.location_id
       WHERE b.organization_id=$1 AND ($2::boolean OR l.warehouse_id=ANY($3::uuid[]))
         AND ($4::uuid IS NULL OR b.product_id=$4) AND b.quantity<>0 ORDER BY p.sku,l.code`,
      [organizationId, all, all ? [] : warehouseIds, productId ?? null],
    );
    return result.rows;
  }

  async listMovements(organizationId: string, warehouseIds: string[], serialItemId?: string) {
    const all = warehouseIds.includes('*');
    const result = await this.pool.query(
      `SELECT m.id,m.product_id,p.sku,m.serial_item_id,s.serial_number,m.source_location_id,src.code source_code,
       m.destination_location_id,dst.code destination_code,m.quantity,m.reason_code,m.reference_type,m.reference_id,
       m.reverses_movement_id,m.actor_id,m.client_occurred_at,m.occurred_at,m.correlation_id
       FROM stock_movements m JOIN products p ON p.id=m.product_id
       JOIN locations src ON src.id=m.source_location_id JOIN locations dst ON dst.id=m.destination_location_id
       LEFT JOIN serial_items s ON s.id=m.serial_item_id
       WHERE m.organization_id=$1 AND ($2::boolean OR (src.warehouse_id=ANY($3::uuid[]) AND dst.warehouse_id=ANY($3::uuid[])))
         AND ($4::uuid IS NULL OR m.serial_item_id=$4) ORDER BY m.occurred_at DESC,m.id DESC LIMIT 500`,
      [organizationId, all, all ? [] : warehouseIds, serialItemId ?? null],
    );
    return result.rows;
  }

  async execute(
    command: MovementCommand,
    hooks: MovementTransactionHooks = {},
  ): Promise<StockMovement> {
    validateMovement(command);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const hash = payloadHash(command);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO sync_commands(organization_id,idempotency_key,device_id,payload_hash,command_type,client_occurred_at)
         VALUES($1,$2,$3,$4,'CREATE_MOVEMENT',$5)
         ON CONFLICT(organization_id,idempotency_key) DO NOTHING RETURNING id`,
        [
          command.organizationId,
          command.idempotencyKey,
          command.deviceId,
          hash,
          command.clientOccurredAt,
        ],
      );
      if (!inserted.rowCount) {
        const prior = await client.query<{
          payload_hash: string;
          status: string;
          result_reference: { movementId?: string } | null;
        }>(
          `SELECT payload_hash,status,result_reference FROM sync_commands
           WHERE organization_id=$1 AND idempotency_key=$2 FOR UPDATE`,
          [command.organizationId, command.idempotencyKey],
        );
        const row = prior.rows[0];
        if (!row || row.payload_hash !== hash) throw new ConflictException('IDEMPOTENCY_CONFLICT');
        if (row.status !== 'SUCCEEDED' || !row.result_reference?.movementId)
          throw new ConflictException('COMMAND_ALREADY_PROCESSING');
        const existing = await client.query<Record<string, unknown>>(
          'SELECT * FROM stock_movements WHERE id=$1',
          [row.result_reference.movementId],
        );
        await client.query('COMMIT');
        return this.mapRow(existing.rows[0]!);
      }

      await hooks.validate?.(client);

      const product = await client.query<{ serial_required: boolean }>(
        `SELECT serial_required FROM products WHERE id=$1 AND organization_id=$2 FOR SHARE`,
        [command.productId, command.organizationId],
      );
      if (!product.rows[0]) throw new ConflictException('PRODUCT_NOT_FOUND');
      if (product.rows[0].serial_required && !command.serialItemId)
        throw new ConflictException('SERIAL_REQUIRED');
      if (!product.rows[0].serial_required && command.serialItemId)
        throw new ConflictException('SERIAL_NOT_ALLOWED');

      if (command.serialItemId) {
        const serial = await client.query<{ product_id: string; current_location_id: string }>(
          `SELECT product_id,current_location_id FROM serial_items WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
          [command.serialItemId, command.organizationId],
        );
        const item = serial.rows[0];
        if (
          !item ||
          item.product_id !== command.productId ||
          item.current_location_id !== command.sourceLocationId
        ) {
          throw new ConflictException('SERIAL_LOCATION_CONFLICT');
        }
      }

      const endpoints = await client.query<{ id: string; tracks_balance: boolean }>(
        `SELECT id,tracks_balance FROM locations WHERE organization_id=$1 AND id=ANY($2::uuid[]) FOR SHARE`,
        [command.organizationId, [command.sourceLocationId, command.destinationLocationId]],
      );
      if (endpoints.rowCount !== 2) throw new ConflictException('LOCATION_NOT_FOUND');
      const sourceTracked = endpoints.rows.find(
        (row) => row.id === command.sourceLocationId,
      )!.tracks_balance;
      const destinationTracked = endpoints.rows.find(
        (row) => row.id === command.destinationLocationId,
      )!.tracks_balance;
      if (sourceTracked) {
        await client.query(
          `INSERT INTO stock_balances(organization_id,product_id,location_id,quantity)
           VALUES($1,$2,$3,0) ON CONFLICT DO NOTHING`,
          [command.organizationId, command.productId, command.sourceLocationId],
        );
        const debit = await client.query(
          `UPDATE stock_balances SET quantity=quantity-$4,version=version+1,updated_at=now()
           WHERE organization_id=$1 AND product_id=$2 AND location_id=$3 AND quantity >= $4 RETURNING quantity`,
          [command.organizationId, command.productId, command.sourceLocationId, command.quantity],
        );
        if (!debit.rowCount) throw new ConflictException('INSUFFICIENT_STOCK');
      }
      if (destinationTracked)
        await client.query(
          `INSERT INTO stock_balances(organization_id,product_id,location_id,quantity,version)
         VALUES($1,$2,$3,$4,1) ON CONFLICT(organization_id,product_id,location_id) DO UPDATE
         SET quantity=stock_balances.quantity+EXCLUDED.quantity,version=stock_balances.version+1,updated_at=now()`,
          [
            command.organizationId,
            command.productId,
            command.destinationLocationId,
            command.quantity,
          ],
        );
      const syncCommandId = inserted.rows[0]!.id;
      const movement = await client.query<Record<string, unknown>>(
        `INSERT INTO stock_movements(organization_id,product_id,serial_item_id,source_location_id,destination_location_id,
          quantity,reason_code,reference_type,reference_id,reverses_movement_id,sync_command_id,actor_id,device_id,
          client_occurred_at,correlation_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          command.organizationId,
          command.productId,
          command.serialItemId ?? null,
          command.sourceLocationId,
          command.destinationLocationId,
          command.quantity,
          command.reasonCode,
          command.referenceType ?? null,
          command.referenceId ?? null,
          command.reversesMovementId ?? null,
          syncCommandId,
          command.actorId,
          command.deviceId,
          command.clientOccurredAt,
          command.correlationId,
        ],
      );
      const result = this.mapRow(movement.rows[0]!, command.idempotencyKey);
      if (command.serialItemId)
        await client.query(
          'UPDATE serial_items SET current_location_id=$2,version=version+1 WHERE id=$1',
          [command.serialItemId, command.destinationLocationId],
        );
      await hooks.afterMovement?.(client, result);
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
         VALUES($1,$2,'inventory.moved','stock_movement',$3,$4,$5)`,
        [
          command.organizationId,
          command.actorId,
          result.id,
          JSON.stringify({ reasonCode: command.reasonCode }),
          command.correlationId,
        ],
      );
      await client.query(
        `INSERT INTO outbox_events(organization_id,topic,aggregate_type,aggregate_id,payload)
         VALUES($1,'inventory.movement.created','stock_movement',$2,$3)`,
        [command.organizationId, result.id, JSON.stringify(result)],
      );
      await client.query(
        "UPDATE sync_commands SET status='SUCCEEDED',result_reference=$2 WHERE id=$1",
        [syncCommandId, JSON.stringify({ movementId: result.id })],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private mapRow(row: Record<string, unknown>, idempotencyKey = ''): StockMovement {
    return {
      id: String(row.id),
      idempotencyKey,
      organizationId: String(row.organization_id),
      productId: String(row.product_id),
      serialItemId: row.serial_item_id ? String(row.serial_item_id) : undefined,
      sourceLocationId: String(row.source_location_id),
      destinationLocationId: String(row.destination_location_id),
      quantity: Number(row.quantity),
      reasonCode: String(row.reason_code),
      actorId: String(row.actor_id),
      deviceId: String(row.device_id),
      clientOccurredAt: new Date(String(row.client_occurred_at)).toISOString(),
      correlationId: String(row.correlation_id),
      occurredAt: new Date(String(row.occurred_at)).toISOString(),
    };
  }
}
