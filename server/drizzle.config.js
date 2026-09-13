import { defineConfig } from 'drizzle-kit';

// `generate` works offline. `migrate` and `studio` need DATABASE_URL from server/.env.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env yet; fine for generate */
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.js',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
