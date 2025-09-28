import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

const url = process.env.DATABASE_URL;
console.log('DATABASE_URL =', url || '(missing)');

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
  console.error('CA file not found in project root. Put prod-ca-2021.crt or global-bundle.pem there.');
  process.exit(1);
}
const ca = fs.readFileSync(caPath, 'utf8');

const pool = new Pool({
  connectionString: (url || '').replace(/\?sslmode=require$/i, ''),
  ssl: {
    ca,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  },
});

pool.connect()
  .then(async (client) => {
    console.log('PG connection OK (strict CA verify)');
    const r = await client.query('select now() as ts');
    console.log('select now() =>', r.rows[0].ts);
    client.release();
    process.exit(0);
  })
  .catch((e) => {
    console.error('PG connection FAILED:', e);
    process.exit(1);
  });
