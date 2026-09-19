import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { DATABASE_POOL } from '../database/database.module.js';

@Injectable()
export class AlertsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  onModuleInit() {
    void this.scan();
    this.timer = setInterval(() => void this.scan(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async scan() {
    if (this.running) return;
    this.running = true;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO operational_alerts(organization_id,warehouse_id,alert_type,severity,fingerprint,
           trip_id,customer_location_id,title,message)
         SELECT t.organization_id,t.warehouse_id,'STOP_OVERDUE',
           CASE WHEN now()-ts.expected_arrival_at>interval '2 hours' THEN 'CRITICAL' ELSE 'WARNING' END,
           'STOP_OVERDUE:'||t.id||':'||ts.customer_location_id,t.id,ts.customer_location_id,
           'Điểm giao quá hạn',l.code||' · '||cl.name||' chưa có POD hoặc kết quả ngoại lệ'
         FROM trip_stops ts JOIN trips t ON t.id=ts.trip_id JOIN locations l ON l.id=t.trip_location_id
         JOIN locations cl ON cl.id=ts.customer_location_id
         LEFT JOIN delivery_proofs dp ON dp.trip_id=t.id AND dp.customer_location_id=ts.customer_location_id
         LEFT JOIN delivery_stop_exceptions se ON se.trip_id=t.id AND se.customer_location_id=ts.customer_location_id
         WHERE ts.expected_arrival_at<now() AND dp.id IS NULL AND se.id IS NULL
           AND t.status NOT IN ('DRAFT','COMPLETED','COMPLETED_WITH_EXCEPTION')
         ON CONFLICT(organization_id,fingerprint) DO UPDATE SET
           severity=EXCLUDED.severity,message=EXCLUDED.message,updated_at=now()
         WHERE operational_alerts.status<>'RESOLVED'`,
      );
      await client.query(
        `INSERT INTO operational_alerts(organization_id,warehouse_id,alert_type,severity,fingerprint,
           trip_id,title,message)
         SELECT t.organization_id,t.warehouse_id,'CUSTODY_UNRESOLVED','CRITICAL',
           'CUSTODY_UNRESOLVED:'||t.id,t.id,'Custody chưa đối soát',
           l.code||' còn '||COALESCE(sum(b.quantity),0)||' đơn vị chưa xử lý'
         FROM trips t JOIN locations l ON l.id=t.trip_location_id
         JOIN stock_balances b ON b.organization_id=t.organization_id AND b.location_id=t.trip_location_id
         WHERE t.status='RECONCILIATION_REQUIRED' GROUP BY t.id,l.code
         HAVING COALESCE(sum(b.quantity),0)>0
         ON CONFLICT(organization_id,fingerprint) DO UPDATE SET message=EXCLUDED.message,updated_at=now()
         WHERE operational_alerts.status<>'RESOLVED'`,
      );
      await client.query(
        `UPDATE operational_alerts a SET status='RESOLVED',resolved_at=now(),updated_at=now()
         WHERE status<>'RESOLVED' AND alert_type='STOP_OVERDUE' AND EXISTS(
           SELECT 1 FROM trip_stops ts LEFT JOIN delivery_proofs dp ON dp.trip_id=ts.trip_id AND dp.customer_location_id=ts.customer_location_id
           LEFT JOIN delivery_stop_exceptions se ON se.trip_id=ts.trip_id AND se.customer_location_id=ts.customer_location_id
           WHERE ts.trip_id=a.trip_id AND ts.customer_location_id=a.customer_location_id AND (dp.id IS NOT NULL OR se.id IS NOT NULL))`,
      );
      await client.query(
        `UPDATE operational_alerts a SET status='RESOLVED',resolved_at=now(),updated_at=now()
         WHERE status<>'RESOLVED' AND alert_type='CUSTODY_UNRESOLVED' AND NOT EXISTS(
           SELECT 1 FROM trips t JOIN stock_balances b ON b.organization_id=t.organization_id AND b.location_id=t.trip_location_id
           WHERE t.id=a.trip_id AND t.status='RECONCILIATION_REQUIRED' AND b.quantity>0)`,
      );
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
