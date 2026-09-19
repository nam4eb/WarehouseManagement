import { Module } from '@nestjs/common';
import { OutboxController } from './outbox.controller.js';
import { OutboxWorker } from './outbox.worker.js';

@Module({ controllers: [OutboxController], providers: [OutboxWorker] })
export class OutboxModule {}
