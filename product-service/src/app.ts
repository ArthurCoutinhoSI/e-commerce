import express from 'express';
import cors from 'cors';
import productRoutes from './routes/products';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'product-service' });
});

app.use('/products', productRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`Product Service running on port ${PORT}`);
});
