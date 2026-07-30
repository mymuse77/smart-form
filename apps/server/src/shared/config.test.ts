import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('server configuration safety', () => {
  it('loads a safe loopback development default', () => {
    expect(loadConfig({})).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      AUTH_MODE: 'development',
      RESOURCE_REPOSITORY: 'memory',
      ARTIFACT_TRANSPORT: 'local',
    });
  });

  it('requires HTTPS whenever the HTTPS artifact transport is selected', () => {
    expect(() => loadConfig({
      ARTIFACT_TRANSPORT: 'https',
      ARTIFACT_PUBLIC_BASE_URL: 'http://control.example.com',
    })).toThrow('HTTPS public base URL');
  });

  it('rejects insecure production identity and browser origins', () => {
    const production = {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      AUTH_MODE: 'oidc',
      OIDC_ISSUER: 'http://id.example.com',
      OIDC_AUDIENCE: 'smart-form',
      OIDC_JWKS_URL: 'https://id.example.com/jwks.json',
      RESOURCE_REPOSITORY: 'prisma',
      DATABASE_URL: 'postgresql://user:password@db.example.com/smart_form',
      ARTIFACT_TRANSPORT: 'https',
      ARTIFACT_PUBLIC_BASE_URL: 'https://control.example.com',
      ARTIFACT_SIGNING_PRIVATE_KEY_B64: 'not-used-by-config-parser',
      CORS_ORIGINS: 'https://app.example.com',
    };
    expect(() => loadConfig(production)).toThrow('OIDC issuer and JWKS URLs must use HTTPS');
    expect(() => loadConfig({
      ...production,
      OIDC_ISSUER: 'https://id.example.com',
      CORS_ORIGINS: 'http://app.example.com',
    })).toThrow('CORS origins must use HTTPS');
  });
});
