import path from 'path';
import dotenv from 'dotenv';

// The server is launched from server/ (npm scripts), but resolve the .env file
// relative to this file so `npm start` from dist/ finds the same file.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${key}. Copy server/.env.example to server/.env and fill it in.`,
    );
  }
  return value;
}

function numberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be a number, received "${raw}".`);
  }
  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: numberEnv('PORT', 5000),
  databaseUrl: requireEnv('DATABASE_URL'),
  jwtSecret: requireEnv('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  bcryptRounds: numberEnv('BCRYPT_ROUNDS', 10),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
} as const;

export const isProduction = env.nodeEnv === 'production';

// A short JWT secret makes tokens trivially forgeable. Refuse to boot with one.
if (env.jwtSecret.length < 32 && isProduction) {
  throw new Error('JWT_SECRET must be at least 32 characters in production.');
}
