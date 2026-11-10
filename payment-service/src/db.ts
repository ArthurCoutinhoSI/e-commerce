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

const PAYMENTS_DDL = `
  CREATE TABLE IF NOT EXISTS payments (
    id uuid PRIMARY KEY,
    amount numeric(12,2) NOT NULL CHECK (amount > 0),
    currency varchar(3) NOT NULL DEFAULT 'USD',
    status text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','completed','failed','cancelled')),
    payment_method text NOT NULL,
    product_id text NOT NULL,
    order_reference text,
    customer_info jsonb,
    card_last4 varchar(4),
    card_brand text,
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    error_message text
  );

  CREATE INDEX IF NOT EXISTS payments_created_at_idx
    ON payments (created_at, id);

  CREATE INDEX IF NOT EXISTS payments_product_id_idx
    ON payments (product_id);
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
        await client.query(PAYMENTS_DDL);
      } finally {
        client.release();
      }
      console.log('Payment database schema ready');
      return;
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `Payment database connection attempt ${attempt}/${MAX_ATTEMPTS} failed${
          code ? ` (${code})` : ''
        }: ${message}`
      );

      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
      }
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Unable to initialize the payment database after retries: ${detail}`);
};

export const query = (text: string, params?: unknown[]) => pool.query(text, params);

export const closePool = async (): Promise<void> => {
  await pool.end();
};
