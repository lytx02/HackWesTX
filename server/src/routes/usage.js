import { Router } from 'express';
import { requireUser } from '../auth.js';
import { wrap } from '../http.js';
import { getUsage } from '../usage.js';

export const usageRouter = Router();
usageRouter.use(requireUser);

usageRouter.get(
  '/ai/usage',
  wrap(async (req, res) => {
    res.json(await getUsage(req.user.id));
  })
);

