import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppConfig } from '../shared/config';
import { ForbiddenError } from '../shared/app-error';
import type { AccessTokenVerifier, AuthPrincipal } from './auth.types';

export class ConfiguredAccessTokenVerifier implements AccessTokenVerifier {
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: AppConfig) {
    if (config.AUTH_MODE === 'oidc' && config.OIDC_JWKS_URL) {
      this.jwks = createRemoteJWKSet(new URL(config.OIDC_JWKS_URL));
    }
  }

  async verify(token: string): Promise<AuthPrincipal> {
    if (this.config.AUTH_MODE === 'development') {
      if (token !== this.config.DEV_BEARER_TOKEN) throw new ForbiddenError('Invalid access token');
      return {
        subject: 'local-user',
        tenantId: 'local-tenant',
        deviceId: 'local-device',
        scopes: ['resources:read', 'resources:write', 'tasks:execute'],
      };
    }

    if (!this.jwks || !this.config.OIDC_ISSUER || !this.config.OIDC_AUDIENCE) {
      throw new ForbiddenError('OIDC verifier is not configured');
    }
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.config.OIDC_ISSUER,
      audience: this.config.OIDC_AUDIENCE,
    });
    const tenantId = payload.tenant_id;
    if (typeof payload.sub !== 'string' || typeof tenantId !== 'string') {
      throw new ForbiddenError('Token is missing required identity claims');
    }
    const scope = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
    return {
      subject: payload.sub,
      tenantId,
      deviceId: typeof payload.device_id === 'string' ? payload.device_id : undefined,
      scopes: scope,
    };
  }
}
