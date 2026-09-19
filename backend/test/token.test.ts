import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { TokenService } from '../src/auth/token.service.js';
import { accessSecret } from '../src/auth/auth.guard.js';

describe('token service', () => {
  it('issues a 15 minute access token containing backend scopes', () => {
    const service = new TokenService();
    const token = service.issueAccess({
      sub: 'user',
      organizationId: 'org',
      deviceId: 'device',
      permissions: ['inventory.move'],
      warehouseIds: ['warehouse'],
    });
    const decoded = jwt.verify(token, accessSecret(), {
      issuer: 'wms-api',
      audience: 'wms-clients',
    }) as jwt.JwtPayload;
    expect(decoded.type).toBe('access');
    expect(decoded.exp! - decoded.iat!).toBe(900);
  });
  it('stores only hashes for opaque refresh tokens', () => {
    const service = new TokenService();
    const first = service.newRefreshToken();
    const second = service.newRefreshToken();
    expect(first.token).not.toBe(second.token);
    expect(first.hash).toBe(service.hashRefreshToken(first.token));
    expect(first.hash).not.toContain(first.token);
  });
});
