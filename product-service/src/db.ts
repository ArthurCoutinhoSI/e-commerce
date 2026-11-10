import { Pool } from 'pg';

const MAX_ATTEMPTS = 9;
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 3000, 4000, 5000, 5000, 4000];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (error) => {
  console.error(`Unexpected PostgreSQL pool error: ${error.message}`);
});

const PRODUCTS_DDL = `
  CREATE TABLE IF NOT EXISTS products (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    description text NOT NULL,
    price numeric(12,2) NOT NULL CHECK (price > 0),
    stock_quantity integer NOT NULL CHECK (stock_quantity >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS products_created_at_idx
    ON products (created_at, id);
`;

const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '53300',
]);

export const isDbUnavailableError = (error: unknown): boolean => {
  const code = (error as { code?: string } | null)?.code;
  if (code && DB_UNAVAILABLE_CODES.has(code)) return true;

  const message = error instanceof Error ? error.message : String(error ?? '');
  return /connection terminated|connection timeout|not connected|pool is closed|client has encountered a connection error|database system is (starting up|shutting down)/i.test(
    message
  );
};

export const initDb = async (): Promise<void> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const client = await pool.connect();
      try {
        await client.query(PRODUCTS_DDL);
      } finally {
        client.release();
      }
      console.log('Product database schema ready');
      return;
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `Product database connection attempt ${attempt}/${MAX_ATTEMPTS} failed${
          code ? ` (${code})` : ''
        }: ${message}`
      );

      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
      }
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Unable to initialize the product database after retries: ${detail}`);
};

export const query = (text: string, params?: unknown[]) => pool.query(text, params);

export const getPoolStats = (): { total: number; idle: number; waiting: number } => ({
  total: pool.totalCount,
  idle: pool.idleCount,
  waiting: pool.waitingCount,
});

export const closePool = async (): Promise<void> => {
  await pool.end();
};
