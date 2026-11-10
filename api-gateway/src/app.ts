import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { httpMetricsMiddleware, metricsHandler, recordUpstream } from './metrics';

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3001';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3002';

app.use(httpMetricsMiddleware);
app.use(cors());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

app.get('/metrics', metricsHandler);

// Proxy to Product Service
app.use('/api/products', createProxyMiddleware({
  target: PRODUCT_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/api/products': '/products',
  },
  onProxyReq: (_proxyReq, req) => {
    (req as { _upstreamStart?: bigint })._upstreamStart = process.hrtime.bigint();
  },
  onProxyRes: (proxyRes, req) => {
    const start = (req as { _upstreamStart?: bigint })._upstreamStart;
    const duration = start ? Number(process.hrtime.bigint() - start) / 1e9 : 0;
    recordUpstream('product-service', proxyRes.statusCode ?? 0, duration);
  },
}));

// Proxy to Payment Service
app.use('/api/payments', createProxyMiddleware({
  target: PAYMENT_SERVICE_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/api/payments': '/payments',
  },
  onProxyReq: (_proxyReq, req) => {
    (req as { _upstreamStart?: bigint })._upstreamStart = process.hrtime.bigint();
  },
  onProxyRes: (proxyRes, req) => {
    const start = (req as { _upstreamStart?: bigint })._upstreamStart;
    const duration = start ? Number(process.hrtime.bigint() - start) / 1e9 : 0;
    recordUpstream('payment-service', proxyRes.statusCode ?? 0, duration);
  },
}));

// Body parsing must run AFTER the proxy routes. Parsing earlier consumes the
// request stream and makes proxied POST/PUT/PATCH requests hang upstream.
app.use(express.json());

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'Route not found' });
});

const server = app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
  console.log(`Product Service target: ${PRODUCT_SERVICE_URL}`);
  console.log(`Payment Service target: ${PAYMENT_SERVICE_URL}`);
});

let shuttingDown = false;

const shutdown = (signal: NodeJS.Signals): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, closing API Gateway`);

  const forceExit = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close((error) => {
    if (error) {
      console.error('Error during shutdown', error);
      process.exit(1);
    }
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
