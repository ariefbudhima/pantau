import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'pantau',
    user: process.env.DB_USER || 'pantau',
    password: process.env.DB_PASSWORD || 'pantau',
    ssl: false,
  },
});
