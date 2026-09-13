import fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy server/.env.example to server/.env.');
}

// Vultr requires TLS. With DATABASE_CA_PATH set we verify the server certificate;
// without it we still encrypt but skip verification (equivalent to sslmode=require).
const ca = process.env.DATABASE_CA_PATH ? fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8') : undefined;

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: Boolean(ca), ca },
  // Vultr's connection pool (PgBouncer, transaction mode) sits in front of Postgres,
  // so keep our own pool small. node-postgres does not use named prepared statements
  // by default, which is what transaction mode requires.
  max: 5,
});

export const db = drizzle(pool, { schema });
