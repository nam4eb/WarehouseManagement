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

interface PickingContext {
  line_id: string;
  product_id: string;
  required_quantity: string;
  task_status: string;
  warehouse_id: string;
  staging_location_id: string;
}

@Injectable()
export class PickingService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: pg.Pool,
    private readonly ledger: PostgresMovementLedger,
  ) {}

  private async context(organizationId: string, taskId: string, lineId: string) {
    const result = await this.pool.query<PickingContext>(
      `SELECT l.id line_id,l.product_id,l.required_quantity,t.status task_status,t.warehouse_id,t.staging_location_id
       FROM picking_task_lines l JOIN picking_tasks t ON t.id=l.picking_task_id
       WHERE t.organization_id=$1 AND t.id=$2 AND l.id=$3`,
      [organizationId, taskId, lineId],
    );
    if (!result.rows[0]) throw new NotFoundException('PICKING_LINE_NOT_FOUND');
    return result.rows[0];
  }

  async scan(input: {
    taskId: string;
    lineId: string;
    sourceLocationId: string;
    quantity: number;
    serialItemId?: string;
    warehouseIds: string[];
    command: Omit<
      MovementCommand,
      'productId' | 'sourceLocationId' | 'destinationLocationId' | 'quantity' | 'serialItemId'
    >;
  }) {
    const context = await this.context(input.command.organizationId, input.taskId, input.lineId);
    if (!input.warehouseIds.includes('*') && !input.warehouseIds.includes(context.warehouse_id))
      throw new BadRequestException('Warehouse outside scope');
    return this.ledger.execute(
      {
        ...input.command,
        productId: context.product_id,
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: context.staging_location_id,
        quantity: input.quantity,
        serialItemId: input.serialItemId,
        referenceType: 'PICKING_TASK_LINE',
        referenceId: input.lineId,
        reasonCode: 'PICK',
      },
      {
        validate: async (client) => {
          const task = await client.query<{ status: string }>(
            `SELECT t.status FROM picking_tasks t JOIN locations src ON src.id=$3
           WHERE t.id=$1 AND t.organization_id=$2 AND t.status IN ('OPEN','PICKING')
             AND src.organization_id=$2 AND src.warehouse_id=t.warehouse_id AND src.type IN ('AVAILABLE','RACK')
           FOR UPDATE OF t`,
            [input.taskId, input.command.organizationId, input.sourceLocationId],
          );
          if (!task.rows[0]) throw new ConflictException('PICK_NOT_ALLOWED');
          const picked = await client.query<{ quantity: string }>(
            `SELECT COALESCE(sum(quantity),0) quantity FROM stock_movements
           WHERE organization_id=$1 AND reference_type='PICKING_TASK_LINE' AND reference_id=$2 AND reason_code='PICK'`,
            [input.command.organizationId, input.lineId],
          );
          if (Number(picked.rows[0]!.quantity) + input.quantity > Number(context.required_quantity))
            throw new ConflictException('PICKING_LINE_OVERPICK');
          if (task.rows[0].status === 'OPEN')
            await client.query(
              `UPDATE picking_tasks SET status='PICKING',version=version+1 WHERE id=$1`,
              [input.taskId],
            );
        },
      },
    );
  }

  async complete(
    organizationId: string,
    taskId: string,
    actorId: string,
    warehouseIds: string[],
    correlationId: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const task = await client.query<{ warehouse_id: string }>(
        `SELECT warehouse_id FROM picking_tasks WHERE id=$1 AND organization_id=$2 AND status='PICKING' FOR UPDATE`,
        [taskId, organizationId],
      );
      if (!task.rows[0]) throw new ConflictException('PICKING_TASK_NOT_COMPLETABLE');
      if (!warehouseIds.includes('*') && !warehouseIds.includes(task.rows[0].warehouse_id))
        throw new BadRequestException('Warehouse outside scope');
      const incomplete = await client.query(
        `SELECT 1 FROM picking_task_lines l WHERE l.picking_task_id=$1 AND l.required_quantity <>
         COALESCE((SELECT sum(m.quantity) FROM stock_movements m WHERE m.organization_id=$2
           AND m.reference_type='PICKING_TASK_LINE' AND m.reference_id=l.id AND m.reason_code='PICK'),0) LIMIT 1`,
        [taskId, organizationId],
      );
      if (incomplete.rowCount) throw new ConflictException('PICKING_TASK_INCOMPLETE');
      const updated = await client.query(
        `UPDATE picking_tasks SET status='COMPLETED',version=version+1,completed_at=now()
         WHERE id=$1 RETURNING id,status,version,completed_at`,
        [taskId],
      );
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
         VALUES($1,$2,'picking.completed','picking_task',$3,'{}',$4)`,
        [organizationId, actorId, taskId, correlationId],
      );
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
