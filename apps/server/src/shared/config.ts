import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z.string().optional(),
  RESOURCE_REPOSITORY: z.enum(['memory', 'prisma']).default('memory'),
  AUTH_MODE: z.enum(['development', 'oidc']).default('development'),
  DEV_BEARER_TOKEN: z.string().min(16).default('smart-form-local-dev-token'),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),
  OIDC_JWKS_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  ARTIFACT_ROOT: z.string().default('data/artifacts'),
  ARTIFACT_TRANSPORT: z.enum(['local', 'https']).default('local'),
  ARTIFACT_PUBLIC_BASE_URL: z.string().url().optional(),
  ARTIFACT_SIGNING_KEY_ID: z.string().min(1).default('local-ephemeral-key'),
  ARTIFACT_SIGNING_PRIVATE_KEY_B64: z.string().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const config = ConfigSchema.parse(environment);

  if (config.RESOURCE_REPOSITORY === 'prisma' && !config.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when RESOURCE_REPOSITORY=prisma');
  }
  if (config.AUTH_MODE === 'oidc') {
    if (!config.OIDC_ISSUER || !config.OIDC_AUDIENCE || !config.OIDC_JWKS_URL) {
      throw new Error('OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URL are required for OIDC auth');
    }
  }
  if (
    config.ARTIFACT_TRANSPORT === 'https'
    && (!config.ARTIFACT_PUBLIC_BASE_URL
      || new URL(config.ARTIFACT_PUBLIC_BASE_URL).protocol !== 'https:')
  ) {
    throw new Error('ARTIFACT_TRANSPORT=https requires an HTTPS public base URL');
  }
  if (config.NODE_ENV === 'production') {
    if (!environment.HOST) {
      throw new Error('Production requires an explicit HOST binding');
    }
    if (config.AUTH_MODE !== 'oidc') {
      throw new Error('Production requires AUTH_MODE=oidc');
    }
    if (config.RESOURCE_REPOSITORY !== 'prisma') {
      throw new Error('Production requires RESOURCE_REPOSITORY=prisma');
    }
    if (config.ARTIFACT_TRANSPORT !== 'https') {
      throw new Error('Production artifacts require an HTTPS public base URL');
    }
    if (
      new URL(config.OIDC_ISSUER!).protocol !== 'https:'
      || new URL(config.OIDC_JWKS_URL!).protocol !== 'https:'
    ) {
      throw new Error('Production OIDC issuer and JWKS URLs must use HTTPS');
    }
    const corsOrigins = config.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
    if (corsOrigins.some((origin) => new URL(origin).protocol !== 'https:')) {
      throw new Error('Production CORS origins must use HTTPS');
    }
    if (!config.ARTIFACT_SIGNING_PRIVATE_KEY_B64) {
      throw new Error('Production requires ARTIFACT_SIGNING_PRIVATE_KEY_B64');
    }
  }

  return {
    ...config,
    corsOrigins: config.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
