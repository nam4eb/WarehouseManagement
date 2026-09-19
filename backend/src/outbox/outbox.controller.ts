import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import pg from 'pg';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/authorization.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { DATABASE_POOL } from '../database/database.module.js';

@Controller('outbox')
@UseGuards(AuthGuard, PermissionGuard)
export class OutboxController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  @Get('status')
  @RequirePermission('audit.read')
  async status(@Req() request: AuthenticatedRequest) {
    const summary = await this.pool.query(
      `SELECT count(*) FILTER(WHERE published_at IS NULL AND dead_lettered_at IS NULL) pending,
       count(*) FILTER(WHERE published_at IS NOT NULL) published,
       count(*) FILTER(WHERE dead_lettered_at IS NOT NULL) dead_lettered,
       COALESCE(max(delivery_attempts),0) max_attempts
       FROM outbox_events WHERE organization_id=$1`,
      [request.user.organizationId],
    );
    const failures = await this.pool.query(
      `SELECT id,topic,aggregate_type,aggregate_id,delivery_attempts,last_error,next_attempt_at,dead_lettered_at
       FROM outbox_events WHERE organization_id=$1 AND last_error IS NOT NULL
       ORDER BY COALESCE(dead_lettered_at,next_attempt_at) DESC LIMIT 20`,
      [request.user.organizationId],
    );
    const row = summary.rows[0]!;
    return {
      pending: Number(row.pending),
      published: Number(row.published),
      deadLettered: Number(row.dead_lettered),
      maxAttempts: Number(row.max_attempts),
      failures: failures.rows,
    };
  }
}
