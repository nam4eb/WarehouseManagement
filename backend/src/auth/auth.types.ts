export interface AccessClaims {
  sub: string;
  organizationId: string;
  deviceId: string;
  permissions: string[];
  roles: string[];
  warehouseIds: string[];
  displayName: string;
  email: string;
  type: 'access';
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user: AccessClaims;
}
