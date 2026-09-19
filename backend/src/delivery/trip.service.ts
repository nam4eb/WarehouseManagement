import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import pg from 'pg';
import { DATABASE_POOL } from '../database/database.module.js';
import type { MovementCommand } from '../inventory/domain.js';
import { PostgresMovementLedger } from '../inventory/postgres-ledger.js';

interface ManifestContext {
  product_id: string;
  planned_quantity: string;
  source_location_id: string;
  customer_location_id: string;
  trip_location_id: string;
  warehouse_id: string;
  status: string;
}

@Injectable()
export class TripService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: pg.Pool,
    private readonly ledger: PostgresMovementLedger,
  ) {}

  private async context(organizationId: string, tripId: string, lineId: string) {
    const result = await this.pool.query<ManifestContext>(
      `SELECT ml.product_id,ml.planned_quantity,ml.source_location_id,ml.customer_location_id,
       t.trip_location_id,t.warehouse_id,t.status FROM trip_manifest_lines ml JOIN trips t ON t.id=ml.trip_id
       WHERE t.organization_id=$1 AND t.id=$2 AND ml.id=$3`,
      [organizationId, tripId, lineId],
    );
    if (!result.rows[0]) throw new NotFoundException('TRIP_MANIFEST_LINE_NOT_FOUND');
    return result.rows[0];
  }

  private assertScope(warehouseIds: string[], warehouseId: string) {
    if (!warehouseIds.includes('*') && !warehouseIds.includes(warehouseId))
      throw new BadRequestException('Warehouse outside scope');
  }

  async move(input: {
    tripId: string;
    lineId: string;
    action: 'LOAD' | 'DELIVERY' | 'TRIP_RETURN';
    quantity: number;
    serialItemId?: string;
    returnLocationId?: string;
    warehouseIds: string[];
    command: Omit<
      MovementCommand,
      'productId' | 'sourceLocationId' | 'destinationLocationId' | 'quantity' | 'serialItemId'
    >;
  }) {
    const context = await this.context(input.command.organizationId, input.tripId, input.lineId);
    this.assertScope(input.warehouseIds, context.warehouse_id);
    const source = input.action === 'LOAD' ? context.source_location_id : context.trip_location_id;
    const destination =
      input.action === 'LOAD'
        ? context.trip_location_id
        : input.action === 'DELIVERY'
          ? context.customer_location_id
          : input.returnLocationId!;
    return this.ledger.execute(
      {
        ...input.command,
        productId: context.product_id,
        sourceLocationId: source,
        destinationLocationId: destination,
        quantity: input.quantity,
        serialItemId: input.serialItemId,
        reasonCode: input.action,
        referenceType: 'TRIP_MANIFEST_LINE',
        referenceId: input.lineId,
      },
      {
        validate: async (client) => {
          const allowed =
            input.action === 'LOAD'
              ? ['READY_TO_LOAD', 'LOADING']
              : input.action === 'DELIVERY'
                ? ['DEPARTED', 'IN_PROGRESS']
                : ['DEPARTED', 'IN_PROGRESS', 'RETURNING'];
          const trip = await client.query<{ status: string }>(
            `SELECT status FROM trips WHERE id=$1 AND organization_id=$2 AND status=ANY($3::trip_status[]) FOR UPDATE`,
            [input.tripId, input.command.organizationId, allowed],
          );
          if (!trip.rows[0]) throw new ConflictException('TRIP_ACTION_NOT_ALLOWED');
          if (input.action === 'TRIP_RETURN') {
            const location = await client.query(
              `SELECT 1 FROM locations WHERE id=$1 AND organization_id=$2 AND warehouse_id=$3 AND type='RETURN_QUARANTINE'`,
              [destination, input.command.organizationId, context.warehouse_id],
            );
            if (!location.rowCount) throw new BadRequestException('INVALID_RETURN_LOCATION');
          }
          const totals = await client.query<{
            loaded: string;
            delivered: string;
            returned: string;
          }>(
            `SELECT COALESCE(sum(quantity) FILTER(WHERE reason_code='LOAD'),0) loaded,
             COALESCE(sum(quantity) FILTER(WHERE reason_code='DELIVERY'),0) delivered,
             COALESCE(sum(quantity) FILTER(WHERE reason_code='TRIP_RETURN'),0) returned
             FROM stock_movements WHERE organization_id=$1 AND reference_type='TRIP_MANIFEST_LINE' AND reference_id=$2`,
            [input.command.organizationId, input.lineId],
          );
          const amounts = totals.rows[0]!;
          const ceiling =
            input.action === 'LOAD'
              ? Number(context.planned_quantity)
              : Number(amounts.loaded) - Number(amounts.delivered) - Number(amounts.returned);
          const used = input.action === 'LOAD' ? Number(amounts.loaded) : 0;
          if (used + input.quantity > ceiling)
            throw new ConflictException(
              input.action === 'LOAD' ? 'TRIP_OVERLOAD' : 'TRIP_CUSTODY_EXCEEDED',
            );
        },
        afterMovement: async (client) => {
          if (input.action === 'LOAD') {
            await client.query(
              `UPDATE trips SET status='LOADING',version=version+1 WHERE id=$1 AND status='READY_TO_LOAD'`,
              [input.tripId],
            );
            const incomplete = await client.query(
              `SELECT 1 FROM trip_manifest_lines ml WHERE ml.trip_id=$1 AND ml.planned_quantity <>
               COALESCE((SELECT sum(quantity) FROM stock_movements m WHERE m.organization_id=$2 AND m.reference_type='TRIP_MANIFEST_LINE' AND m.reference_id=ml.id AND m.reason_code='LOAD'),0) LIMIT 1`,
              [input.tripId, input.command.organizationId],
            );
            if (!incomplete.rowCount)
              await client.query(`UPDATE trips SET status='LOADED',version=version+1 WHERE id=$1`, [
                input.tripId,
              ]);
          } else if (input.action === 'DELIVERY')
            await client.query(
              `UPDATE trips SET status='IN_PROGRESS',version=version+1 WHERE id=$1 AND status='DEPARTED'`,
              [input.tripId],
            );
          else
            await client.query(
              `UPDATE trips SET status='RETURNING',version=version+1 WHERE id=$1 AND status IN ('DEPARTED','IN_PROGRESS')`,
              [input.tripId],
            );
        },
      },
    );
  }

  async depart(organizationId: string, tripId: string, actorId: string, warehouseIds: string[]) {
    const all = warehouseIds.includes('*');
    const result = await this.pool.query<{ warehouse_id: string }>(
      `UPDATE trips SET status='DEPARTED',version=version+1
       WHERE id=$1 AND organization_id=$2 AND status='LOADED'
         AND ($3::boolean OR warehouse_id=ANY($4::uuid[])) RETURNING warehouse_id`,
      [tripId, organizationId, all, all ? [] : warehouseIds],
    );
    if (!result.rows[0]) throw new ConflictException('TRIP_NOT_READY_TO_DEPART');
    await this.pool.query(
      `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,correlation_id) VALUES($1,$2,'trip.departed','trip',$3,gen_random_uuid())`,
      [organizationId, actorId, tripId],
    );
    return { id: tripId, status: 'DEPARTED' };
  }

  async reconcile(organizationId: string, tripId: string, actorId: string, warehouseIds: string[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const trip = await client.query<{ warehouse_id: string; trip_location_id: string }>(
        `SELECT warehouse_id,trip_location_id FROM trips WHERE id=$1 AND organization_id=$2 AND status IN ('DEPARTED','IN_PROGRESS','RETURNING') FOR UPDATE`,
        [tripId, organizationId],
      );
      if (!trip.rows[0]) throw new ConflictException('TRIP_NOT_RECONCILABLE');
      this.assertScope(warehouseIds, trip.rows[0].warehouse_id);
      const balance = await client.query<{ quantity: string }>(
        `SELECT COALESCE(sum(quantity),0) quantity FROM stock_balances WHERE organization_id=$1 AND location_id=$2`,
        [organizationId, trip.rows[0].trip_location_id],
      );
      const unresolved = Number(balance.rows[0]!.quantity);
      const status = unresolved === 0 ? 'COMPLETED' : 'RECONCILIATION_REQUIRED';
      await client.query(`UPDATE trips SET status=$2,version=version+1 WHERE id=$1`, [
        tripId,
        status,
      ]);
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id) VALUES($1,$2,'trip.reconciled','trip',$3,$4,gen_random_uuid())`,
        [organizationId, actorId, tripId, JSON.stringify({ unresolved })],
      );
      await client.query('COMMIT');
      return { id: tripId, status, unresolvedQuantity: unresolved };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async approveException(input: {
    organizationId: string;
    tripId: string;
    actorId: string;
    warehouseIds: string[];
    resolutionCode: 'ACCEPT_VARIANCE' | 'LOSS_CONFIRMED' | 'INVESTIGATE_LATER';
    reason: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const trip = await client.query<{ warehouse_id: string; trip_location_id: string }>(
        `SELECT warehouse_id,trip_location_id FROM trips
         WHERE id=$1 AND organization_id=$2 AND status='RECONCILIATION_REQUIRED' FOR UPDATE`,
        [input.tripId, input.organizationId],
      );
      if (!trip.rows[0]) throw new ConflictException('TRIP_EXCEPTION_NOT_APPROVABLE');
      this.assertScope(input.warehouseIds, trip.rows[0].warehouse_id);
      const balance = await client.query<{ quantity: string }>(
        `SELECT COALESCE(sum(quantity),0) quantity FROM stock_balances
         WHERE organization_id=$1 AND location_id=$2`,
        [input.organizationId, trip.rows[0].trip_location_id],
      );
      const unresolved = Number(balance.rows[0]!.quantity);
      if (unresolved <= 0) throw new ConflictException('TRIP_EXCEPTION_NO_LONGER_EXISTS');
      const approval = await client.query(
        `INSERT INTO trip_exception_approvals(organization_id,trip_id,unresolved_quantity,resolution_code,reason,approved_by)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id,trip_id,unresolved_quantity,resolution_code,reason,approved_at`,
        [
          input.organizationId,
          input.tripId,
          unresolved,
          input.resolutionCode,
          input.reason,
          input.actorId,
        ],
      );
      await client.query(
        `UPDATE trips SET status='COMPLETED_WITH_EXCEPTION',version=version+1 WHERE id=$1`,
        [input.tripId],
      );
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
         VALUES($1,$2,'trip.exception_approved','trip',$3,$4,gen_random_uuid())`,
        [
          input.organizationId,
          input.actorId,
          input.tripId,
          JSON.stringify({
            unresolvedQuantity: unresolved,
            resolutionCode: input.resolutionCode,
            reason: input.reason,
          }),
        ],
      );
      await client.query('COMMIT');
      return { ...approval.rows[0], status: 'COMPLETED_WITH_EXCEPTION' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
