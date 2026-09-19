import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import pg from 'pg';
import { DATABASE_POOL } from './database/database.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  @Get()
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database is not ready');
    }
  }
}
