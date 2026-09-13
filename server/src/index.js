import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import { authRouter } from './auth.js';
import { meRouter } from './routes/me.js';
import { classesRouter } from './routes/classes.js';
import { conversationsRouter } from './routes/conversations.js';
import { HttpError } from './http.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);
const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim());

app.use(cors({ origin: origins }));
app.use(express.json({ limit: '64kb' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('select 1');
    res.json({ ok: true, db: 'up' });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'down', error: e.message });
  }
});

app.use(authRouter);
app.use(meRouter);
app.use(classesRouter);
app.use(conversationsRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(port, () => console.log(`campus-ai api listening on http://localhost:${port}`));
