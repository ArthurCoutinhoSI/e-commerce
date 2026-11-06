import express from 'express';
import cors from 'cors';
import paymentRoutes from './routes/payments';

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'payment-service' });
});

app.use('/payments', paymentRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`Payment Service running on port ${PORT}`);
});
