import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is missing. Put it in a .env file in the project root.\n' +
    'Example:\n' +
    'DATABASE_URL=postgresql://postgres.aodndbsmkhzrgckfcask:YOUR-PASSWORD@aws-1-eu-north-1.pooler.supabase.com:5432/postgres'
  );
}

// --- Load the CA bundle you downloaded from Supabase → Database → SSL Configuration ---
const caFileCandidates = [
  'prod-ca-2021.crt',
  'prod-ca-2021.pem',
  'global-bundle.pem',
  'ca-certificate.crt',
];
let caPath: string | null = null;
for (const name of caFileCandidates) {
  const p = path.resolve(process.cwd(), name);
  if (fs.existsSync(p)) { caPath = p; break; }
}
if (!caPath) {
  throw new Error(
    'Could not find a CA certificate file in project root. ' +
    'Place the downloaded certificate (e.g. prod-ca-2021.crt or global-bundle.pem) in the project root.'
  );
}
const ca = fs.readFileSync(caPath, 'utf8');

export const pool = new Pool({
  connectionString: url.replace(/\?sslmode=require$/i, ''), // pg ignores sslmode; we set ssl below
  ssl: {
    ca,                         // trust Supabase CA
    rejectUnauthorized: true,   // strict verification ON
    minVersion: 'TLSv1.2',
  },
});

export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const res = await fn(client);
    await client.query('commit');
    return res;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
