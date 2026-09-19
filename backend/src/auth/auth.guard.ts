import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { AccessClaims, AuthenticatedRequest } from './auth.types.js';

export function accessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret && process.env.NODE_ENV === 'production')
    throw new Error('JWT_ACCESS_SECRET is required in production');
  return secret ?? 'local-development-only-change-me';
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    if (!value?.startsWith('Bearer ')) throw new UnauthorizedException('Bearer token required');
    try {
      const claims = jwt.verify(value.slice(7), accessSecret(), {
        algorithms: ['HS256'],
        issuer: 'wms-api',
        audience: 'wms-clients',
      }) as AccessClaims;
      if (claims.type !== 'access') throw new Error('Wrong token type');
      request.user = claims;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
