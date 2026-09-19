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
import pg from 'pg';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/authorization.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { DATABASE_POOL } from '../database/database.module.js';

const code = z.string().trim().min(1).max(80);
const name = z.string().trim().min(1).max(255);

@Controller()
@UseGuards(AuthGuard, PermissionGuard)
export class CatalogController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  @Get('warehouses')
  @RequirePermission('inventory.read')
  async warehouses(@Req() request: AuthenticatedRequest) {
    const all = request.user.warehouseIds.includes('*');
    const result = await this.pool.query(
      `SELECT id,code,name,created_at FROM warehouses
       WHERE organization_id=$1 AND ($2::boolean OR id=ANY($3::uuid[])) ORDER BY code`,
      [request.user.organizationId, all, all ? [] : request.user.warehouseIds],
    );
    return result.rows;
  }

  @Get('locations')
  @RequirePermission('inventory.read')
  async locations(@Req() request: AuthenticatedRequest) {
    const all = request.user.warehouseIds.includes('*');
    const result = await this.pool.query(
      `SELECT id,warehouse_id,parent_id,type,code,name,tracks_balance,active FROM locations
       WHERE organization_id=$1 AND ($2::boolean OR warehouse_id=ANY($3::uuid[])) ORDER BY code`,
      [request.user.organizationId, all, all ? [] : request.user.warehouseIds],
    );
    return result.rows;
  }

  @Post('locations')
  @RequirePermission('catalog.manage')
  async createLocation(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z
      .object({
        warehouseId: z.uuid(),
        parentId: z.uuid().optional(),
        type: z.enum([
          'SUPPLIER',
          'RECEIVING',
          'AVAILABLE',
          'RACK',
          'OUTBOUND_STAGING',
          'TRIP',
          'CUSTOMER',
          'RETURN_QUARANTINE',
          'OPEN_BOX',
          'DAMAGED',
          'WARRANTY',
          'RETURN_TO_VENDOR',
        ]),
        code,
        name,
      })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (
      !request.user.warehouseIds.includes('*') &&
      !request.user.warehouseIds.includes(parsed.data.warehouseId)
    )
      throw new BadRequestException('Warehouse is outside scope');
    const result = await this.pool.query(
      `INSERT INTO locations(organization_id,warehouse_id,parent_id,type,code,name,tracks_balance)
       SELECT $1,$2,$3,$4,$5,$6,($4::location_type NOT IN ('SUPPLIER','RETURN_TO_VENDOR')) WHERE EXISTS(
         SELECT 1 FROM warehouses WHERE id=$2 AND organization_id=$1)
       RETURNING id,warehouse_id,parent_id,type,code,name,active`,
      [
        request.user.organizationId,
        parsed.data.warehouseId,
        parsed.data.parentId ?? null,
        parsed.data.type,
        parsed.data.code,
        parsed.data.name,
      ],
    );
    if (!result.rows[0]) throw new BadRequestException('Warehouse not found');
    return result.rows[0];
  }

  @Get('products')
  @RequirePermission('inventory.read')
  async products(@Req() request: AuthenticatedRequest) {
    const result = await this.pool.query(
      `SELECT p.id,p.sku,p.name,p.serial_required,
       COALESCE(array_agg(b.barcode ORDER BY b.barcode) FILTER(WHERE b.id IS NOT NULL),'{}') barcodes
       FROM products p LEFT JOIN product_barcodes b ON b.product_id=p.id
       WHERE p.organization_id=$1 GROUP BY p.id ORDER BY p.sku`,
      [request.user.organizationId],
    );
    return result.rows;
  }

  @Post('products')
  @RequirePermission('catalog.manage')
  async createProduct(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z
      .object({
        sku: code,
        name,
        serialRequired: z.boolean().default(false),
        barcodes: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
      })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (new Set(parsed.data.barcodes).size !== parsed.data.barcodes.length)
      throw new BadRequestException('Duplicate barcode in request');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const product = await client.query(
        `INSERT INTO products(organization_id,sku,name,serial_required) VALUES($1,$2,$3,$4)
         RETURNING id,sku,name,serial_required`,
        [
          request.user.organizationId,
          parsed.data.sku,
          parsed.data.name,
          parsed.data.serialRequired,
        ],
      );
      for (const barcode of parsed.data.barcodes)
        await client.query(
          'INSERT INTO product_barcodes(organization_id,product_id,barcode) VALUES($1,$2,$3)',
          [request.user.organizationId, product.rows[0].id, barcode],
        );
      await client.query('COMMIT');
      return { ...product.rows[0], barcodes: parsed.data.barcodes };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Post('products/:productId/serials')
  @RequirePermission('catalog.manage')
  async createSerial(
    @Param('productId') productId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({
        serialNumber: z.string().trim().min(1).max(255),
        locationId: z.uuid(),
        conditionCode: code.default('NEW'),
      })
      .safeParse(body);
    if (!z.uuid().safeParse(productId).success || !parsed.success)
      throw new BadRequestException(parsed.success ? 'Invalid product id' : parsed.error.flatten());
    const result = await this.pool.query(
      `INSERT INTO serial_items(organization_id,product_id,serial_number,current_location_id,condition_code)
       SELECT $1,p.id,$3,l.id,$4 FROM products p JOIN locations l ON l.id=$5 AND l.organization_id=$1
       WHERE p.id=$2 AND p.organization_id=$1 AND p.serial_required=true
       RETURNING id,product_id,serial_number,current_location_id,condition_code,status,version`,
      [
        request.user.organizationId,
        productId,
        parsed.data.serialNumber,
        parsed.data.conditionCode,
        parsed.data.locationId,
      ],
    );
    if (!result.rows[0]) throw new BadRequestException('Serialized product or location not found');
    return result.rows[0];
  }
}
