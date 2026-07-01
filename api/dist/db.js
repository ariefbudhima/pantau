"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.initDB = initDB;
const pg_1 = require("pg");
exports.pool = new pg_1.Pool({
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
`;
async function initDB() {
    const client = await exports.pool.connect();
    try {
        await client.query(schema);
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=db.js.map