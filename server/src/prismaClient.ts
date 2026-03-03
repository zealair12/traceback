// Centralized Prisma Client instance.
// This file is the single source of truth for how the backend
// talks to the PostgreSQL database via Prisma.
//
// Other modules (routing, services, etc.) import this client
// instead of creating their own instances. This ensures:
// - Only one PrismaClient is created per process.
// - The same connection pool is reused across the application.

import { PrismaClient } from '@prisma/client';

// In development, it's common to use a global variable to avoid
// creating multiple PrismaClient instances when hot-reloading.
// In production, we can safely instantiate a new client.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn']
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

