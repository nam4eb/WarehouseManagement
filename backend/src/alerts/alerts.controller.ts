import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
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

@Controller('alerts')
@UseGuards(AuthGuard, PermissionGuard)
export class AlertsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  @Get()
  @RequirePermission('inventory.read')
  async list(@Query('status') status: string | undefined, @Req() request: AuthenticatedRequest) {
    const parsed = z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional().safeParse(status);
    if (!parsed.success) throw new BadRequestException('Invalid alert status');
    const all = request.user.warehouseIds.includes('*');
    const result = await this.pool.query(
      `SELECT a.*,l.code trip_code,u.display_name acknowledged_by_name
       FROM operational_alerts a JOIN trips t ON t.id=a.trip_id JOIN locations l ON l.id=t.trip_location_id
       LEFT JOIN users u ON u.id=a.acknowledged_by
       WHERE a.organization_id=$1 AND ($2::text IS NULL OR a.status=$2)
         AND ($3::boolean OR a.warehouse_id=ANY($4::uuid[]))
       ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 0 ELSE 1 END,a.created_at DESC LIMIT 100`,
      [request.user.organizationId, parsed.data ?? null, all, all ? [] : request.user.warehouseIds],
    );
    return result.rows;
  }

  @Post(':alertId/acknowledge')
  @RequirePermission('outbound.manage')
  async acknowledge(
    @Param('alertId') alertId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z.object({ note: z.string().trim().min(3).max(1000) }).safeParse(body);
    if (!z.uuid().safeParse(alertId).success || !parsed.success)
      throw new BadRequestException('Invalid alert acknowledgement');
    const all = request.user.warehouseIds.includes('*');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE operational_alerts SET status='ACKNOWLEDGED',acknowledged_by=$3,acknowledged_at=now(),
           acknowledgement_note=$4,updated_at=now()
         WHERE id=$1 AND organization_id=$2 AND status='OPEN' AND ($5::boolean OR warehouse_id=ANY($6::uuid[]))
         RETURNING id,trip_id,status,acknowledged_at`,
        [
          alertId,
          request.user.organizationId,
          request.user.sub,
          parsed.data.note,
          all,
          all ? [] : request.user.warehouseIds,
        ],
      );
      if (!result.rows[0]) throw new BadRequestException('ALERT_NOT_OPEN_OR_OUTSIDE_SCOPE');
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
         VALUES($1,$2,'operational_alert.acknowledged','operational_alert',$3,$4,gen_random_uuid())`,
        [
          request.user.organizationId,
          request.user.sub,
          alertId,
          JSON.stringify({ note: parsed.data.note, tripId: result.rows[0].trip_id }),
        ],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
