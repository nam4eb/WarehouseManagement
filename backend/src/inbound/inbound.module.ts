import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ReceiptController } from './receipt.controller.js';
import { ReceiptService } from './receipt.service.js';
@Module({
  imports: [InventoryModule],
  controllers: [ReceiptController],
  providers: [ReceiptService],
})
export class InboundModule {}
