import pg from 'pg'; // Ensure pg is imported if not already
import { readFileSync } from 'fs'; // Ensure readFileSync is imported

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL environment variable is not set.');
}

// --- Load the CA bundle you downloaded from Supabase → Database → SSL Configuration ---
const ca = readFileSync('./prod-ca-2021.crt').toString(); // Assuming ca-certificate.crt is in the root

export const pool = new Pool({
  connectionString: url.replace(/\?sslmode=require$/i, ''),
  ssl: {
    ca,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  },
});

// ADDED: Error handler for the pool
pool.on('error', (err, client) => {
  console.error('[db] Unexpected error on idle client', err);
  // You might want to add more sophisticated error handling here,
  // such as logging to a service or attempting to reconnect.
});

export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}