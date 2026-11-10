import { Request, Response } from 'express';
import { paymentStore } from '../store';
import { PaymentInput } from '../models/Payment';
import { isDbUnavailableError } from '../db';
import axios from 'axios';

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3001';
const STOCK_REQUEST_TIMEOUT_MS = 3000;
const MAX_ATTEMPTS = 3;
const PAYMENT_PROCESSING_DELAY_MS = 100;

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

/**
 * Only errors raised by the payment service's own `pg` pool count as a payment
 * database outage. Axios failures (for example ECONNREFUSED to the product
 * service) must be classified as product-service unavailability instead.
 */
const isPaymentDbUnavailable = (error: unknown): boolean =>
  !axios.isAxiosError(error) && isDbUnavailableError(error);

/**
 * Reserve one unit of stock with a single atomic mutation.
 * Mutations are never retried blindly: an ambiguous outcome could decrement twice
 * for a single payment. A retryable read is safe, a blind mutation retry is not.
 */
const decrementProductStockOnce = async (productId: string): Promise<void> => {
  await axios.patch(
    `${PRODUCT_SERVICE_URL}/products/${productId}/stock`,
    { decrease: 1 },
    { timeout: STOCK_REQUEST_TIMEOUT_MS }
  );
};

/** Best-effort compensation for a committed decrement whose completion write failed. */
const compensateProductStock = async (productId: string): Promise<void> => {
  try {
    await axios.patch(
      `${PRODUCT_SERVICE_URL}/products/${productId}/stock`,
      { increment: 1 },
      { timeout: STOCK_REQUEST_TIMEOUT_MS }
    );
    console.warn(
      `Compensated stock for product ${productId}: incremented by 1 after a failed completion write`
    );
  } catch (error) {
    console.error(
      `Failed to compensate stock for product ${productId}; manual reconciliation may be required:`,
      error instanceof Error ? error.message : error
    );
  }
};

type MockCardOutcome = 'success' | 'declined' | 'processing-failed';

const decideMockCardOutcome = (cardNumber: string): MockCardOutcome => {
  if (cardNumber.startsWith('4111')) return 'success';
  if (cardNumber.startsWith('4000')) return 'declined';
  return Math.random() > 0.1 ? 'success' : 'processing-failed';
};

const markPaymentFailed = async (paymentId: string, errorMessage: string): Promise<void> => {
  try {
    const updated = await paymentStore.updateStatus(paymentId, 'failed', errorMessage);
    if (!updated) {
      console.warn(`Payment ${paymentId} could not be marked failed; it is no longer pending`);
    }
  } catch (error) {
    console.error(
      `Failed to persist failed status for payment ${paymentId}:`,
      error instanceof Error ? error.message : error
    );
  }
};

/**
 * Decrement-first payment saga:
 *   success card -> atomic decrement (single attempt) -> mark completed.
 * A payment is never marked completed unless the decrement committed.
 */
const processPayment = async (
  paymentId: string,
  productId: string,
  cardNumber: string
): Promise<void> => {
  const outcome = decideMockCardOutcome(cardNumber);

  if (outcome === 'declined') {
    await markPaymentFailed(paymentId, 'Card declined');
    return;
  }
  if (outcome === 'processing-failed') {
    await markPaymentFailed(paymentId, 'Payment processing failed');
    return;
  }

  try {
    await decrementProductStockOnce(productId);
  } catch (error) {
    const insufficientStock = axios.isAxiosError(error) && error.response?.status === 422;
    const message = insufficientStock ? 'Insufficient stock' : 'Failed to reserve stock';
    console.error(
      `Stock decrement failed for payment ${paymentId} (product ${productId}):`,
      error instanceof Error ? error.message : error
    );
    await markPaymentFailed(paymentId, message);
    return;
  }

  try {
    const completed = await paymentStore.updateStatus(paymentId, 'completed');
    if (!completed) {
      console.error(
        `Stock was decremented for payment ${paymentId} but the completion write did not apply; compensating`
      );
      await compensateProductStock(productId);
    }
  } catch (error) {
    console.error(
      `Stock was decremented for payment ${paymentId} but the completion write failed; compensating:`,
      error instanceof Error ? error.message : error
    );
    await compensateProductStock(productId);
  }
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
        const payment = await paymentStore.create(paymentInput);
        await paymentStore.updateStatus(payment.id, 'failed', 'Insufficient stock');
        return res.status(422).json({ error: 'Unprocessable Entity', message: 'Insufficient stock' });
      }
    } catch (error) {
      if (isProductNotFound(error)) {
        return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
      }

      if (isPaymentDbUnavailable(error)) {
        console.error('Payment database unavailable while recording a validation failure:', error);
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'Payment database is unavailable',
        });
      }

      console.error('Product service unavailable while validating stock:', error);
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Product service is unavailable',
      });
    }

    // Persist the payment as pending before any stock mutation.
    const payment = await paymentStore.create(paymentInput);

    setTimeout(() => {
      void processPayment(payment.id, paymentInput.productId, paymentInput.cardDetails.number);
    }, PAYMENT_PROCESSING_DELAY_MS);

    return res.status(201).json(payment);
  } catch (error) {
    if (isPaymentDbUnavailable(error)) {
      console.error('Payment database unavailable:', error);
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Payment database is unavailable',
      });
    }

    console.error('Payment error:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to process payment' });
  }
};

export const getPaymentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const payment = await paymentStore.getById(id);

    if (!payment) {
      return res.status(404).json({ error: 'Not Found', message: 'Payment not found' });
    }

    return res.json(payment);
  } catch (error) {
    if (isPaymentDbUnavailable(error)) {
      console.error('Payment database unavailable:', error);
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Payment database is unavailable',
      });
    }

    console.error('Failed to fetch payment:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch payment' });
  }
};

export const getAllPayments = async (req: Request, res: Response) => {
  try {
    const payments = await paymentStore.getAll();
    return res.json(payments);
  } catch (error) {
    if (isPaymentDbUnavailable(error)) {
      console.error('Payment database unavailable:', error);
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Payment database is unavailable',
      });
    }

    console.error('Failed to fetch payments:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch payments' });
  }
};
