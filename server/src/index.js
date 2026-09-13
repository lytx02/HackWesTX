import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import { authRouter } from './auth.js';
import { meRouter } from './routes/me.js';
import { classesRouter } from './routes/classes.js';
import { conversationsRouter } from './routes/conversations.js';
import { agentRouter } from './routes/agent.js';
import { canvasRouter } from './routes/canvas.js';
import { HttpError } from './http.js';
import { ping as pingLlm } from './llm.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);
const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim());

// Behind Nginx in production; trust X-Forwarded-* from the first proxy hop.
app.set('trust proxy', 1);
app.use(cors({ origin: origins }));
app.use(express.json({ limit: '256kb' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('select 1');
    res.json({ ok: true, db: 'up' });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'down', error: e.message });
  }
});

// Round trip to the vLLM server on RunPod: {ok, configured, model, models, latencyMs}.
app.get('/llm/health', async (_req, res) => {
  const r = await pingLlm();
  res.status(r.ok ? 200 : 503).json(r);
});

app.use(authRouter);
app.use(meRouter);
app.use(classesRouter);
app.use(conversationsRouter);
app.use(agentRouter);
app.use(canvasRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(port, () => console.log(`campus-ai api listening on http://localhost:${port} (auth: ${process.env.AUTH0_DOMAIN && process.env.AUTH0_AUDIENCE ? 'auth0 + legacy' : 'legacy only'})`));
