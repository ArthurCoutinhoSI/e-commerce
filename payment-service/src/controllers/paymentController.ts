import { Request, Response } from 'express';
import { paymentStore } from '../store';
import { PaymentInput } from '../models/Payment';
import axios from 'axios';

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3001';
const STOCK_REQUEST_TIMEOUT_MS = 3000;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryable = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false;
  // Network errors, timeouts, and 5xx responses are worth retrying.
  if (!error.response) return true;
  return error.response.status >= 500;
};

const requestWithRetry = async <T>(request: () => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(200 * attempt);
    }
  }

  throw lastError;
};

const isProductNotFound = (error: unknown): boolean =>
  axios.isAxiosError(error) && error.response?.status === 404;

const decreaseProductStock = async (productId: string): Promise<void> => {
  await requestWithRetry(() =>
    axios.patch(
      `${PRODUCT_SERVICE_URL}/products/${productId}/stock`,
      { decrease: 1 },
      { timeout: STOCK_REQUEST_TIMEOUT_MS }
    )
  );
};

export const createPayment = async (req: Request, res: Response) => {
  try {
    const paymentInput: PaymentInput = req.body;

    // Validation
    if (!paymentInput.amount || paymentInput.amount <= 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'Amount must be a positive number' });
    }
    if (!paymentInput.paymentMethod) {
      return res.status(400).json({ error: 'Bad Request', message: 'Payment method is required' });
    }
    if (!paymentInput.productId) {
      return res.status(400).json({ error: 'Bad Request', message: 'Product ID is required' });
    }
    if (!paymentInput.cardDetails || !paymentInput.cardDetails.number) {
      return res.status(400).json({ error: 'Bad Request', message: 'Card details are required' });
    }

    // Check if product exists and has stock
    try {
      const productResponse = await requestWithRetry(() =>
        axios.get(`${PRODUCT_SERVICE_URL}/products/${paymentInput.productId}`, {
          timeout: STOCK_REQUEST_TIMEOUT_MS,
        })
      );
      const product = productResponse.data;

      if (product.stockQuantity < 1) {
        const payment = paymentStore.create(paymentInput);
        paymentStore.updateStatus(payment.id, 'failed', 'Insufficient stock');
        return res.status(422).json({ error: 'Unprocessable Entity', message: 'Insufficient stock' });
      }
    } catch (error) {
      if (isProductNotFound(error)) {
        return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
      }

      console.error('Product service unavailable while validating stock:', error);
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Product service is unavailable',
      });
    }

    // Create payment
    const payment = paymentStore.create(paymentInput);

    // Process payment (mock)
    setTimeout(async () => {
      // Mock payment processing - succeed for test card 4111111111111111, fail otherwise for demo
      const cardNumber = paymentInput.cardDetails.number;
      if (cardNumber.startsWith('4111')) {
        // Success - update payment and decrease stock
        paymentStore.updateStatus(payment.id, 'completed');
        try {
          await decreaseProductStock(paymentInput.productId);
        } catch (err) {
          console.error('Failed to update stock:', err);
        }
      } else if (cardNumber.startsWith('4000')) {
        paymentStore.updateStatus(payment.id, 'failed', 'Card declined');
      } else {
        // Random success/failure for other cards
        const success = Math.random() > 0.1; // 90% success rate
        if (success) {
          paymentStore.updateStatus(payment.id, 'completed');
          try {
            await decreaseProductStock(paymentInput.productId);
          } catch (err) {
            console.error('Failed to update stock:', err);
          }
        } else {
          paymentStore.updateStatus(payment.id, 'failed', 'Payment processing failed');
        }
      }
    }, 100); // Simulate processing delay

    res.status(201).json(payment);
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to process payment' });
  }
};

export const getPaymentById = (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const payment = paymentStore.getById(id);

    if (!payment) {
      return res.status(404).json({ error: 'Not Found', message: 'Payment not found' });
    }

    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch payment' });
  }
};

export const getAllPayments = (req: Request, res: Response) => {
  try {
    const payments = paymentStore.getAll();
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch payments' });
  }
};
