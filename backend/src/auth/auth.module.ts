import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { PermissionGuard } from './permission.guard.js';
import { TokenService } from './token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthGuard, PermissionGuard, TokenService, AuthService],
  exports: [AuthGuard, PermissionGuard, TokenService],
})
export class AuthModule {}
