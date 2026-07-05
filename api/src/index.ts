import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { pool, initDB } from './db';
import authRoutes from './routes/auth';
import endpointRoutes from './routes/endpoints';
import heartbeatRoutes from './routes/heartbeats';
import ingestRoutes from './routes/ingest';
import logRoutes from './routes/logs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/endpoints', endpointRoutes);
app.use('/api/heartbeats', heartbeatRoutes);
app.use('/api/ingest', ingestRoutes);
app.use('/api/logs', logRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve dashboard static files (catch-all for SPA routing).
// In dev the dashboard runs via Vite; only mount this if a build exists.
const dashboardPath = path.join(__dirname, '../../dashboard/dist');
const indexHtml = path.join(dashboardPath, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.use(express.static(dashboardPath));
  // SPA fallback: only serve index.html for non-API paths
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(indexHtml);
  });
}

// Init DB and start
async function start() {
  try {
    await initDB();
    console.log('Database initialized');
    
    app.listen(PORT, () => {
      console.log(`Pantau API running on :${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();

export default app;
