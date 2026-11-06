export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: string;
  productId?: string;
  orderReference?: string;
  customerInfo?: any;
  cardDetails?: {
    last4: string;
    brand: string;
  };
  createdAt: string;
  processedAt?: string;
  errorMessage?: string;
}

export interface PaymentInput {
  amount: number;
  currency?: string;
  paymentMethod: string;
  productId: string;
  orderReference?: string;
  customerInfo?: any;
  cardDetails: {
    number: string;
    expiryMonth: number;
    expiryYear: number;
    cvv: string;
  };
}
