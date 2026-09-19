import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { accessSecret } from './auth.guard.js';
import type { AccessClaims } from './auth.types.js';

@Injectable()
export class TokenService {
  issueAccess(claims: Omit<AccessClaims, 'type'>): string {
    return jwt.sign({ ...claims, type: 'access' }, accessSecret(), {
      algorithm: 'HS256',
      expiresIn: '15m',
      issuer: 'wms-api',
      audience: 'wms-clients',
    });
  }
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
