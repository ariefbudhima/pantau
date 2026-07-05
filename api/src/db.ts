import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq } from 'drizzle-orm';
import dotenv from 'dotenv';
import * as schema from './schema';

// Load env before the pool reads process.env (imports hoist above index.ts's dotenv call).
dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'pantau',
  user: process.env.DB_USER || 'pantau',
  password: process.env.DB_PASSWORD || 'pantau',
});

export const db = drizzle(pool, { schema });

// Endpoint quota per tier (PRD §6). null = unlimited.
export const TIER_LIMITS: Record<string, number | null> = {
  free: 3,
  starter: 20,
  pro: 100,
  business: null,
};

/** Current endpoint count owned by a user across all projects. */
export async function countUserEndpoints(userId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.endpoints)
    .innerJoin(schema.projects, eq(schema.endpoints.projectId, schema.projects.id))
    .where(eq(schema.projects.userId, userId));
  return row.n;
}

// Schema DDL. Drizzle owns the table shapes (see schema.ts + drizzle-kit push),
// but the TimescaleDB bits — hypertable, retention — are extension features
// that live outside the ORM. We create tables idempotently here so the app is
// self-bootstrapping in dev, then layer Timescale on top.
const ddl = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    tier VARCHAR(20) DEFAULT 'free',
    api_key VARCHAR(64) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, slug)
  );
  CREATE TABLE IF NOT EXISTS endpoints (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255),
    method VARCHAR(10) NOT NULL DEFAULT 'GET',
    path VARCHAR(500) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'auto',
    url VARCHAR(500),
    status VARCHAR(10) DEFAULT 'unknown',
    last_checked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, method, path)
  );
  CREATE TABLE IF NOT EXISTS heartbeats (
    id SERIAL PRIMARY KEY,
    endpoint_id INTEGER REFERENCES endpoints(id) ON DELETE CASCADE,
    status_code INTEGER,
    response_time_ms INTEGER,
    status VARCHAR(10) NOT NULL,
    error_message TEXT,
    checked_at TIMESTAMP DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_heartbeats_endpoint_checked ON heartbeats(endpoint_id, checked_at DESC);
  CREATE INDEX IF NOT EXISTS idx_endpoints_project ON endpoints(project_id);
  CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);

  CREATE TABLE IF NOT EXISTS request_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    endpoint_id INTEGER,
    project_id INTEGER,
    method VARCHAR(10) NOT NULL,
    path VARCHAR(500) NOT NULL,
    status_code INTEGER,
    response_time_ms INTEGER,
    error_message TEXT,
    request_body JSONB,
    response_body JSONB,
    headers JSONB,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS request_body JSONB;
  ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS response_body JSONB;
  ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS headers JSONB;
  CREATE INDEX IF NOT EXISTS idx_request_logs_project_time ON request_logs(project_id, logged_at DESC);
  CREATE INDEX IF NOT EXISTS idx_request_logs_endpoint_time ON request_logs(endpoint_id, logged_at DESC);
  CREATE INDEX IF NOT EXISTS idx_request_logs_status ON request_logs(status_code, logged_at DESC);
`;

const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '7');

export async function initDB(): Promise<void> {
  await db.execute(sql.raw(ddl));
  await setupLogStore();
}

/**
 * Turn request_logs into a TimescaleDB hypertable with a retention policy if
 * the extension is available; otherwise leave it as a plain indexed table.
 * Idempotent — safe to run every boot.
 */
async function setupLogStore(): Promise<void> {
  const ext = await db.execute(
    sql`SELECT installed_version FROM pg_available_extensions WHERE name = 'timescaledb'`
  );
  if (ext.rows.length === 0) {
    console.log('[db] TimescaleDB not available — request_logs is a plain table (retention: manual)');
    return;
  }
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS timescaledb`);
    await db.execute(
      sql`SELECT create_hypertable('request_logs', 'logged_at', if_not_exists => TRUE, migrate_data => TRUE)`
    );
    await db.execute(
      sql.raw(`SELECT add_retention_policy('request_logs', INTERVAL '${LOG_RETENTION_DAYS} days', if_not_exists => TRUE)`)
    );
    console.log(`[db] TimescaleDB hypertable ready (retention: ${LOG_RETENTION_DAYS}d)`);
  } catch (err: any) {
    console.warn(`[db] TimescaleDB setup skipped: ${err.message} — using plain table`);
  }
}
