import { Request, Response } from 'express';
import { paymentStore } from '../store';
import { PaymentInput } from '../models/Payment';
import axios from 'axios';

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
      const productResponse = await axios.get(`http://localhost:3001/products/${paymentInput.productId}`);
      const product = productResponse.data;
      
      if (product.stockQuantity < 1) {
        const payment = paymentStore.create(paymentInput);
        paymentStore.updateStatus(payment.id, 'failed', 'Insufficient stock');
        return res.status(422).json({ error: 'Unprocessable Entity', message: 'Insufficient stock' });
      }
    } catch (error) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
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
          await axios.patch(`http://localhost:3001/products/${paymentInput.productId}/stock`, {
            decrease: 1,
          });
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
            await axios.patch(`http://localhost:3001/products/${paymentInput.productId}/stock`, {
              decrease: 1,
            });
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
