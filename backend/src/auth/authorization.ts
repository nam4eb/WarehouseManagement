import { SetMetadata } from '@nestjs/common';
export const REQUIRED_PERMISSION = 'required_permission';
export const RequirePermission = (permission: string): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSION, permission);
