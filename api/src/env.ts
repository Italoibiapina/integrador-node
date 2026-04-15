import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: new URL('../../.env', import.meta.url) });
dotenv.config({ path: new URL('../../.env.local', import.meta.url) });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value ?? fallback;
}

function optionalBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function envOrDevDefault(name: string, devFallback: string, nodeEnv: string): string {
  const value = process.env[name];
  if (value) return value;
  if (nodeEnv === 'development' || nodeEnv === 'test') return devFallback;
  return requireEnv(name);
}

export const env = {
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  databaseUrl: envOrDevDefault(
    'DATABASE_URL',
    'postgres://postgres:postgres@localhost:5432/canp_integracao',
    process.env.NODE_ENV ?? 'development'
  ),
  port: Number(optionalEnv('PORT', '3005')),
  corsOrigin: optionalEnv('CORS_ORIGIN', ''),
  jwtSecret: envOrDevDefault('JWT_SECRET', 'change-me', process.env.NODE_ENV ?? 'development'),
  authCookieName: optionalEnv('AUTH_COOKIE_NAME', 'canp_auth'),
  authCookieSecure: optionalBooleanEnv('AUTH_COOKIE_SECURE', false),
  adminEmail: optionalEnv('ADMIN_EMAIL', 'admin@local'),
  adminPassword: optionalEnv('ADMIN_PASSWORD', 'change-me'),
} as const;
