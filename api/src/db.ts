import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load env before the pool reads process.env (imports hoist above index.ts's dotenv call).
dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'pantau',
  user: process.env.DB_USER || 'pantau',
  password: process.env.DB_PASSWORD || 'pantau',
});

const schema = `
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
    type VARCHAR(20) NOT NULL DEFAULT 'auto',  -- auto | manual
    url VARCHAR(500),                            -- for manual monitors
    status VARCHAR(10) DEFAULT 'unknown',        -- up | down | unknown
    last_checked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, method, path)
  );

  CREATE TABLE IF NOT EXISTS heartbeats (
    id SERIAL PRIMARY KEY,
    endpoint_id INTEGER REFERENCES endpoints(id) ON DELETE CASCADE,
    status_code INTEGER,
    response_time_ms INTEGER,
    status VARCHAR(10) NOT NULL,                 -- up | down
    error_message TEXT,
    checked_at TIMESTAMP DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_heartbeats_endpoint_checked
    ON heartbeats(endpoint_id, checked_at DESC);

  CREATE INDEX IF NOT EXISTS idx_endpoints_project
    ON endpoints(project_id);

  CREATE INDEX IF NOT EXISTS idx_users_api_key
    ON users(api_key);

  -- Per-request log store (ELK-style). One row per HTTP request the SDK sees.
  -- No SERIAL PK: TimescaleDB hypertables need the time column in any unique key.
  CREATE TABLE IF NOT EXISTS request_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    endpoint_id INTEGER,
    project_id INTEGER,
    method VARCHAR(10) NOT NULL,
    path VARCHAR(500) NOT NULL,
    status_code INTEGER,
    response_time_ms INTEGER,
    error_message TEXT,
    request_body JSONB,   -- redacted client-side; null unless capture.body
    response_body JSONB,  -- redacted client-side
    headers JSONB,        -- redacted client-side; null unless capture.headers
    logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Add body/header columns for tables created before capture support.
  ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS request_body JSONB;
  ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS response_body JSONB;
  ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS headers JSONB;

  CREATE INDEX IF NOT EXISTS idx_request_logs_project_time
    ON request_logs(project_id, logged_at DESC);
  CREATE INDEX IF NOT EXISTS idx_request_logs_endpoint_time
    ON request_logs(endpoint_id, logged_at DESC);
  CREATE INDEX IF NOT EXISTS idx_request_logs_status
    ON request_logs(status_code, logged_at DESC);
`;

// Endpoint quota per tier (PRD §6). null = unlimited.
export const TIER_LIMITS: Record<string, number | null> = {
  free: 3,
  starter: 20,
  pro: 100,
  business: null,
};

/** Current endpoint count owned by a user across all projects. */
export async function countUserEndpoints(userId: number): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM endpoints e
     JOIN projects p ON e.project_id = p.id
     WHERE p.user_id = $1`,
    [userId]
  );
  return r.rows[0].n;
}

const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '7');

export async function initDB(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(schema);
    await setupLogStore(client);
  } finally {
    client.release();
  }
}

/**
 * Turn request_logs into a TimescaleDB hypertable with a retention policy if
 * the extension is available; otherwise leave it as a plain indexed table.
 * Idempotent — safe to run every boot.
 */
async function setupLogStore(client: import('pg').PoolClient): Promise<void> {
  const ext = await client.query(
    "SELECT installed_version FROM pg_available_extensions WHERE name = 'timescaledb'"
  );
  if (ext.rows.length === 0) {
    console.log('[db] TimescaleDB not available — request_logs is a plain table (retention: manual)');
    return;
  }

  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
    // create_hypertable is a no-op if already one; migrate existing rows.
    await client.query(
      "SELECT create_hypertable('request_logs', 'logged_at', if_not_exists => TRUE, migrate_data => TRUE)"
    );
    await client.query(
      `SELECT add_retention_policy('request_logs', INTERVAL '${LOG_RETENTION_DAYS} days', if_not_exists => TRUE)`
    );
    console.log(`[db] TimescaleDB hypertable ready (retention: ${LOG_RETENTION_DAYS}d)`);
  } catch (err: any) {
    // e.g. extension present but not preloaded, or PG-version mismatch.
    console.warn(`[db] TimescaleDB setup skipped: ${err.message} — using plain table`);
  }
}
