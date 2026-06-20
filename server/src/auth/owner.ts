// Resolves the "owner" of a request: a signed-in user's ID, or the guest's
// session-scoped ID. Every route that touches sessions uses this to ensure
// each person only sees their own data.

import type { Request } from 'express';

export interface Owner {
  userId?: string;
  guestId?: string;
}

export function getOwner(req: Request): Owner {
  const user = req.user as any;
  if (user?.id) return { userId: user.id };
  return { guestId: req.session.guestId };
}

// Prisma WHERE fragment to filter sessions by owner.
export function ownerWhere(req: Request) {
  const { userId, guestId } = getOwner(req);
  return userId ? { userId } : { guestId };
}
