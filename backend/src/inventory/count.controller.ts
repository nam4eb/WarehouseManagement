import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/authorization.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { InventoryCountService } from './count.service.js';

@Controller('inventory/counts')
@UseGuards(AuthGuard, PermissionGuard)
export class InventoryCountController {
  constructor(private readonly counts: InventoryCountService) {}

  @Get()
  @RequirePermission('inventory.count')
  list(@Req() request: AuthenticatedRequest) {
    return this.counts.list(request.user.organizationId, request.user.warehouseIds);
  }

  @Get(':countId')
  @RequirePermission('inventory.count')
  detail(@Param('countId') countId: string, @Req() request: AuthenticatedRequest) {
    this.uuid(countId);
    return this.counts.detail(request.user.organizationId, request.user.warehouseIds, countId);
  }

  @Post()
  @RequirePermission('inventory.count')
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = z
      .object({ warehouseId: z.uuid(), locationId: z.uuid(), productIds: z.array(z.uuid()).optional() })
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.counts.create({
      organizationId: request.user.organizationId,
      warehouseIds: request.user.warehouseIds,
      actorId: request.user.sub,
      ...parsed.data,
    });
  }

  @Post(':countId/start')
  @RequirePermission('inventory.count')
  start(@Param('countId') countId: string, @Req() request: AuthenticatedRequest) {
    this.uuid(countId);
    return this.counts.start(request.user.organizationId, request.user.warehouseIds, countId, request.user.sub);
  }

  @Post(':countId/lines')
  @RequirePermission('inventory.count')
  record(@Param('countId') countId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    this.uuid(countId);
    const parsed = z.object({ productId: z.uuid(), countedQuantity: z.number().nonnegative() }).safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.counts.recordLine(
      request.user.organizationId,
      request.user.warehouseIds,
      countId,
      parsed.data.productId,
      parsed.data.countedQuantity,
      request.user.sub,
    );
  }

  @Post(':countId/submit')
  @RequirePermission('inventory.count')
  submit(@Param('countId') countId: string, @Req() request: AuthenticatedRequest) {
    this.uuid(countId);
    return this.counts.submit(request.user.organizationId, request.user.warehouseIds, countId, request.user.sub);
  }

  @Post(':countId/recount')
  @RequirePermission('inventory.adjust.approve')
  recount(@Param('countId') countId: string, @Req() request: AuthenticatedRequest) {
    this.uuid(countId);
    return this.counts.requestRecount(request.user.organizationId, request.user.warehouseIds, countId, request.user.sub);
  }

  @Post('adjustments/:adjustmentId/approve')
  @RequirePermission('inventory.adjust.approve')
  approve(@Param('adjustmentId') adjustmentId: string, @Req() request: AuthenticatedRequest) {
    this.uuid(adjustmentId);
    return this.counts.approveAdjustment({
      organizationId: request.user.organizationId,
      warehouseIds: request.user.warehouseIds,
      adjustmentId,
      actorId: request.user.sub,
      deviceId: request.user.deviceId,
    });
  }

  private uuid(value: string) {
    if (!z.uuid().safeParse(value).success) throw new BadRequestException('Invalid UUID');
  }
}
