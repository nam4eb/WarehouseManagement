import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DATABASE_POOL } from '../database/database.module.js';
import type { MovementCommand } from '../inventory/domain.js';
import { PostgresMovementLedger } from '../inventory/postgres-ledger.js';

interface ReceiptLineContext {
  line_id: string;
  product_id: string;
  serial_required: boolean;
  status: string;
  supplier_location_id: string;
  receiving_location_id: string;
  warehouse_id: string;
}

@Injectable()
export class ReceiptService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: pg.Pool,
    private readonly ledger: PostgresMovementLedger,
  ) {}

  async lineContext(
    organizationId: string,
    receiptId: string,
    lineId: string,
  ): Promise<ReceiptLineContext> {
    const result = await this.pool.query<ReceiptLineContext>(
      `SELECT l.id line_id,l.product_id,p.serial_required,r.status,r.supplier_location_id,
       r.receiving_location_id,r.warehouse_id FROM purchase_receipt_lines l
       JOIN purchase_receipts r ON r.id=l.receipt_id JOIN products p ON p.id=l.product_id
       WHERE r.organization_id=$1 AND r.id=$2 AND l.id=$3`,
      [organizationId, receiptId, lineId],
    );
    if (!result.rows[0]) throw new NotFoundException('RECEIPT_LINE_NOT_FOUND');
    return result.rows[0];
  }

  async receive(input: {
    receiptId: string;
    lineId: string;
    quantity: number;
    serialNumber?: string;
    conditionCode: string;
    warehouseIds: string[];
    command: Omit<
      MovementCommand,
      'productId' | 'sourceLocationId' | 'destinationLocationId' | 'quantity' | 'serialItemId'
    >;
  }) {
    const context = await this.lineContext(
      input.command.organizationId,
      input.receiptId,
      input.lineId,
    );
    if (!input.warehouseIds.includes('*') && !input.warehouseIds.includes(context.warehouse_id))
      throw new BadRequestException('Warehouse outside scope');
    if (context.serial_required && (!input.serialNumber || input.quantity !== 1))
      throw new BadRequestException('Serialized receipt requires one serial and quantity 1');
    if (!context.serial_required && input.serialNumber)
      throw new BadRequestException('Serial supplied for a non-serialized product');
    const serialItemId = input.serialNumber ? randomUUID() : undefined;
    return this.ledger.execute(
      {
        ...input.command,
        productId: context.product_id,
        sourceLocationId: context.supplier_location_id,
        destinationLocationId: context.receiving_location_id,
        quantity: input.quantity,
        serialItemId,
        referenceType: 'PURCHASE_RECEIPT_LINE',
        referenceId: input.lineId,
        reasonCode: 'RECEIPT',
      },
      {
        validate: async (client) => {
          const locked = await client.query<{ status: string }>(
            'SELECT status FROM purchase_receipts WHERE id=$1 AND organization_id=$2 FOR UPDATE',
            [input.receiptId, input.command.organizationId],
          );
          if (!locked.rows[0] || !['DRAFT', 'RECEIVING'].includes(locked.rows[0].status))
            throw new ConflictException('RECEIPT_NOT_RECEIVABLE');
          if (locked.rows[0].status === 'DRAFT')
            await client.query(
              `UPDATE purchase_receipts SET status='RECEIVING',version=version+1 WHERE id=$1`,
              [input.receiptId],
            );
          if (serialItemId)
            await client.query(
              `INSERT INTO serial_items(id,organization_id,product_id,serial_number,current_location_id,condition_code)
           VALUES($1,$2,$3,$4,$5,$6)`,
              [
                serialItemId,
                input.command.organizationId,
                context.product_id,
                input.serialNumber,
                context.supplier_location_id,
                input.conditionCode,
              ],
            );
        },
      },
    );
  }

  async putAway(input: {
    receiptId: string;
    lineId: string;
    destinationLocationId: string;
    quantity: number;
    serialItemId?: string;
    warehouseIds: string[];
    command: Omit<
      MovementCommand,
      'productId' | 'sourceLocationId' | 'destinationLocationId' | 'quantity' | 'serialItemId'
    >;
  }) {
    const context = await this.lineContext(
      input.command.organizationId,
      input.receiptId,
      input.lineId,
    );
    if (!input.warehouseIds.includes('*') && !input.warehouseIds.includes(context.warehouse_id))
      throw new BadRequestException('Warehouse outside scope');
    return this.ledger.execute(
      {
        ...input.command,
        productId: context.product_id,
        sourceLocationId: context.receiving_location_id,
        destinationLocationId: input.destinationLocationId,
        quantity: input.quantity,
        serialItemId: input.serialItemId,
        referenceType: 'PURCHASE_RECEIPT_LINE',
        referenceId: input.lineId,
        reasonCode: 'PUT_AWAY',
      },
      {
        validate: async (client) => {
          const result = await client.query(
            `SELECT 1 FROM purchase_receipts r JOIN locations l ON l.id=$3
           WHERE r.id=$1 AND r.organization_id=$2 AND r.status='CONFIRMED'
             AND l.organization_id=$2 AND l.warehouse_id=r.warehouse_id AND l.type IN ('AVAILABLE','RACK') FOR UPDATE OF r`,
            [input.receiptId, input.command.organizationId, input.destinationLocationId],
          );
          if (!result.rowCount) throw new ConflictException('PUT_AWAY_NOT_ALLOWED');
          const allocation = await client.query<{ available: string }>(
            `SELECT COALESCE(sum(CASE WHEN reason_code='RECEIPT' THEN quantity
            WHEN reason_code='PUT_AWAY' THEN -quantity ELSE 0 END),0) available
           FROM stock_movements WHERE organization_id=$1 AND product_id=$2
             AND reference_type='PURCHASE_RECEIPT_LINE' AND reference_id=$3`,
            [input.command.organizationId, context.product_id, input.lineId],
          );
          if (Number(allocation.rows[0]!.available) < input.quantity)
            throw new ConflictException('RECEIPT_LINE_QUANTITY_EXHAUSTED');
          if (input.serialItemId) {
            const serialReceipt = await client.query(
              `SELECT 1 FROM stock_movements WHERE organization_id=$1 AND serial_item_id=$2
             AND reference_type='PURCHASE_RECEIPT_LINE' AND reference_id=$3 AND reason_code='RECEIPT'`,
              [input.command.organizationId, input.serialItemId, input.lineId],
            );
            if (!serialReceipt.rowCount) throw new ConflictException('SERIAL_NOT_RECEIVED_ON_LINE');
          }
        },
      },
    );
  }

  async confirm(organizationId: string, receiptId: string, actorId: string, correlationId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const receipt = await client.query(
        `UPDATE purchase_receipts SET status='CONFIRMED',version=version+1,confirmed_at=now()
         WHERE id=$1 AND organization_id=$2 AND status='RECEIVING' RETURNING id,status,version,confirmed_at`,
        [receiptId, organizationId],
      );
      if (!receipt.rows[0]) throw new ConflictException('RECEIPT_NOT_CONFIRMABLE');
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
         VALUES($1,$2,'receipt.confirmed','purchase_receipt',$3,'{}',$4)`,
        [organizationId, actorId, receiptId, correlationId],
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
}
