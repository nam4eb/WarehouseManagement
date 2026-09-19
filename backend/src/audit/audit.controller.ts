import {
  BadRequestException,
  Controller,
  Get,
  Inject,
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

@Controller('audit-events')
@UseGuards(AuthGuard, PermissionGuard)
@RequirePermission('audit.read')
export class AuditController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}
  @Get()
  async list(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    const parsed = z
      .object({
        entityType: z.string().max(80).optional(),
        entityId: z.uuid().optional(),
        before: z.iso.datetime().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      })
      .safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const result = await this.pool.query(
      `SELECT id,actor_id,action,entity_type,entity_id,data,correlation_id,occurred_at
       FROM audit_events WHERE organization_id=$1 AND ($2::text IS NULL OR entity_type=$2)
       AND ($3::uuid IS NULL OR entity_id=$3) AND ($4::timestamptz IS NULL OR occurred_at<$4)
       ORDER BY occurred_at DESC,id DESC LIMIT $5`,
      [
        request.user.organizationId,
        parsed.data.entityType ?? null,
        parsed.data.entityId ?? null,
        parsed.data.before ?? null,
        parsed.data.limit,
      ],
    );
    return result.rows;
  }
}
