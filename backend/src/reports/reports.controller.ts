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

@Controller('reports')
@UseGuards(AuthGuard, PermissionGuard)
export class ReportsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: pg.Pool) {}

  @Get('operations')
  @RequirePermission('inventory.read')
  async operations(
    @Query() query: Record<string, string | undefined>,
    @Req() request: AuthenticatedRequest,
  ) {
    const today = new Date();
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 29);
    const parsed = z
      .object({
        from: z.iso.date().default(start.toISOString().slice(0, 10)),
        to: z.iso.date().default(today.toISOString().slice(0, 10)),
      })
      .refine((value) => value.from <= value.to, { message: '`from` must not follow `to`' })
      .safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const span =
      (Date.parse(`${parsed.data.to}T00:00:00Z`) - Date.parse(`${parsed.data.from}T00:00:00Z`)) /
      86_400_000;
    if (span > 366) throw new BadRequestException('Report range cannot exceed 366 days');
    const all = request.user.warehouseIds.includes('*');
    const parameters = [
      request.user.organizationId,
      parsed.data.from,
      parsed.data.to,
      all,
      all ? [] : request.user.warehouseIds,
    ];
    const [receipts, picking, trips, movements, daily] = await Promise.all([
      this.pool.query(
        `SELECT count(*) total,count(*) FILTER(WHERE status='CONFIRMED') confirmed,
         count(*) FILTER(WHERE EXISTS(SELECT 1 FROM purchase_receipt_lines l
           LEFT JOIN LATERAL (SELECT COALESCE(sum(quantity),0) actual FROM stock_movements m
             WHERE m.organization_id=r.organization_id AND m.reference_type='PURCHASE_RECEIPT_LINE'
               AND m.reference_id=l.id AND m.reason_code='RECEIPT') x ON true
           WHERE l.receipt_id=r.id AND COALESCE(x.actual,0)<>l.expected_quantity)) exceptions
         FROM purchase_receipts r WHERE organization_id=$1 AND created_at::date BETWEEN $2 AND $3
           AND ($4::boolean OR warehouse_id=ANY($5::uuid[]))`,
        parameters,
      ),
      this.pool.query(
        `SELECT count(*) total,count(*) FILTER(WHERE status='COMPLETED') completed,
         COALESCE(avg(EXTRACT(EPOCH FROM (completed_at-created_at))/60)
           FILTER(WHERE completed_at IS NOT NULL),0) average_minutes
         FROM picking_tasks WHERE organization_id=$1 AND created_at::date BETWEEN $2 AND $3
           AND ($4::boolean OR warehouse_id=ANY($5::uuid[]))`,
        parameters,
      ),
      this.pool.query(
        `SELECT count(DISTINCT t.id) total,
         count(DISTINCT t.id) FILTER(WHERE status IN ('COMPLETED','COMPLETED_WITH_EXCEPTION')) completed,
         count(DISTINCT t.id) FILTER(WHERE status IN ('RECONCILIATION_REQUIRED','COMPLETED_WITH_EXCEPTION')) exceptions,
         count(DISTINCT t.id) FILTER(WHERE dp.id IS NOT NULL) with_proof
         FROM trips t LEFT JOIN delivery_proofs dp ON dp.trip_id=t.id
         WHERE t.organization_id=$1 AND t.service_date BETWEEN $2 AND $3
           AND ($4::boolean OR t.warehouse_id=ANY($5::uuid[]))`,
        parameters,
      ),
      this.pool.query(
        `SELECT count(*) movements,COALESCE(sum(quantity),0) units
         FROM stock_movements m JOIN locations src ON src.id=m.source_location_id
         WHERE m.organization_id=$1 AND m.occurred_at::date BETWEEN $2 AND $3
           AND ($4::boolean OR src.warehouse_id=ANY($5::uuid[]))`,
        parameters,
      ),
      this.pool.query(
        `SELECT d::date report_date,
         (SELECT count(*) FROM purchase_receipts r WHERE r.organization_id=$1 AND r.created_at::date=d
           AND ($4::boolean OR r.warehouse_id=ANY($5::uuid[]))) receipts,
         (SELECT count(*) FROM picking_tasks p WHERE p.organization_id=$1 AND p.completed_at::date=d
           AND ($4::boolean OR p.warehouse_id=ANY($5::uuid[]))) picks_completed,
         (SELECT count(*) FROM trips t WHERE t.organization_id=$1 AND t.service_date=d
           AND t.status IN ('COMPLETED','COMPLETED_WITH_EXCEPTION')
           AND ($4::boolean OR t.warehouse_id=ANY($5::uuid[]))) trips_completed
         FROM generate_series($2::date,$3::date,interval '1 day') d ORDER BY d`,
        parameters,
      ),
    ]);
    const numeric = (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          typeof value === 'string' ? Number(value) : value,
        ]),
      );
    return {
      range: parsed.data,
      receipts: numeric(receipts.rows[0]!),
      picking: numeric(picking.rows[0]!),
      trips: numeric(trips.rows[0]!),
      inventory: numeric(movements.rows[0]!),
      daily: daily.rows.map(numeric),
    };
  }

  @Get('dispatch')
  @RequirePermission('inventory.read')
  async dispatch(@Req() request: AuthenticatedRequest) {
    const all = request.user.warehouseIds.includes('*');
    const result = await this.pool.query(
      `SELECT t.id,t.driver_user_id,t.vehicle_id,l.code trip_code,t.status,t.service_date,v.registration,u.display_name driver_name,
       COALESCE(b.quantity,0) unresolved_custody,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',h.id,'previousDriver',pu.display_name,
          'newDriver',nu.display_name,'previousVehicle',pv.registration,'newVehicle',nv.registration,
          'reason',h.reason,'assignedAt',h.assigned_at,'assignedBy',au.display_name) ORDER BY h.assigned_at DESC),'[]')
        FROM trip_assignment_history h LEFT JOIN users pu ON pu.id=h.previous_driver_user_id
        LEFT JOIN users nu ON nu.id=h.new_driver_user_id LEFT JOIN vehicles pv ON pv.id=h.previous_vehicle_id
        LEFT JOIN vehicles nv ON nv.id=h.new_vehicle_id LEFT JOIN users au ON au.id=h.assigned_by
        WHERE h.trip_id=t.id) assignment_history,
       count(ts.customer_location_id) stop_count,
       count(*) FILTER(WHERE dp.id IS NULL AND se.id IS NULL) unresolved_stops,
       count(*) FILTER(WHERE dp.id IS NULL AND se.id IS NULL AND ts.expected_arrival_at<now()) overdue_stops,
       jsonb_agg(jsonb_build_object('customerLocationId',ts.customer_location_id,'sequence',ts.stop_sequence,
         'name',cl.name,'address',cl.address_line,'expectedArrivalAt',ts.expected_arrival_at,
         'appointmentStart',ts.appointment_start,'appointmentEnd',ts.appointment_end,
         'outcome',CASE WHEN dp.id IS NOT NULL THEN 'POD' WHEN se.id IS NOT NULL THEN 'EXCEPTION' ELSE 'PENDING' END,
         'overdue',(dp.id IS NULL AND se.id IS NULL AND ts.expected_arrival_at<now())) ORDER BY ts.stop_sequence) stops
       FROM trips t JOIN locations l ON l.id=t.trip_location_id
       JOIN trip_stops ts ON ts.trip_id=t.id JOIN locations cl ON cl.id=ts.customer_location_id
       LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN users u ON u.id=t.driver_user_id
       LEFT JOIN delivery_proofs dp ON dp.trip_id=t.id AND dp.customer_location_id=ts.customer_location_id
       LEFT JOIN delivery_stop_exceptions se ON se.trip_id=t.id AND se.customer_location_id=ts.customer_location_id
       LEFT JOIN LATERAL (SELECT COALESCE(sum(quantity),0) quantity FROM stock_balances
         WHERE organization_id=t.organization_id AND location_id=t.trip_location_id) b ON true
       WHERE t.organization_id=$1 AND t.status<>'DRAFT'
         AND t.service_date BETWEEN current_date-7 AND current_date+7
         AND ($2::boolean OR t.warehouse_id=ANY($3::uuid[]))
       GROUP BY t.id,l.code,v.registration,u.display_name,b.quantity
       ORDER BY count(*) FILTER(WHERE dp.id IS NULL AND se.id IS NULL AND ts.expected_arrival_at<now()) DESC,
         t.service_date,t.created_at`,
      [request.user.organizationId, all, all ? [] : request.user.warehouseIds],
    );
    const trips = result.rows.map((row) => ({
      ...row,
      unresolved_custody: Number(row.unresolved_custody),
      stop_count: Number(row.stop_count),
      unresolved_stops: Number(row.unresolved_stops),
      overdue_stops: Number(row.overdue_stops),
    }));
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        activeTrips: trips.filter(
          (trip) => !['COMPLETED', 'COMPLETED_WITH_EXCEPTION'].includes(trip.status as string),
        ).length,
        overdueStops: trips.reduce((sum, trip) => sum + trip.overdue_stops, 0),
        unresolvedStops: trips.reduce((sum, trip) => sum + trip.unresolved_stops, 0),
        unresolvedCustody: trips.reduce((sum, trip) => sum + trip.unresolved_custody, 0),
      },
      trips,
    };
  }

  @Get('dispatch-resources')
  @RequirePermission('outbound.manage')
  async dispatchResources(@Req() request: AuthenticatedRequest) {
    const [drivers, vehicles] = await Promise.all([
      this.pool.query(
        `SELECT u.id,u.display_name,u.email,count(t.id) FILTER(WHERE t.status NOT IN ('COMPLETED','COMPLETED_WITH_EXCEPTION')) active_trips
         FROM users u LEFT JOIN trips t ON t.driver_user_id=u.id AND t.service_date BETWEEN current_date-1 AND current_date+7
         WHERE u.organization_id=$1 AND u.active GROUP BY u.id ORDER BY u.display_name`,
        [request.user.organizationId],
      ),
      this.pool.query(
        `SELECT v.id,v.registration,count(t.id) FILTER(WHERE t.status NOT IN ('COMPLETED','COMPLETED_WITH_EXCEPTION')) active_trips
         FROM vehicles v LEFT JOIN trips t ON t.vehicle_id=v.id AND t.service_date BETWEEN current_date-1 AND current_date+7
         WHERE v.organization_id=$1 AND v.active GROUP BY v.id ORDER BY v.registration`,
        [request.user.organizationId],
      ),
    ]);
    return { drivers: drivers.rows, vehicles: vehicles.rows };
  }
}
