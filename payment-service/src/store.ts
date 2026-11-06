import { Payment } from './models/Payment';
import { v4 as uuidv4 } from 'uuid';

class PaymentStore {
  private payments: Map<string, Payment> = new Map();

  getAll(): Payment[] {
    return Array.from(this.payments.values());
  }

  getById(id: string): Payment | undefined {
    return this.payments.get(id);
  }

  create(paymentInput: Omit<Payment, 'id' | 'createdAt' | 'status'> & { cardDetails?: any }): Payment {
    const now = new Date().toISOString();
    const cardNumber = paymentInput.cardDetails?.number || '';
    const last4 = cardNumber.slice(-4);
    const brand = cardNumber.startsWith('4') ? 'visa' : cardNumber.startsWith('5') ? 'mastercard' : 'unknown';
    
    const payment: Payment = {
      id: uuidv4(),
      amount: paymentInput.amount,
      currency: paymentInput.currency || 'USD',
      status: 'pending',
      paymentMethod: paymentInput.paymentMethod,
      productId: paymentInput.productId,
      orderReference: paymentInput.orderReference,
      customerInfo: paymentInput.customerInfo,
      cardDetails: {
        last4,
        brand,
      },
      createdAt: now,
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  updateStatus(id: string, status: Payment['status'], errorMessage?: string): Payment | undefined {
    const existing = this.payments.get(id);
    if (!existing) return undefined;
    
    const updated: Payment = {
      ...existing,
      status,
      processedAt: new Date().toISOString(),
      errorMessage,
    };
    this.payments.set(id, updated);
    return updated;
  }
}

export const paymentStore = new PaymentStore();
