import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
import { PickingService } from './picking.service.js';

@Controller()
@UseGuards(AuthGuard, PermissionGuard)
export class PickingController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: pg.Pool,
    private readonly picking: PickingService,
  ) {}

  @Post('sales-orders')
  @RequirePermission('outbound.manage')
  async createOrder(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z
      .object({
        warehouseId: z.uuid(),
        customerLocationId: z.uuid(),
        stagingLocationId: z.uuid(),
        orderNumber: z.string().trim().min(1).max(120),
        lines: z
          .array(z.object({ productId: z.uuid(), quantity: z.number().positive() }))
          .min(1)
          .max(500),
      })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (
      !request.user.warehouseIds.includes('*') &&
      !request.user.warehouseIds.includes(parsed.data.warehouseId)
    )
      throw new BadRequestException('Warehouse outside scope');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await client.query(
        `INSERT INTO sales_orders(organization_id,warehouse_id,customer_location_id,order_number,created_by)
         SELECT $1,w.id,c.id,$4,$5 FROM warehouses w JOIN locations c ON c.id=$3 AND c.type='CUSTOMER'
         WHERE w.id=$2 AND w.organization_id=$1 AND c.organization_id=$1 RETURNING id,order_number,status,created_at`,
        [
          request.user.organizationId,
          parsed.data.warehouseId,
          parsed.data.customerLocationId,
          parsed.data.orderNumber,
          request.user.sub,
        ],
      );
      if (!order.rows[0]) throw new BadRequestException('Invalid warehouse or customer');
      const task = await client.query(
        `INSERT INTO picking_tasks(organization_id,warehouse_id,sales_order_id,staging_location_id)
         SELECT $1,$2,$3,l.id FROM locations l WHERE l.id=$4 AND l.organization_id=$1
           AND l.warehouse_id=$2 AND l.type='OUTBOUND_STAGING' RETURNING id,status,version,staging_location_id`,
        [
          request.user.organizationId,
          parsed.data.warehouseId,
          order.rows[0].id,
          parsed.data.stagingLocationId,
        ],
      );
      if (!task.rows[0]) throw new BadRequestException('Invalid staging location');
      for (const line of parsed.data.lines) {
        const orderLine = await client.query(
          `INSERT INTO sales_order_lines(sales_order_id,product_id,ordered_quantity)
           SELECT $1,id,$3 FROM products WHERE id=$2 AND organization_id=$4 RETURNING id,product_id,ordered_quantity`,
          [order.rows[0].id, line.productId, line.quantity, request.user.organizationId],
        );
        if (!orderLine.rows[0]) throw new BadRequestException('Order product not found');
        const components = await client.query<{
          is_bundle: boolean;
          component_product_id: string | null;
          quantity: string | null;
        }>(
          `SELECT p.is_bundle,pc.component_product_id,pc.quantity FROM products p
           LEFT JOIN product_components pc ON pc.bundle_product_id=p.id WHERE p.id=$1 ORDER BY pc.component_role`,
          [line.productId],
        );
        if (components.rows[0]?.is_bundle && !components.rows[0].component_product_id)
          throw new BadRequestException('Bundle has no configured components');
        const requirements = components.rows[0]?.is_bundle
          ? components.rows.map((component) => ({
              productId: component.component_product_id!,
              quantity: line.quantity * Number(component.quantity),
            }))
          : [{ productId: line.productId, quantity: line.quantity }];
        for (const requirement of requirements)
          await client.query(
            `INSERT INTO picking_task_lines(picking_task_id,sales_order_line_id,product_id,required_quantity)
           VALUES($1,$2,$3,$4)`,
            [task.rows[0].id, orderLine.rows[0].id, requirement.productId, requirement.quantity],
          );
      }
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
         VALUES($1,$2,'sales_order.created','sales_order',$3,$4,$5)`,
        [
          request.user.organizationId,
          request.user.sub,
          order.rows[0].id,
          JSON.stringify({ pickingTaskId: task.rows[0].id }),
          randomUUID(),
        ],
      );
      await client.query('COMMIT');
      return { ...order.rows[0], pickingTaskId: task.rows[0].id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Get('picking-tasks')
  @RequirePermission('inventory.read')
  async tasks(@Req() request: AuthenticatedRequest) {
    const all = request.user.warehouseIds.includes('*');
    const result = await this.pool.query(
      `SELECT t.id,t.sales_order_id,o.order_number,t.status,t.version,t.staging_location_id,t.created_at,t.completed_at,
       jsonb_agg(jsonb_build_object('id',l.id,'productId',l.product_id,'required',l.required_quantity,
         'picked',COALESCE(p.quantity,0)) ORDER BY l.id) lines
       FROM picking_tasks t JOIN sales_orders o ON o.id=t.sales_order_id JOIN picking_task_lines l ON l.picking_task_id=t.id
       LEFT JOIN LATERAL (SELECT sum(m.quantity) quantity FROM stock_movements m WHERE m.organization_id=t.organization_id
         AND m.reference_type='PICKING_TASK_LINE' AND m.reference_id=l.id AND m.reason_code='PICK') p ON true
       WHERE t.organization_id=$1 AND ($2::boolean OR t.warehouse_id=ANY($3::uuid[])) GROUP BY t.id,o.order_number
       ORDER BY t.created_at DESC`,
      [request.user.organizationId, all, all ? [] : request.user.warehouseIds],
    );
    return result.rows;
  }

  @Post('picking-tasks/:taskId/scan')
  @RequirePermission('outbound.pick')
  scan(
    @Param('taskId') taskId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({
        lineId: z.uuid(),
        sourceLocationId: z.uuid(),
        quantity: z.number().positive(),
        serialItemId: z.uuid().optional(),
        clientOccurredAt: z.iso.datetime(),
      })
      .safeParse(body);
    if (!z.uuid().safeParse(taskId).success || !z.uuid().safeParse(key).success || !parsed.success)
      throw new BadRequestException('Invalid pick scan command');
    return this.picking.scan({
      taskId,
      ...parsed.data,
      warehouseIds: request.user.warehouseIds,
      command: {
        idempotencyKey: key!,
        organizationId: request.user.organizationId,
        reasonCode: 'PICK',
        actorId: request.user.sub,
        deviceId: request.user.deviceId,
        clientOccurredAt: parsed.data.clientOccurredAt,
        correlationId: randomUUID(),
      },
    });
  }

  @Post('picking-tasks/:taskId/complete')
  @RequirePermission('outbound.pick')
  complete(@Param('taskId') taskId: string, @Req() request: AuthenticatedRequest) {
    if (!z.uuid().safeParse(taskId).success)
      throw new BadRequestException('Invalid picking task id');
    return this.picking.complete(
      request.user.organizationId,
      taskId,
      request.user.sub,
      request.user.warehouseIds,
      randomUUID(),
    );
  }
}
