import { Request, Response, NextFunction } from 'express';
import client from 'prom-client';
import { getPoolStats, query } from './db';

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const SERVICE = 'payment-service';

const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests handled',
  labelNames: ['service', 'method', 'route', 'status_code'],
  registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['service', 'method', 'route'],
  buckets: HTTP_BUCKETS,
  registers: [register],
});

export const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'HTTP requests currently being processed',
  labelNames: ['service'],
  registers: [register],
});

export const httpErrorsTotal = new client.Counter({
  name: 'http_errors_total',
  help: 'HTTP requests ending in a 4xx or 5xx status',
  labelNames: ['service', 'method', 'route', 'status_code'],
  registers: [register],
});

export const paymentsCreatedTotal = new client.Counter({
  name: 'payments_created_total',
  help: 'Payments created',
  labelNames: ['service'],
  registers: [register],
});

export const paymentsCompletedTotal = new client.Counter({
  name: 'payments_completed_total',
  help: 'Payments reaching completed status',
  labelNames: ['service'],
  registers: [register],
});

export const paymentsFailedTotal = new client.Counter({
  name: 'payments_failed_total',
  help: 'Payments reaching failed status',
  labelNames: ['service', 'reason'],
  registers: [register],
});

export const paymentsPending = new client.Gauge({
  name: 'payments_pending',
  help: 'Payments currently in pending status',
  labelNames: ['service'],
  registers: [register],
});

export const stockDecrementsTotal = new client.Counter({
  name: 'stock_decrements_total',
  help: 'Stock decrement attempts by result',
  labelNames: ['service', 'result'],
  registers: [register],
});

export const stockCompensationsTotal = new client.Counter({
  name: 'stock_compensations_total',
  help: 'Compensating stock increments performed',
  labelNames: ['service'],
  registers: [register],
});

export const dbPoolSize = new client.Gauge({
  name: 'db_pool_size',
  help: 'Total database pool connections',
  labelNames: ['service'],
  registers: [register],
});

export const dbPoolIdle = new client.Gauge({
  name: 'db_pool_idle',
  help: 'Idle database pool connections',
  labelNames: ['service'],
  registers: [register],
});

export const dbPoolWaiting = new client.Gauge({
  name: 'db_pool_waiting',
  help: 'Clients waiting for a database connection',
  labelNames: ['service'],
  registers: [register],
});

export const normalizeRoute = (req: Request): string => {
  if (req.route?.path) {
    const base = req.baseUrl || '';
    const routePath = typeof req.route.path === 'string' ? req.route.path : '';
    return (base + routePath) || '/';
  }
  return 'unmatched';
};

export const httpMetricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (req.path === '/metrics' || req.path === '/health') {
    next();
    return;
  }

  const route = normalizeRoute(req);
  const start = process.hrtime.bigint();
  httpRequestsInFlight.inc({ service: SERVICE });

  res.on('finish', () => {
    httpRequestsInFlight.dec({ service: SERVICE });
    const statusCode = res.statusCode;
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestsTotal.inc({ service: SERVICE, method: req.method, route, status_code: String(statusCode) });
    httpRequestDurationSeconds.observe({ service: SERVICE, method: req.method, route }, duration);
    if (statusCode >= 400) {
      httpErrorsTotal.inc({ service: SERVICE, method: req.method, route, status_code: String(statusCode) });
    }
  });

  next();
};

export const refreshPaymentMetrics = async (): Promise<void> => {
  try {
    const result = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*)::int AS total
       FROM payments`
    );
    const row = result.rows[0] as { pending: number; total: number } | undefined;
    paymentsPending.set({ service: SERVICE }, row?.pending ?? 0);
  } catch {
    // Best-effort; metrics endpoint still returns last known values.
  }

  const stats = getPoolStats();
  dbPoolSize.set({ service: SERVICE }, stats.total);
  dbPoolIdle.set({ service: SERVICE }, stats.idle);
  dbPoolWaiting.set({ service: SERVICE }, stats.waiting);
};

export const metricsHandler = async (_req: Request, res: Response): Promise<void> => {
  await refreshPaymentMetrics();
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
};
