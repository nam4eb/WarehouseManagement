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
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/authorization.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { DATABASE_POOL } from '../database/database.module.js';

const shortCode = z.string().trim().min(1).max(80);

@Controller()
@UseGuards(AuthGuard, PermissionGuard)
@RequirePermission('identity.manage')
export class IdentityController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  @Get('users')
  async users(@Req() request: AuthenticatedRequest) {
    const result = await this.pool.query(
      `SELECT u.id,u.email,u.display_name,u.active,u.created_at,
       COALESCE(jsonb_agg(DISTINCT jsonb_build_object('roleId',r.id,'code',r.code,'warehouseId',ur.warehouse_id))
         FILTER(WHERE r.id IS NOT NULL),'[]') roles
       FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
       WHERE u.organization_id=$1 GROUP BY u.id ORDER BY u.email`,
      [request.user.organizationId],
    );
    return result.rows;
  }

  @Post('users')
  async createUser(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z
      .object({
        email: z.email(),
        displayName: z.string().trim().min(1).max(255),
        password: z.string().min(12).max(200),
      })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO users(organization_id,email,display_name,password_hash) VALUES($1,lower($2),$3,$4)
         RETURNING id,email,display_name,active,created_at`,
        [request.user.organizationId, parsed.data.email, parsed.data.displayName, passwordHash],
      );
      await this.audit(request, 'identity.user.created', 'user', result.rows[0].id, client);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Get('roles')
  async roles(@Req() request: AuthenticatedRequest) {
    const result = await this.pool.query(
      `SELECT r.id,r.code,r.name,COALESCE(array_agg(p.code ORDER BY p.code) FILTER(WHERE p.id IS NOT NULL),'{}') permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id
       WHERE r.organization_id=$1 GROUP BY r.id ORDER BY r.code`,
      [request.user.organizationId],
    );
    return result.rows;
  }

  @Post('roles')
  async createRole(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z
      .object({
        code: shortCode,
        name: z.string().trim().min(1).max(255),
        permissions: z.array(shortCode).max(100).default([]),
      })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const role = await client.query(
        `INSERT INTO roles(organization_id,code,name) VALUES($1,$2,$3) RETURNING id,code,name`,
        [request.user.organizationId, parsed.data.code, parsed.data.name],
      );
      const assigned = await client.query(
        `INSERT INTO role_permissions(role_id,permission_id)
         SELECT $1,id FROM permissions WHERE code=ANY($2::text[]) RETURNING permission_id`,
        [role.rows[0].id, parsed.data.permissions],
      );
      if (assigned.rowCount !== new Set(parsed.data.permissions).size)
        throw new BadRequestException('One or more permissions do not exist');
      await this.audit(request, 'identity.role.created', 'role', role.rows[0].id, client, {
        permissions: parsed.data.permissions,
      });
      await client.query('COMMIT');
      return { ...role.rows[0], permissions: parsed.data.permissions };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Post('users/:userId/roles')
  async assignRole(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({ roleId: z.uuid(), warehouseId: z.uuid().nullable().default(null) })
      .safeParse(body);
    if (!z.uuid().safeParse(userId).success || !parsed.success)
      throw new BadRequestException(parsed.success ? 'Invalid user id' : parsed.error.flatten());
    if (
      parsed.data.warehouseId &&
      !request.user.warehouseIds.includes('*') &&
      !request.user.warehouseIds.includes(parsed.data.warehouseId)
    )
      throw new BadRequestException('Warehouse outside scope');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO user_roles(user_id,role_id,warehouse_id)
         SELECT u.id,r.id,$4 FROM users u JOIN roles r ON r.id=$3 AND r.organization_id=$1
         WHERE u.id=$2 AND u.organization_id=$1 ON CONFLICT ON CONSTRAINT user_roles_scope_unique DO NOTHING RETURNING id`,
        [request.user.organizationId, userId, parsed.data.roleId, parsed.data.warehouseId],
      );
      if (!result.rows[0]) throw new BadRequestException('User, role, or assignment not found');
      await this.audit(request, 'identity.role.assigned', 'user', userId, client, {
        roleId: parsed.data.roleId,
        warehouseId: parsed.data.warehouseId,
      });
      await client.query('COMMIT');
      return { assignmentId: result.rows[0].id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Get('devices')
  async devices(@Req() request: AuthenticatedRequest) {
    const result = await this.pool.query(
      `SELECT d.id,d.user_id,u.email,d.fingerprint,d.created_at,d.revoked_at FROM devices d
       LEFT JOIN users u ON u.id=d.user_id WHERE d.organization_id=$1 ORDER BY d.created_at DESC`,
      [request.user.organizationId],
    );
    return result.rows;
  }

  @Post('devices')
  async createDevice(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z
      .object({ userId: z.uuid(), fingerprint: z.string().trim().min(8).max(255) })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO devices(organization_id,user_id,fingerprint)
         SELECT $1,id,$3 FROM users WHERE id=$2 AND organization_id=$1
         RETURNING id,user_id,fingerprint,created_at,revoked_at`,
        [request.user.organizationId, parsed.data.userId, parsed.data.fingerprint],
      );
      if (!result.rows[0]) throw new BadRequestException('User not found');
      await this.audit(request, 'identity.device.created', 'device', result.rows[0].id, client);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Post('devices/:deviceId/revoke')
  async revokeDevice(@Param('deviceId') deviceId: string, @Req() request: AuthenticatedRequest) {
    if (!z.uuid().safeParse(deviceId).success) throw new BadRequestException('Invalid device id');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE devices SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND organization_id=$2 RETURNING id,revoked_at`,
        [deviceId, request.user.organizationId],
      );
      if (!result.rows[0]) throw new BadRequestException('Device not found');
      await client.query(
        'UPDATE refresh_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE device_id=$1',
        [deviceId],
      );
      await this.audit(request, 'identity.device.revoked', 'device', deviceId, client);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async audit(
    request: AuthenticatedRequest,
    action: string,
    entityType: string,
    entityId: string,
    executor: Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'> = this.pool,
    data: object = {},
  ) {
    await executor.query(
      `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        request.user.organizationId,
        request.user.sub,
        action,
        entityType,
        entityId,
        JSON.stringify(data),
        randomUUID(),
      ],
    );
  }
}
