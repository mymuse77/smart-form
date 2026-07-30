export interface AuthPrincipal {
  subject: string;
  tenantId: string;
  deviceId?: string;
  scopes: string[];
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<AuthPrincipal>;
}

export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');
