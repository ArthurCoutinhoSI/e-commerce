import express from 'express';
import cors from 'cors';
import paymentRoutes from './routes/payments';
import { closePool, initDb } from './db';

const app = express();
const PORT = Number(process.env.PORT) || 3002;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'payment-service' });
});

app.use('/payments', paymentRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'Route not found' });
});

const start = async (): Promise<void> => {
  await initDb();

  const server = app.listen(PORT, () => {
    console.log(`Payment Service running on port ${PORT}`);
  });

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, closing Payment Service`);

    const forceExit = setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
    forceExit.unref();

    server.close(async (error) => {
      try {
        await closePool();
      } catch (poolError) {
        console.error('Error closing the payment database pool', poolError);
      }

      if (error) {
        console.error('Error during shutdown', error);
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch((error) => {
  console.error('Failed to start Payment Service:', error);
  process.exit(1);
});
