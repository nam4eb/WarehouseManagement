import { Module } from '@nestjs/common';
import { InMemoryMovementLedger } from './ledger.js';
import { BalanceController, InventoryController } from './inventory.controller.js';
import { PostgresMovementLedger } from './postgres-ledger.js';

@Module({
  controllers: [InventoryController, BalanceController],
  providers: [InMemoryMovementLedger, PostgresMovementLedger],
  exports: [InMemoryMovementLedger, PostgresMovementLedger],
})
export class InventoryModule {}
