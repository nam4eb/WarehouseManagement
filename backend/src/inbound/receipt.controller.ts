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
import { ReceiptService } from './receipt.service.js';

@Controller('receipts')
@UseGuards(AuthGuard, PermissionGuard)
export class ReceiptController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: pg.Pool,
    private readonly receipts: ReceiptService,
  ) {}

  @Post()
  @RequirePermission('inbound.manage')
  async create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z
      .object({
        warehouseId: z.uuid(),
        supplierLocationId: z.uuid(),
        receivingLocationId: z.uuid(),
        referenceNumber: z.string().trim().min(1).max(120),
        lines: z
          .array(
            z.object({
              productId: z.uuid(),
              expectedQuantity: z.number().positive(),
              conditionCode: z.string().trim().min(1).max(80).default('NEW'),
            }),
          )
          .min(1)
          .max(500),
      })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const allowed =
      request.user.warehouseIds.includes('*') ||
      request.user.warehouseIds.includes(parsed.data.warehouseId);
    if (!allowed) throw new BadRequestException('Warehouse outside scope');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const receipt = await client.query(
        `INSERT INTO purchase_receipts(organization_id,warehouse_id,supplier_location_id,receiving_location_id,reference_number,created_by)
         SELECT $1,w.id,s.id,r.id,$5,$6 FROM warehouses w JOIN locations s ON s.id=$3 AND s.type='SUPPLIER'
         JOIN locations r ON r.id=$4 AND r.type='RECEIVING' WHERE w.id=$2 AND w.organization_id=$1
           AND s.warehouse_id=w.id AND r.warehouse_id=w.id RETURNING id,status,version,reference_number,created_at`,
        [
          request.user.organizationId,
          parsed.data.warehouseId,
          parsed.data.supplierLocationId,
          parsed.data.receivingLocationId,
          parsed.data.referenceNumber,
          request.user.sub,
        ],
      );
      if (!receipt.rows[0]) throw new BadRequestException('Invalid warehouse or receipt locations');
      for (const line of parsed.data.lines) {
        const inserted = await client.query(
          `INSERT INTO purchase_receipt_lines(receipt_id,product_id,expected_quantity,condition_code)
           SELECT $1,id,$3,$4 FROM products WHERE id=$2 AND organization_id=$5 RETURNING id`,
          [
            receipt.rows[0].id,
            line.productId,
            line.expectedQuantity,
            line.conditionCode,
            request.user.organizationId,
          ],
        );
        if (!inserted.rowCount) throw new BadRequestException('Receipt product not found');
      }
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
         VALUES($1,$2,'receipt.created','purchase_receipt',$3,$4,$5)`,
        [
          request.user.organizationId,
          request.user.sub,
          receipt.rows[0].id,
          JSON.stringify({ referenceNumber: parsed.data.referenceNumber }),
          randomUUID(),
        ],
      );
      await client.query('COMMIT');
      return receipt.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Get()
  @RequirePermission('inventory.read')
  async list(@Req() request: AuthenticatedRequest) {
    const all = request.user.warehouseIds.includes('*');
    const result = await this.pool.query(
      `SELECT r.id,r.reference_number,r.status,r.version,r.created_at,r.confirmed_at,r.warehouse_id,
       jsonb_agg(jsonb_build_object('id',l.id,'productId',l.product_id,'expected',l.expected_quantity,
         'actual',COALESCE(a.actual,0),'variance',COALESCE(a.actual,0)-l.expected_quantity) ORDER BY l.created_at) lines
       FROM purchase_receipts r JOIN purchase_receipt_lines l ON l.receipt_id=r.id
       LEFT JOIN LATERAL (SELECT sum(m.quantity) actual FROM stock_movements m
         WHERE m.reference_type='PURCHASE_RECEIPT_LINE' AND m.reference_id=l.id AND m.reason_code='RECEIPT') a ON true
       WHERE r.organization_id=$1 AND ($2::boolean OR r.warehouse_id=ANY($3::uuid[])) GROUP BY r.id ORDER BY r.created_at DESC`,
      [request.user.organizationId, all, all ? [] : request.user.warehouseIds],
    );
    return result.rows;
  }

  @Post(':receiptId/scan')
  @RequirePermission('inbound.receive')
  async scan(
    @Param('receiptId') receiptId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({
        lineId: z.uuid(),
        quantity: z.number().positive(),
        serialNumber: z.string().trim().min(1).max(255).optional(),
        conditionCode: z.string().trim().min(1).max(80).default('NEW'),
        clientOccurredAt: z.iso.datetime(),
      })
      .safeParse(body);
    if (
      !z.uuid().safeParse(receiptId).success ||
      !z.uuid().safeParse(key).success ||
      !parsed.success
    )
      throw new BadRequestException('Invalid receipt scan command');
    return this.receipts.receive({
      receiptId,
      lineId: parsed.data.lineId,
      quantity: parsed.data.quantity,
      serialNumber: parsed.data.serialNumber,
      conditionCode: parsed.data.conditionCode,
      warehouseIds: request.user.warehouseIds,
      command: {
        idempotencyKey: key!,
        organizationId: request.user.organizationId,
        reasonCode: 'RECEIPT',
        actorId: request.user.sub,
        deviceId: request.user.deviceId,
        clientOccurredAt: parsed.data.clientOccurredAt,
        correlationId: randomUUID(),
      },
    });
  }

  @Post(':receiptId/confirm')
  @RequirePermission('inbound.confirm')
  confirm(@Param('receiptId') receiptId: string, @Req() request: AuthenticatedRequest) {
    if (!z.uuid().safeParse(receiptId).success) throw new BadRequestException('Invalid receipt id');
    return this.receipts.confirm(
      request.user.organizationId,
      receiptId,
      request.user.sub,
      randomUUID(),
    );
  }

  @Post(':receiptId/put-away')
  @RequirePermission('inbound.receive')
  async putAway(
    @Param('receiptId') receiptId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({
        lineId: z.uuid(),
        destinationLocationId: z.uuid(),
        quantity: z.number().positive(),
        serialItemId: z.uuid().optional(),
        clientOccurredAt: z.iso.datetime(),
      })
      .safeParse(body);
    if (
      !z.uuid().safeParse(receiptId).success ||
      !z.uuid().safeParse(key).success ||
      !parsed.success
    )
      throw new BadRequestException('Invalid put-away command');
    return this.receipts.putAway({
      receiptId,
      ...parsed.data,
      warehouseIds: request.user.warehouseIds,
      command: {
        idempotencyKey: key!,
        organizationId: request.user.organizationId,
        reasonCode: 'PUT_AWAY',
        actorId: request.user.sub,
        deviceId: request.user.deviceId,
        clientOccurredAt: parsed.data.clientOccurredAt,
        correlationId: randomUUID(),
      },
    });
  }
}
