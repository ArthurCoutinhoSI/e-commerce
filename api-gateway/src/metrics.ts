import { Request, Response, NextFunction } from 'express';
import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const SERVICE = 'api-gateway';

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

export const gatewayUpstreamRequestsTotal = new client.Counter({
  name: 'gateway_upstream_requests_total',
  help: 'Requests forwarded to a backend service',
  labelNames: ['service', 'upstream', 'status_code'],
  registers: [register],
});

export const gatewayUpstreamDurationSeconds = new client.Histogram({
  name: 'gateway_upstream_duration_seconds',
  help: 'Backend call latency in seconds',
  labelNames: ['service', 'upstream'],
  buckets: HTTP_BUCKETS,
  registers: [register],
});

export const normalizeRoute = (req: Request): string => {
  const segments = (req.originalUrl || req.url || '').split('?')[0].split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  const normalized = segments.map((segment) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^\d+$/.test(segment)
      ? ':id'
      : segment
  );
  return '/' + normalized.join('/');
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

export const recordUpstream = (upstream: string, statusCode: number, durationSeconds: number): void => {
  gatewayUpstreamRequestsTotal.inc({ service: SERVICE, upstream, status_code: String(statusCode) });
  gatewayUpstreamDurationSeconds.observe({ service: SERVICE, upstream }, durationSeconds);
};

export const metricsHandler = async (_req: Request, res: Response): Promise<void> => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
};
