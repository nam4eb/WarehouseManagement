import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller.js';
import { AlertsWorker } from './alerts.worker.js';

@Module({ controllers: [AlertsController], providers: [AlertsWorker] })
export class AlertsModule {}
