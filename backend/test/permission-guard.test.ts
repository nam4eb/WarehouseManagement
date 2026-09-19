import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PermissionGuard } from '../src/auth/permission.guard.js';

function context(permissions: string[]) {
  return {
    getHandler: () => class Handler {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as never;
}

describe('backend permission guard', () => {
  const reflector = { getAllAndOverride: () => 'identity.manage' } as never;
  it('allows a principal with the required permission', () => {
    expect(new PermissionGuard(reflector).canActivate(context(['identity.manage']))).toBe(true);
  });
  it('rejects a principal even when a UI could expose the action', () => {
    expect(() => new PermissionGuard(reflector).canActivate(context(['inventory.read']))).toThrow(
      ForbiddenException,
    );
  });
});
