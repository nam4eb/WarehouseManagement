import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import { ScanModule } from './scan/scan.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { SyncModule } from './sync/sync.module.js';
import { AuditModule } from './audit/audit.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AuditModule,
    CatalogModule,
    IdentityModule,
    InventoryModule,
    ScanModule,
    SyncModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
