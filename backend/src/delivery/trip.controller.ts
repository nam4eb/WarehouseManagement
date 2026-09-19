import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/authorization.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { DATABASE_POOL } from '../database/database.module.js';
import { ProofStorageService } from './proof-storage.service.js';
import { TripService } from './trip.service.js';

const movementSchema = z.object({
  lineId: z.uuid(),
  quantity: z.number().positive(),
  serialItemId: z.uuid().optional(),
  clientOccurredAt: z.iso.datetime(),
  returnLocationId: z.uuid().optional(),
});

@Controller('trips')
@UseGuards(AuthGuard, PermissionGuard)
export class TripController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: pg.Pool,
    private readonly trips: TripService,
    private readonly proofStorage: ProofStorageService,
  ) {}

  @Post()
  @RequirePermission('outbound.manage')
  async create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z
      .object({
        warehouseId: z.uuid(),
        serviceDate: z.iso.date(),
        pickingTaskIds: z.array(z.uuid()).min(1).max(100),
        driverUserId: z.uuid().optional(),
        vehicleId: z.uuid().optional(),
      })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (
      !request.user.warehouseIds.includes('*') &&
      !request.user.warehouseIds.includes(parsed.data.warehouseId)
    )
      throw new BadRequestException('Warehouse outside scope');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tripId = randomUUID();
      const locationId = randomUUID();
      const code = `TRIP-${tripId.slice(0, 8).toUpperCase()}`;
      const location = await client.query(
        `INSERT INTO locations(id,organization_id,warehouse_id,type,code,name) SELECT $1,$2,id,'TRIP',$3,$4 FROM warehouses WHERE id=$5 AND organization_id=$2 RETURNING id`,
        [locationId, request.user.organizationId, code, `Custody ${code}`, parsed.data.warehouseId],
      );
      if (!location.rowCount) throw new BadRequestException('Invalid warehouse');
      await client.query(
        `INSERT INTO trips(id,organization_id,warehouse_id,trip_location_id,vehicle_id,driver_user_id,status,service_date) VALUES($1,$2,$3,$4,$5,$6,'READY_TO_LOAD',$7)`,
        [
          tripId,
          request.user.organizationId,
          parsed.data.warehouseId,
          locationId,
          parsed.data.vehicleId ?? null,
          parsed.data.driverUserId ?? null,
          parsed.data.serviceDate,
        ],
      );
      const tasks = await client.query<{ id: string }>(
        `SELECT id FROM picking_tasks WHERE organization_id=$1 AND warehouse_id=$2 AND status='COMPLETED' AND id=ANY($3::uuid[]) FOR UPDATE`,
        [request.user.organizationId, parsed.data.warehouseId, parsed.data.pickingTaskIds],
      );
      if (tasks.rowCount !== new Set(parsed.data.pickingTaskIds).size)
        throw new BadRequestException('All picking tasks must be completed and unassigned');
      for (const task of tasks.rows) {
        await client.query(`INSERT INTO trip_orders(trip_id,picking_task_id) VALUES($1,$2)`, [
          tripId,
          task.id,
        ]);
        await client.query(
          `INSERT INTO trip_manifest_lines(trip_id,picking_task_line_id,product_id,source_location_id,customer_location_id,planned_quantity)
           SELECT $1,l.id,l.product_id,t.staging_location_id,o.customer_location_id,l.required_quantity
           FROM picking_task_lines l JOIN picking_tasks t ON t.id=l.picking_task_id JOIN sales_orders o ON o.id=t.sales_order_id WHERE t.id=$2`,
          [tripId, task.id],
        );
      }
      await client.query(
        `INSERT INTO trip_stops(trip_id,customer_location_id,stop_sequence)
         SELECT $1,customer_location_id,row_number() OVER(ORDER BY min(created_at),customer_location_id)
         FROM trip_manifest_lines WHERE trip_id=$1 GROUP BY customer_location_id`,
        [tripId],
      );
      await client.query(
        `UPDATE trip_stops SET
           expected_arrival_at=$2::date + time '09:00' + (stop_sequence-1) * interval '1 hour',
           appointment_start=$2::date + time '08:30' + (stop_sequence-1) * interval '1 hour',
           appointment_end=$2::date + time '09:30' + (stop_sequence-1) * interval '1 hour'
         WHERE trip_id=$1`,
        [tripId, parsed.data.serviceDate],
      );
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id) VALUES($1,$2,'trip.created','trip',$3,$4,$5)`,
        [
          request.user.organizationId,
          request.user.sub,
          tripId,
          JSON.stringify({ pickingTaskIds: parsed.data.pickingTaskIds }),
          randomUUID(),
        ],
      );
      await client.query('COMMIT');
      return {
        id: tripId,
        status: 'READY_TO_LOAD',
        tripLocationId: locationId,
        serviceDate: parsed.data.serviceDate,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Get()
  @RequirePermission('delivery.read')
  async list(@Req() request: AuthenticatedRequest) {
    const all = request.user.warehouseIds.includes('*');
    const driverOnly =
      request.user.roles.includes('SHIPPER') &&
      !request.user.roles.some((role) => ['SUPER_ADMIN', 'WAREHOUSE_MANAGER'].includes(role));
    const result = await this.pool.query(
      `SELECT t.id,t.status,t.service_date,t.version,t.trip_location_id,l.code trip_code,v.registration,u.display_name driver_name,t.created_at,
       (SELECT jsonb_agg(jsonb_build_object('id',dp.id,'customerLocationId',dp.customer_location_id,
         'recipientName',dp.recipient_name,'signatureObjectKey',dp.signature_object_key,
         'photoObjectKeys',dp.photo_object_keys,'notes',dp.notes,'deliveredAt',dp.delivered_at,
         'createdAt',dp.created_at)) FROM delivery_proofs dp WHERE dp.trip_id=t.id) proofs,
       CASE WHEN ea.id IS NULL THEN NULL ELSE jsonb_build_object('id',ea.id,'unresolvedQuantity',ea.unresolved_quantity,
         'resolutionCode',ea.resolution_code,'reason',ea.reason,'approvedAt',ea.approved_at) END exception_approval,
       (SELECT jsonb_agg(jsonb_build_object('customerLocationId',ts.customer_location_id,'sequence',ts.stop_sequence,
          'name',sl.name,'address',sl.address_line,'latitude',sl.latitude,'longitude',sl.longitude,
          'expectedArrivalAt',ts.expected_arrival_at,
          'appointmentStart',ts.appointment_start,'appointmentEnd',ts.appointment_end,
          'proof',(SELECT jsonb_build_object('id',sp.id,'recipientName',sp.recipient_name,'deliveredAt',sp.delivered_at)
            FROM delivery_proofs sp WHERE sp.trip_id=t.id AND sp.customer_location_id=ts.customer_location_id),
          'exception',(SELECT jsonb_build_object('id',se.id,'reasonCode',se.reason_code,
            'affectedQuantity',se.affected_quantity,'notes',se.notes,'createdAt',se.created_at)
            FROM delivery_stop_exceptions se WHERE se.trip_id=t.id AND se.customer_location_id=ts.customer_location_id))
          ORDER BY ts.stop_sequence) FROM trip_stops ts JOIN locations sl ON sl.id=ts.customer_location_id
          WHERE ts.trip_id=t.id) stops,
       jsonb_agg(jsonb_build_object('id',ml.id,'productId',ml.product_id,'sku',p.sku,'productName',p.name,
         'customerLocationId',ml.customer_location_id,'customerName',cl.name,'planned',ml.planned_quantity,
         'loaded',COALESCE(x.loaded,0),'delivered',COALESCE(x.delivered,0),'returned',COALESCE(x.returned,0)) ORDER BY ml.id) lines
       FROM trips t JOIN locations l ON l.id=t.trip_location_id LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN users u ON u.id=t.driver_user_id
       LEFT JOIN trip_exception_approvals ea ON ea.trip_id=t.id
       JOIN trip_manifest_lines ml ON ml.trip_id=t.id JOIN products p ON p.id=ml.product_id
       JOIN locations cl ON cl.id=ml.customer_location_id LEFT JOIN LATERAL (
         SELECT sum(quantity) FILTER(WHERE reason_code='LOAD') loaded,sum(quantity) FILTER(WHERE reason_code='DELIVERY') delivered,sum(quantity) FILTER(WHERE reason_code='TRIP_RETURN') returned
         FROM stock_movements m WHERE m.organization_id=t.organization_id AND m.reference_type='TRIP_MANIFEST_LINE' AND m.reference_id=ml.id) x ON true
       WHERE t.organization_id=$1 AND ($2::boolean OR t.warehouse_id=ANY($3::uuid[]))
         AND (NOT $4::boolean OR t.driver_user_id=$5)
       GROUP BY t.id,l.code,v.registration,u.display_name,ea.id ORDER BY t.service_date DESC,t.created_at DESC`,
      [
        request.user.organizationId,
        all,
        all ? [] : request.user.warehouseIds,
        driverOnly,
        request.user.sub,
      ],
    );
    return result.rows;
  }

  private async assertTripScope(tripId: string, request: AuthenticatedRequest) {
    const all = request.user.warehouseIds.includes('*');
    const driverOnly =
      request.user.roles.includes('SHIPPER') &&
      !request.user.roles.some((role) => ['SUPER_ADMIN', 'WAREHOUSE_MANAGER'].includes(role));
    const result = await this.pool.query(
      `SELECT 1 FROM trips WHERE id=$1 AND organization_id=$2 AND ($3::boolean OR warehouse_id=ANY($4::uuid[]))
       AND (NOT $5::boolean OR driver_user_id=$6)`,
      [
        tripId,
        request.user.organizationId,
        all,
        all ? [] : request.user.warehouseIds,
        driverOnly,
        request.user.sub,
      ],
    );
    if (!result.rowCount) throw new BadRequestException('Trip not found or outside scope');
  }

  @Put(':tripId/stops')
  @RequirePermission('outbound.manage')
  async reorderStops(
    @Param('tripId') tripId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({ customerLocationIds: z.array(z.uuid()).min(1).max(200) })
      .safeParse(body);
    if (!z.uuid().safeParse(tripId).success || !parsed.success)
      throw new BadRequestException('Invalid stop sequence');
    if (new Set(parsed.data.customerLocationIds).size !== parsed.data.customerLocationIds.length)
      throw new BadRequestException('Stop sequence contains duplicates');
    await this.assertTripScope(tripId, request);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const stops = await client.query<{ customer_location_id: string }>(
        `SELECT customer_location_id FROM trip_stops WHERE trip_id=$1 FOR UPDATE`,
        [tripId],
      );
      const expected = new Set(stops.rows.map((row) => row.customer_location_id));
      if (
        expected.size !== parsed.data.customerLocationIds.length ||
        parsed.data.customerLocationIds.some((id) => !expected.has(id))
      )
        throw new BadRequestException('Stop sequence must contain every trip stop exactly once');
      await client.query(
        `UPDATE trip_stops SET stop_sequence=stop_sequence+1000 WHERE trip_id=$1`,
        [tripId],
      );
      await client.query(
        `UPDATE trip_stops ts SET stop_sequence=ordered.position
         FROM unnest($2::uuid[]) WITH ORDINALITY ordered(customer_location_id,position)
         WHERE ts.trip_id=$1 AND ts.customer_location_id=ordered.customer_location_id`,
        [tripId, parsed.data.customerLocationIds],
      );
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
         VALUES($1,$2,'trip.stops_reordered','trip',$3,$4,gen_random_uuid())`,
        [request.user.organizationId, request.user.sub, tripId, JSON.stringify(parsed.data)],
      );
      await client.query('COMMIT');
      return { tripId, customerLocationIds: parsed.data.customerLocationIds };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Put(':tripId/stops/:customerLocationId/schedule')
  @RequirePermission('outbound.manage')
  async scheduleStop(
    @Param('tripId') tripId: string,
    @Param('customerLocationId') customerLocationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({ appointmentStart: z.iso.datetime(), appointmentEnd: z.iso.datetime() })
      .refine((value) => value.appointmentStart < value.appointmentEnd, {
        message: 'Appointment start must precede end',
      })
      .safeParse(body);
    if (
      !z.uuid().safeParse(tripId).success ||
      !z.uuid().safeParse(customerLocationId).success ||
      !parsed.success
    )
      throw new BadRequestException('Invalid stop appointment');
    await this.assertTripScope(tripId, request);
    const result = await this.pool.query(
      `UPDATE trip_stops ts SET appointment_start=$3,appointment_end=$4,expected_arrival_at=$3
       FROM trips t WHERE ts.trip_id=t.id AND t.id=$1 AND ts.customer_location_id=$2
         AND t.organization_id=$5 AND t.status NOT IN ('COMPLETED','COMPLETED_WITH_EXCEPTION')
       RETURNING ts.customer_location_id,ts.appointment_start,ts.appointment_end`,
      [
        tripId,
        customerLocationId,
        parsed.data.appointmentStart,
        parsed.data.appointmentEnd,
        request.user.organizationId,
      ],
    );
    if (!result.rows[0]) throw new BadRequestException('STOP_APPOINTMENT_NOT_EDITABLE');
    await this.pool.query(
      `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
       VALUES($1,$2,'trip.stop_scheduled','trip',$3,$4,gen_random_uuid())`,
      [
        request.user.organizationId,
        request.user.sub,
        tripId,
        JSON.stringify({ customerLocationId, ...parsed.data }),
      ],
    );
    return result.rows[0];
  }

  @Put(':tripId/assignment')
  @RequirePermission('outbound.manage')
  async assignTrip(
    @Param('tripId') tripId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({
        driverUserId: z.uuid().nullable(),
        vehicleId: z.uuid().nullable(),
        reason: z.string().trim().min(5).max(1000),
      })
      .safeParse(body);
    if (!z.uuid().safeParse(tripId).success || !parsed.success)
      throw new BadRequestException('Invalid trip assignment');
    await this.assertTripScope(tripId, request);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{
        driver_user_id: string | null;
        vehicle_id: string | null;
      }>(
        `SELECT driver_user_id,vehicle_id FROM trips WHERE id=$1 AND organization_id=$2
         AND status NOT IN ('COMPLETED','COMPLETED_WITH_EXCEPTION') FOR UPDATE`,
        [tripId, request.user.organizationId],
      );
      if (!current.rows[0]) throw new BadRequestException('TRIP_ASSIGNMENT_NOT_EDITABLE');
      if (parsed.data.driverUserId) {
        const driver = await client.query(
          `SELECT 1 FROM users WHERE id=$1 AND organization_id=$2 AND active`,
          [parsed.data.driverUserId, request.user.organizationId],
        );
        if (!driver.rowCount) throw new BadRequestException('INVALID_DRIVER');
      }
      if (parsed.data.vehicleId) {
        const vehicle = await client.query(
          `SELECT 1 FROM vehicles WHERE id=$1 AND organization_id=$2 AND active`,
          [parsed.data.vehicleId, request.user.organizationId],
        );
        if (!vehicle.rowCount) throw new BadRequestException('INVALID_VEHICLE');
      }
      for (const resourceId of [parsed.data.driverUserId, parsed.data.vehicleId].filter(Boolean))
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [resourceId]);
      const conflict = await client.query<{
        id: string;
        trip_code: string;
        conflict_type: string;
      }>(
        `WITH candidate AS (
           SELECT COALESCE(min(ts.appointment_start),t.service_date::timestamp) starts_at,
             COALESCE(max(ts.appointment_end),(t.service_date+1)::timestamp) ends_at
           FROM trips t LEFT JOIN trip_stops ts ON ts.trip_id=t.id WHERE t.id=$1 GROUP BY t.id
         )
         SELECT other.id,ol.code trip_code,
           CASE WHEN other.driver_user_id=$2 THEN 'DRIVER' ELSE 'VEHICLE' END conflict_type
         FROM trips other JOIN locations ol ON ol.id=other.trip_location_id
         LEFT JOIN trip_stops os ON os.trip_id=other.id CROSS JOIN candidate c
         WHERE other.organization_id=$4 AND other.id<>$1
           AND other.status NOT IN ('COMPLETED','COMPLETED_WITH_EXCEPTION')
           AND (($2::uuid IS NOT NULL AND other.driver_user_id=$2) OR
                ($3::uuid IS NOT NULL AND other.vehicle_id=$3))
         GROUP BY other.id,ol.code,c.starts_at,c.ends_at
         HAVING tstzrange(COALESCE(min(os.appointment_start),other.service_date::timestamp),
                  COALESCE(max(os.appointment_end),(other.service_date+1)::timestamp),'[)') &&
                tstzrange(c.starts_at,c.ends_at,'[)') LIMIT 1`,
        [tripId, parsed.data.driverUserId, parsed.data.vehicleId, request.user.organizationId],
      );
      if (conflict.rows[0])
        throw new ConflictException({
          code: 'TRIP_ASSIGNMENT_CONFLICT',
          conflictingTripId: conflict.rows[0].id,
          conflictingTripCode: conflict.rows[0].trip_code,
          conflictType: conflict.rows[0].conflict_type,
        });
      await client.query(
        `UPDATE trips SET driver_user_id=$2,vehicle_id=$3,version=version+1 WHERE id=$1`,
        [tripId, parsed.data.driverUserId, parsed.data.vehicleId],
      );
      await client.query(
        `INSERT INTO trip_assignment_history(organization_id,trip_id,previous_driver_user_id,new_driver_user_id,
           previous_vehicle_id,new_vehicle_id,reason,assigned_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          request.user.organizationId,
          tripId,
          current.rows[0].driver_user_id,
          parsed.data.driverUserId,
          current.rows[0].vehicle_id,
          parsed.data.vehicleId,
          parsed.data.reason,
          request.user.sub,
        ],
      );
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
         VALUES($1,$2,'trip.assignment_changed','trip',$3,$4,gen_random_uuid())`,
        [request.user.organizationId, request.user.sub, tripId, JSON.stringify(parsed.data)],
      );
      await client.query('COMMIT');
      return { tripId, ...parsed.data };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Post(':tripId/proof-upload-url')
  @RequirePermission('delivery.execute')
  async proofUploadUrl(
    @Param('tripId') tripId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({ fileName: z.string().trim().min(1).max(180), contentType: z.string() })
      .safeParse(body);
    if (!z.uuid().safeParse(tripId).success || !parsed.success)
      throw new BadRequestException('Invalid proof upload request');
    await this.assertTripScope(tripId, request);
    return this.proofStorage.createUpload(
      request.user.organizationId,
      tripId,
      parsed.data.fileName,
      parsed.data.contentType,
    );
  }

  @Post(':tripId/proof')
  @RequirePermission('delivery.execute')
  async recordProof(
    @Param('tripId') tripId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({
        recipientName: z.string().trim().min(1).max(180),
        customerLocationId: z.uuid(),
        signatureObjectKey: z.string().min(1).optional(),
        photoObjectKeys: z.array(z.string().min(1)).max(5).default([]),
        notes: z.string().trim().max(2000).optional(),
        deliveredAt: z.iso.datetime(),
      })
      .refine((value) => value.signatureObjectKey || value.photoObjectKeys.length > 0, {
        message: 'Signature or photo is required',
      })
      .safeParse(body);
    if (!z.uuid().safeParse(tripId).success || !parsed.success)
      throw new BadRequestException(parsed.success ? 'Invalid trip id' : parsed.error.flatten());
    await this.assertTripScope(tripId, request);
    const objectKeys = [
      ...(parsed.data.signatureObjectKey ? [parsed.data.signatureObjectKey] : []),
      ...parsed.data.photoObjectKeys,
    ];
    await this.proofStorage.assertObjects(request.user.organizationId, tripId, objectKeys);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO delivery_proofs(organization_id,trip_id,customer_location_id,recipient_name,signature_object_key,photo_object_keys,notes,delivered_at,recorded_by)
       SELECT $1,t.id,$3,$4,$5,$6,$7,$8,$9 FROM trips t JOIN trip_stops ts ON ts.trip_id=t.id AND ts.customer_location_id=$3
       WHERE t.id=$2 AND t.organization_id=$1
         AND t.status IN ('IN_PROGRESS','RETURNING','RECONCILING','RECONCILIATION_REQUIRED','COMPLETED','COMPLETED_WITH_EXCEPTION')
       ON CONFLICT(trip_id,customer_location_id) DO NOTHING
       RETURNING id,trip_id,customer_location_id,recipient_name,delivered_at,created_at`,
        [
          request.user.organizationId,
          tripId,
          parsed.data.customerLocationId,
          parsed.data.recipientName,
          parsed.data.signatureObjectKey ?? null,
          JSON.stringify(parsed.data.photoObjectKeys),
          parsed.data.notes ?? null,
          parsed.data.deliveredAt,
          request.user.sub,
        ],
      );
      if (!result.rows[0]) throw new BadRequestException('POD_NOT_ALLOWED_OR_ALREADY_EXISTS');
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
       VALUES($1,$2,'delivery.proof_recorded','trip',$3,$4,$5)`,
        [
          request.user.organizationId,
          request.user.sub,
          tripId,
          JSON.stringify({ proofId: result.rows[0].id, objectCount: objectKeys.length }),
          randomUUID(),
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

  @Post(':tripId/stops/:customerLocationId/exception')
  @RequirePermission('delivery.execute')
  async recordStopException(
    @Param('tripId') tripId: string,
    @Param('customerLocationId') customerLocationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({
        reasonCode: z.enum([
          'CUSTOMER_ABSENT',
          'CUSTOMER_REJECTED',
          'DAMAGED',
          'SHORT_SHIPMENT',
          'ACCESS_BLOCKED',
          'OTHER',
        ]),
        affectedQuantity: z.number().positive(),
        notes: z.string().trim().min(5).max(2000),
      })
      .safeParse(body);
    if (
      !z.uuid().safeParse(tripId).success ||
      !z.uuid().safeParse(customerLocationId).success ||
      !parsed.success
    )
      throw new BadRequestException('Invalid stop exception');
    await this.assertTripScope(tripId, request);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO delivery_stop_exceptions(organization_id,trip_id,customer_location_id,reason_code,affected_quantity,notes,recorded_by)
         SELECT $1,t.id,$3,$4,$5,$6,$7 FROM trips t JOIN trip_stops ts ON ts.trip_id=t.id AND ts.customer_location_id=$3
         WHERE t.id=$2 AND t.organization_id=$1 AND t.status IN ('DEPARTED','IN_PROGRESS','RETURNING','RECONCILING','RECONCILIATION_REQUIRED')
         ON CONFLICT(trip_id,customer_location_id) DO NOTHING RETURNING *`,
        [
          request.user.organizationId,
          tripId,
          customerLocationId,
          parsed.data.reasonCode,
          parsed.data.affectedQuantity,
          parsed.data.notes,
          request.user.sub,
        ],
      );
      if (!result.rows[0]) throw new BadRequestException('STOP_EXCEPTION_NOT_ALLOWED_OR_EXISTS');
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,data,correlation_id)
         VALUES($1,$2,'delivery.stop_exception_recorded','trip',$3,$4,gen_random_uuid())`,
        [
          request.user.organizationId,
          request.user.sub,
          tripId,
          JSON.stringify({ customerLocationId, ...parsed.data }),
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

  @Post(':tripId/approve-exception')
  @RequirePermission('delivery.exception.approve')
  approveException(
    @Param('tripId') tripId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsed = z
      .object({
        resolutionCode: z.enum(['ACCEPT_VARIANCE', 'LOSS_CONFIRMED', 'INVESTIGATE_LATER']),
        reason: z.string().trim().min(10).max(2000),
      })
      .safeParse(body);
    if (!z.uuid().safeParse(tripId).success || !parsed.success)
      throw new BadRequestException(parsed.success ? 'Invalid trip id' : parsed.error.flatten());
    return this.trips.approveException({
      organizationId: request.user.organizationId,
      tripId,
      actorId: request.user.sub,
      warehouseIds: request.user.warehouseIds,
      ...parsed.data,
    });
  }

  private async movement(
    action: 'LOAD' | 'DELIVERY' | 'TRIP_RETURN',
    tripId: string,
    body: unknown,
    key: string | undefined,
    request: AuthenticatedRequest,
  ) {
    const parsed = movementSchema.safeParse(body);
    if (!z.uuid().safeParse(tripId).success || !z.uuid().safeParse(key).success || !parsed.success)
      throw new BadRequestException('Invalid trip movement command');
    if (action === 'TRIP_RETURN' && !parsed.data.returnLocationId)
      throw new BadRequestException('Return location is required');
    await this.assertTripScope(tripId, request);
    return this.trips.move({
      tripId,
      action,
      ...parsed.data,
      warehouseIds: request.user.warehouseIds,
      command: {
        idempotencyKey: key!,
        organizationId: request.user.organizationId,
        reasonCode: action,
        actorId: request.user.sub,
        deviceId: request.user.deviceId,
        clientOccurredAt: parsed.data.clientOccurredAt,
        correlationId: randomUUID(),
      },
    });
  }

  @Post(':tripId/load') @RequirePermission('outbound.pick') load(
    @Param('tripId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.movement('LOAD', id, body, key, req);
  }
  @Post(':tripId/deliver') @RequirePermission('delivery.execute') deliver(
    @Param('tripId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.movement('DELIVERY', id, body, key, req);
  }
  @Post(':tripId/return') @RequirePermission('delivery.execute') returnStock(
    @Param('tripId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.movement('TRIP_RETURN', id, body, key, req);
  }

  @Post(':tripId/depart') @RequirePermission('delivery.execute') async depart(
    @Param('tripId') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!z.uuid().safeParse(id).success) throw new BadRequestException('Invalid trip id');
    await this.assertTripScope(id, req);
    return this.trips.depart(req.user.organizationId, id, req.user.sub, req.user.warehouseIds);
  }
  @Post(':tripId/reconcile') @RequirePermission('delivery.execute') async reconcile(
    @Param('tripId') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!z.uuid().safeParse(id).success) throw new BadRequestException('Invalid trip id');
    await this.assertTripScope(id, req);
    return this.trips.reconcile(req.user.organizationId, id, req.user.sub, req.user.warehouseIds);
  }
}
