// Prisma 7 configuration file.
// Connection URLs are defined here instead of in `schema.prisma`.
//
// This keeps secrets out of the schema file and aligns with
// the new Prisma 7 datasource configuration model.

import { defineConfig } from '@prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    db: {
      provider: 'postgresql',
      url: process.env.DATABASE_URL!,
      directUrl: process.env.DATABASE_URL
    }
  }
});

