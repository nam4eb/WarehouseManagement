import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PickingController } from './picking.controller.js';
import { PickingService } from './picking.service.js';
@Module({
  imports: [InventoryModule],
  controllers: [PickingController],
  providers: [PickingService],
})
export class OutboundModule {}
