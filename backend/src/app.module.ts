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
import { InboundModule } from './inbound/inbound.module.js';
import { OutboundModule } from './outbound/outbound.module.js';
import { DeliveryModule } from './delivery/delivery.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { AlertsModule } from './alerts/alerts.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AuditModule,
    CatalogModule,
    IdentityModule,
    InboundModule,
    OutboundModule,
    DeliveryModule,
    ReportsModule,
    OutboxModule,
    AlertsModule,
    InventoryModule,
    ScanModule,
    SyncModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
