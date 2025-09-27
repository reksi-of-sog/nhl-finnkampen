import 'dotenv/config';
import { Pool } from 'pg';


const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
throw new Error('DATABASE_URL is not set');
}


export const pool = new Pool({ connectionString });


export async function withTx<T>(fn: (client: any) => Promise<T>): Promise<T> {
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