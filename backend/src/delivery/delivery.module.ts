import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { TripController } from './trip.controller.js';
import { TripService } from './trip.service.js';
import { ProofStorageService } from './proof-storage.service.js';

@Module({
  imports: [InventoryModule],
  controllers: [TripController],
  providers: [TripService, ProofStorageService],
})
export class DeliveryModule {}
