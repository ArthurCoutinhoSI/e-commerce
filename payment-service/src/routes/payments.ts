import { Router } from 'express';
import {
  createPayment,
  getPaymentById,
  getAllPayments,
} from '../controllers/paymentController';

const router = Router();

router.get('/', getAllPayments);
router.get('/:id', getPaymentById);
router.post('/', createPayment);

export default router;
