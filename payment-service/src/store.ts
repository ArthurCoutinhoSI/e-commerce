import { Payment, PaymentInput, PaymentStatus } from './models/Payment';
import { v4 as uuidv4 } from 'uuid';
import { query } from './db';

interface PaymentRow {
  id: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  payment_method: string;
  product_id: string;
  order_reference: string | null;
  customer_info: unknown;
  card_last4: string | null;
  card_brand: string | null;
  created_at: Date;
  processed_at: Date | null;
  error_message: string | null;
}

const toPayment = (row: PaymentRow): Payment => {
  const payment: Payment = {
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    paymentMethod: row.payment_method,
    productId: row.product_id,
    createdAt: row.created_at.toISOString(),
  };

  if (row.order_reference !== null) payment.orderReference = row.order_reference;
  if (row.customer_info !== null) payment.customerInfo = row.customer_info;
  if (row.card_last4 !== null && row.card_brand !== null) {
    payment.cardDetails = {
      last4: row.card_last4,
      brand: row.card_brand,
    };
  }
  if (row.processed_at !== null) payment.processedAt = row.processed_at.toISOString();
  if (row.error_message !== null) payment.errorMessage = row.error_message;

  return payment;
};

const isInvalidUuidError = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === '22P02';

const deriveCardSummary = (cardNumber: string): { last4: string; brand: string } => ({
  last4: cardNumber.slice(-4),
  brand: cardNumber.startsWith('4') ? 'visa' : cardNumber.startsWith('5') ? 'mastercard' : 'unknown',
});

class PaymentStore {
  async getAll(): Promise<Payment[]> {
    const result = await query('SELECT * FROM payments ORDER BY created_at ASC, id ASC');
    return result.rows.map((row) => toPayment(row as PaymentRow));
  }

  async getById(id: string): Promise<Payment | undefined> {
    try {
      const result = await query('SELECT * FROM payments WHERE id = $1', [id]);
      return result.rows[0] ? toPayment(result.rows[0] as PaymentRow) : undefined;
    } catch (error) {
      if (isInvalidUuidError(error)) return undefined;
      throw error;
    }
  }

  async create(paymentInput: PaymentInput): Promise<Payment> {
    const cardNumber = paymentInput.cardDetails?.number || '';
    const { last4, brand } = deriveCardSummary(cardNumber);

    const result = await query(
      `INSERT INTO payments (
         id, amount, currency, status, payment_method, product_id,
         order_reference, customer_info, card_last4, card_brand, created_at
       )
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, now())
       RETURNING *`,
      [
        uuidv4(),
        paymentInput.amount,
        paymentInput.currency || 'USD',
        paymentInput.paymentMethod,
        paymentInput.productId,
        paymentInput.orderReference ?? null,
        paymentInput.customerInfo ?? null,
        last4,
        brand,
      ]
    );

    return toPayment(result.rows[0] as PaymentRow);
  }

  async updateStatus(
    id: string,
    status: Exclude<PaymentStatus, 'pending'>,
    errorMessage?: string
  ): Promise<Payment | undefined> {
    try {
      const result = await query(
        `UPDATE payments
         SET status = $2,
             processed_at = now(),
             error_message = $3
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [id, status, errorMessage ?? null]
      );

      if (!result.rows[0]) {
        console.warn(
          `Payment ${id} was not updated to "${status}": no pending payment matched (it may already be terminal)`
        );
        return undefined;
      }

      return toPayment(result.rows[0] as PaymentRow);
    } catch (error) {
      if (isInvalidUuidError(error)) return undefined;
      throw error;
    }
  }
}

export const paymentStore = new PaymentStore();
