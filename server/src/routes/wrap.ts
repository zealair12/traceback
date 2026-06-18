// Tiny adapter so route handlers can be plain async functions.
//
// Express 4 does not catch a rejected promise on its own, so every async
// handler used to wrap its body in try/catch just to forward errors. This
// helper does that forwarding once; any error a handler throws lands in the
// shared error middleware.

import type { Request, Response, NextFunction } from 'express';

export const wrap =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
