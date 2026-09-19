import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import pg from 'pg';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { DATABASE_POOL } from '../database/database.module.js';

@Controller('scan')
@UseGuards(AuthGuard)
export class ScanController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}
  @Post('resolve')
  async resolve(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z.object({ code: z.string().trim().min(1).max(255) }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const result = await this.pool.query(
      `SELECT p.id product_id,p.sku,p.name,s.id serial_item_id,s.serial_number,s.current_location_id
       FROM products p LEFT JOIN product_barcodes b ON b.product_id=p.id
       LEFT JOIN serial_items s ON s.product_id=p.id AND s.serial_number=$2
       WHERE p.organization_id=$1 AND (p.sku=$2 OR b.barcode=$2 OR s.serial_number=$2)
       ORDER BY CASE WHEN s.serial_number=$2 THEN 0 ELSE 1 END LIMIT 1`,
      [request.user.organizationId, parsed.data.code],
    );
    if (!result.rows[0]) throw new NotFoundException('SCAN_NOT_FOUND');
    return result.rows[0];
  }
}
