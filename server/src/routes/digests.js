import { Router } from 'express';
import { requireUser } from '../auth.js';
import { forbidden, wrap } from '../http.js';
import { generateDigest, getLatestDigest } from '../digests.js';
import { requireMember } from './classes.js';

function requireInstructor(req, _res, next) {
  if (req.membership !== 'instructor') return next(forbidden('Only the class instructor can access digests'));
  next();
}

// auth/membership/generate/latest are injectable so route authorization can be
// tested without a database. Production uses the real implementations.
export function createDigestsRouter({
  auth = requireUser,
  membership = requireMember,
  generate = generateDigest,
  latest = getLatestDigest,
} = {}) {
  const router = Router();
  router.use(auth);

  router.get(
    '/classes/:classId/digest',
    membership,
    requireInstructor,
    wrap(async (req, res) => {
      res.json(await latest(req.params.classId));
    })
  );

  router.post(
    '/classes/:classId/digest/generate',
    membership,
    requireInstructor,
    wrap(async (req, res) => {
      const controller = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on('close', onClose);
      try {
        const result = await generate({ classId: req.params.classId, generatedBy: req.user.id, signal: controller.signal });
        res.json(result);
      } finally {
        res.off('close', onClose);
      }
    })
  );

  return router;
}

export const digestsRouter = createDigestsRouter();
