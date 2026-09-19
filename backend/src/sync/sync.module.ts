import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SyncController } from './sync.controller.js';
@Module({ imports: [InventoryModule], controllers: [SyncController] })
export class SyncModule {}
