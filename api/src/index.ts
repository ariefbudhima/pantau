import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool, initDB } from './db';
import authRoutes from './routes/auth';
import endpointRoutes from './routes/endpoints';
import heartbeatRoutes from './routes/heartbeats';
import ingestRoutes from './routes/ingest';

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

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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
