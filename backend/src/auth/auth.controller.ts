import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('auth/login')
  login(@Body() body: unknown) {
    const result = z
      .object({
        organizationCode: z.string().min(1),
        email: z.email(),
        password: z.string().min(8),
        deviceFingerprint: z.string().min(8).max(255),
      })
      .safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.auth.login(result.data);
  }
  @Post('auth/refresh')
  refresh(@Body() body: unknown) {
    const result = z.object({ refreshToken: z.string().min(32) }).safeParse(body);
    if (!result.success) throw new BadRequestException(result.error.flatten());
    return this.auth.refresh(result.data.refreshToken);
  }
  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return request.user;
  }
}
