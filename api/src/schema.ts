import {
  pgTable, serial, bigint, integer, varchar, text, timestamp, jsonb, uniqueIndex, index,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  tier: varchar('tier', { length: 20 }).default('free'),
  apiKey: varchar('api_key', { length: 64 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [index('idx_users_api_key').on(t.apiKey)]);

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [uniqueIndex('projects_user_slug').on(t.userId, t.slug)]);

export const endpoints = pgTable('endpoints', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }),
  method: varchar('method', { length: 10 }).notNull().default('GET'),
  path: varchar('path', { length: 500 }).notNull(),
  type: varchar('type', { length: 20 }).notNull().default('auto'), // auto | manual
  url: varchar('url', { length: 500 }),
  status: varchar('status', { length: 10 }).default('unknown'),     // up | down | unknown
  lastCheckedAt: timestamp('last_checked_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('endpoints_project_method_path').on(t.projectId, t.method, t.path),
  index('idx_endpoints_project').on(t.projectId),
]);

export const heartbeats = pgTable('heartbeats', {
  id: serial('id').primaryKey(),
  endpointId: integer('endpoint_id').references(() => endpoints.id, { onDelete: 'cascade' }),
  statusCode: integer('status_code'),
  responseTimeMs: integer('response_time_ms'),
  status: varchar('status', { length: 10 }).notNull(),             // up | down
  errorMessage: text('error_message'),
  checkedAt: timestamp('checked_at').defaultNow(),
}, (t) => [index('idx_heartbeats_endpoint_checked').on(t.endpointId, t.checkedAt)]);

// Per-request log store (ELK-style). No serial PK: TimescaleDB hypertables need
// the time column in any unique key, so id is a plain generated identity.
export const requestLogs = pgTable('request_logs', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity(),
  endpointId: integer('endpoint_id'),
  projectId: integer('project_id'),
  method: varchar('method', { length: 10 }).notNull(),
  path: varchar('path', { length: 500 }).notNull(),
  statusCode: integer('status_code'),
  responseTimeMs: integer('response_time_ms'),
  errorMessage: text('error_message'),
  requestBody: jsonb('request_body'),   // redacted client-side
  responseBody: jsonb('response_body'), // redacted client-side
  headers: jsonb('headers'),            // redacted client-side
  loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_request_logs_project_time').on(t.projectId, t.loggedAt),
  index('idx_request_logs_endpoint_time').on(t.endpointId, t.loggedAt),
  index('idx_request_logs_status').on(t.statusCode, t.loggedAt),
]);
