import { Request, Response } from 'express';
import { productStore } from '../store';
import { ProductInput } from '../models/Product';
import { isDbUnavailableError } from '../db';

const reportDbUnavailable = (res: Response, error: unknown): boolean => {
  if (!isDbUnavailableError(error)) return false;

  console.error('Product database unavailable:', error instanceof Error ? error.message : error);
  res.status(503).json({
    error: 'Service Unavailable',
    message: 'Product database is unavailable',
  });
  return true;
};

export const getAllProducts = async (req: Request, res: Response) => {
  try {
    const products = await productStore.getAll();
    return res.json(products);
  } catch (error) {
    if (reportDbUnavailable(res, error)) return;
    console.error('Failed to fetch products:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch products' });
  }
};

export const getProductById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = await productStore.getById(id);

    if (!product) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
    }

    return res.json(product);
  } catch (error) {
    if (reportDbUnavailable(res, error)) return;
    console.error('Failed to fetch product:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch product' });
  }
};

export const createProduct = async (req: Request, res: Response) => {
  try {
    const productInput: ProductInput = req.body;

    // Validation
    if (!productInput.name || !productInput.description) {
      return res.status(400).json({ error: 'Bad Request', message: 'Name and description are required' });
    }
    if (typeof productInput.price !== 'number' || productInput.price <= 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'Price must be a positive number' });
    }
    if (
      typeof productInput.stockQuantity !== 'number' ||
      !Number.isInteger(productInput.stockQuantity) ||
      productInput.stockQuantity < 0
    ) {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: 'Stock quantity must be a non-negative number' });
    }

    const product = await productStore.create(productInput);
    return res.status(201).json(product);
  } catch (error) {
    if (reportDbUnavailable(res, error)) return;
    console.error('Failed to create product:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create product' });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validation
    if (updates.price !== undefined && (typeof updates.price !== 'number' || updates.price <= 0)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Price must be a positive number' });
    }
    if (
      updates.stockQuantity !== undefined &&
      (typeof updates.stockQuantity !== 'number' ||
        !Number.isInteger(updates.stockQuantity) ||
        updates.stockQuantity < 0)
    ) {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: 'Stock quantity must be a non-negative number' });
    }

    const product = await productStore.update(id, updates);

    if (!product) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
    }

    return res.json(product);
  } catch (error) {
    if (reportDbUnavailable(res, error)) return;
    console.error('Failed to update product:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update product' });
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await productStore.delete(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
    }

    return res.status(204).send();
  } catch (error) {
    if (reportDbUnavailable(res, error)) return;
    console.error('Failed to delete product:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to delete product' });
  }
};

export const updateStock = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { stockQuantity, decrease, increment } = req.body ?? {};

    const provided = [stockQuantity, decrease, increment].filter((value) => value !== undefined);
    if (provided.length !== 1) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'stockQuantity, decrease, or increment must be provided',
      });
    }

    if (stockQuantity !== undefined) {
      if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
        return res
          .status(400)
          .json({ error: 'Bad Request', message: 'Stock quantity must be a non-negative number' });
      }

      const product = await productStore.updateStock(id, stockQuantity);
      if (!product) {
        return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
      }
      return res.json(product);
    }

    if (decrease !== undefined) {
      if (!Number.isInteger(decrease) || decrease < 1) {
        return res
          .status(400)
          .json({ error: 'Bad Request', message: 'decrease must be a positive integer' });
      }

      const product = await productStore.decreaseStock(id, decrease);
      if (!product) {
        return res
          .status(422)
          .json({ error: 'Unprocessable Entity', message: 'Insufficient stock or product not found' });
      }
      return res.json(product);
    }

    if (!Number.isInteger(increment) || increment < 1) {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: 'increment must be a positive integer' });
    }

    const product = await productStore.incrementStock(id, increment);
    if (!product) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
    }
    return res.json(product);
  } catch (error) {
    if (reportDbUnavailable(res, error)) return;
    console.error('Failed to update stock:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update stock' });
  }
};
