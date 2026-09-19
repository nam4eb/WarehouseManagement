export interface AccessClaims {
  sub: string;
  organizationId: string;
  deviceId: string;
  permissions: string[];
  warehouseIds: string[];
  type: 'access';
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user: AccessClaims;
}
