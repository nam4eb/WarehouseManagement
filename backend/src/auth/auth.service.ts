import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DATABASE_POOL } from '../database/database.module.js';
import { TokenService } from './token.service.js';

interface PrincipalRow {
  user_id: string;
  organization_id: string;
  password_hash: string;
  device_id: string;
  device_revoked_at: Date | null;
  permissions: string[];
  warehouse_ids: string[];
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: pg.Pool,
    private readonly tokens: TokenService,
  ) {}

  async login(input: {
    organizationCode: string;
    email: string;
    password: string;
    deviceFingerprint: string;
  }) {
    const principal = await this.pool.query<PrincipalRow>(
      `SELECT u.id user_id,u.organization_id,u.password_hash,d.id device_id,d.revoked_at device_revoked_at,
       COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL),'{}') permissions,
       COALESCE(array_agg(DISTINCT COALESCE(ur.warehouse_id::text,'*')) FILTER (WHERE ur.id IS NOT NULL),'{}') warehouse_ids
       FROM users u JOIN organizations o ON o.id=u.organization_id
       JOIN devices d ON d.user_id=u.id AND d.fingerprint=$3
       LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN role_permissions rp ON rp.role_id=ur.role_id
       LEFT JOIN permissions p ON p.id=rp.permission_id
       WHERE o.code=$1 AND lower(u.email)=lower($2) AND u.active=true
       GROUP BY u.id,d.id`,
      [input.organizationCode, input.email, input.deviceFingerprint],
    );
    const row = principal.rows[0];
    if (
      !row ||
      row.device_revoked_at ||
      !(await bcrypt.compare(input.password, row.password_hash))
    ) {
      throw new UnauthorizedException('Invalid credentials or device');
    }
    return this.createSession(row, randomUUID());
  }

  async refresh(refreshToken: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const hash = this.tokens.hashRefreshToken(refreshToken);
      const session = await client.query<{
        session_id: string;
        family_id: string;
        rotated_at: Date | null;
        revoked_at: Date | null;
        expires_at: Date;
        user_id: string;
        device_id: string;
      }>(
        `SELECT id session_id,family_id,rotated_at,revoked_at,expires_at,user_id,device_id
         FROM refresh_sessions WHERE token_hash=$1 FOR UPDATE`,
        [hash],
      );
      const locked = session.rows[0];
      if (!locked || locked.revoked_at || locked.expires_at <= new Date())
        throw new UnauthorizedException('Invalid refresh token');
      if (locked.rotated_at) {
        await client.query(
          'UPDATE refresh_sessions SET revoked_at=now() WHERE family_id=$1 AND revoked_at IS NULL',
          [locked.family_id],
        );
        await client.query('COMMIT');
        throw new UnauthorizedException('Refresh token reuse detected');
      }
      const principal = await client.query<PrincipalRow>(
        `SELECT u.id user_id,u.organization_id,u.password_hash,d.id device_id,d.revoked_at device_revoked_at,
         COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL),'{}') permissions,
         COALESCE(array_agg(DISTINCT COALESCE(ur.warehouse_id::text,'*')) FILTER (WHERE ur.id IS NOT NULL),'{}') warehouse_ids
         FROM users u JOIN devices d ON d.id=$2 AND d.user_id=u.id
         LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN role_permissions rp ON rp.role_id=ur.role_id
         LEFT JOIN permissions p ON p.id=rp.permission_id WHERE u.id=$1 AND u.active=true GROUP BY u.id,d.id`,
        [locked.user_id, locked.device_id],
      );
      const row = principal.rows[0];
      if (!row || row.device_revoked_at) throw new UnauthorizedException('Invalid refresh token');
      await client.query('UPDATE refresh_sessions SET rotated_at=now() WHERE id=$1', [
        locked.session_id,
      ]);
      const result = await this.createSession(row, locked.family_id, client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* transaction may already be committed for reuse revocation */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async createSession(
    row: PrincipalRow,
    familyId: string,
    client: pg.PoolClient | pg.Pool = this.pool,
  ) {
    const refresh = this.tokens.newRefreshToken();
    await client.query(
      `INSERT INTO refresh_sessions(organization_id,user_id,device_id,token_hash,family_id,expires_at)
       VALUES($1,$2,$3,$4,$5,now()+interval '30 days')`,
      [row.organization_id, row.user_id, row.device_id, refresh.hash, familyId],
    );
    return {
      accessToken: this.tokens.issueAccess({
        sub: row.user_id,
        organizationId: row.organization_id,
        deviceId: row.device_id,
        permissions: row.permissions,
        warehouseIds: row.warehouse_ids,
      }),
      refreshToken: refresh.token,
      expiresIn: 900,
    };
  }
}
