import { Module } from '@nestjs/common';
import { InMemoryMovementLedger } from './ledger.js';
import { BalanceController, InventoryController } from './inventory.controller.js';
import { PostgresMovementLedger } from './postgres-ledger.js';
import { InventoryCountController } from './count.controller.js';
import { InventoryCountService } from './count.service.js';

@Module({
  controllers: [InventoryController, BalanceController, InventoryCountController],
  providers: [InMemoryMovementLedger, PostgresMovementLedger, InventoryCountService],
  exports: [InMemoryMovementLedger, PostgresMovementLedger],
})
export class InventoryModule {}
