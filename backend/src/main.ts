import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { DatabaseExceptionFilter } from './http/database-exception.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new DatabaseExceptionFilter());
  app.setGlobalPrefix('api/v1');
  const document = SwaggerModule.createDocument(app, {
    openapi: '3.0.0',
    info: { title: 'Warehouse Management API', version: '0.1.0' },
  });
  SwaggerModule.setup('api/docs', app, document);
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
