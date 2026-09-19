import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { createClient, type RedisClientType } from 'redis';
import { DATABASE_POOL } from '../database/database.module.js';

interface OutboxRow {
  id: string;
  organization_id: string;
  topic: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  occurred_at: Date;
  delivery_attempts: number;
}

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly redis: RedisClientType;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {
    this.redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:56379' });
    this.redis.on('error', (error) => this.logger.error(`Redis outbox error: ${error.message}`));
  }

  async onModuleInit() {
    await this.redis.connect();
    void this.processBatch();
    this.timer = setInterval(() => void this.processBatch(), 2_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.redis.isOpen) await this.redis.quit();
  }

  private async processBatch() {
    if (this.running) return;
    this.running = true;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const events = await client.query<OutboxRow>(
        `SELECT id,organization_id,topic,aggregate_type,aggregate_id,payload,occurred_at,delivery_attempts
         FROM outbox_events WHERE published_at IS NULL AND dead_lettered_at IS NULL
           AND next_attempt_at<=now() ORDER BY occurred_at,id LIMIT 50 FOR UPDATE SKIP LOCKED`,
      );
      for (const event of events.rows) {
        try {
          await this.redis.xAdd('wms.events', '*', {
            eventId: event.id,
            organizationId: event.organization_id,
            topic: event.topic,
            aggregateType: event.aggregate_type,
            aggregateId: event.aggregate_id,
            payload: JSON.stringify(event.payload),
            occurredAt: new Date(event.occurred_at).toISOString(),
          });
          await client.query(
            `UPDATE outbox_events SET published_at=now(),last_error=NULL WHERE id=$1`,
            [event.id],
          );
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 2000) : String(error);
          await client.query(
            `UPDATE outbox_events SET delivery_attempts=delivery_attempts+1,last_error=$2,
             next_attempt_at=now()+LEAST(300,power(2,delivery_attempts+1))*interval '1 second',
             dead_lettered_at=CASE WHEN delivery_attempts+1>=10 THEN now() ELSE NULL END WHERE id=$1`,
            [event.id, message],
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(error instanceof Error ? error.stack : String(error));
    } finally {
      client.release();
      this.running = false;
    }
  }
}
