import { Request, Response } from 'express';
import { productStore } from '../store';
import { ProductInput } from '../models/Product';

export const getAllProducts = (req: Request, res: Response) => {
  
  // console.log("req chegou no microservice")
  try {
    const products = productStore.getAll();
    res.json(products);
    // console.log("passou getAllProducts")
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch products' });
  }
};

export const getProductById = (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = productStore.getById(id);
    
    if (!product) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
    }
    
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch product' });
  }
};

export const createProduct = (req: Request, res: Response) => {
  
  // console.log("req chegou no microservice")
  try {
    const productInput: ProductInput = req.body;
    
    // Validation
    if (!productInput.name || !productInput.description) {
      return res.status(400).json({ error: 'Bad Request', message: 'Name and description are required' });
    }
    if (typeof productInput.price !== 'number' || productInput.price <= 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'Price must be a positive number' });
    }
    if (typeof productInput.stockQuantity !== 'number' || productInput.stockQuantity < 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'Stock quantity must be a non-negative number' });
    }
    
    // console.log("passou validation")

    const product = productStore.create(productInput);
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create product' });
  }
};

export const updateProduct = (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Validation
    if (updates.price !== undefined && (typeof updates.price !== 'number' || updates.price <= 0)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Price must be a positive number' });
    }
    if (updates.stockQuantity !== undefined && (typeof updates.stockQuantity !== 'number' || updates.stockQuantity < 0)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Stock quantity must be a non-negative number' });
    }
    
    // 
    
    // console.log("passou validation")
    
    const product = productStore.update(id, updates);
    
    if (!product) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
    }
    
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update product' });
  }
};

export const deleteProduct = (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = productStore.delete(id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
    }
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to delete product' });
  }
};

export const updateStock = (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { stockQuantity, decrease } = req.body;
    
    let product;
    if (decrease !== undefined) {
      product = productStore.decreaseStock(id, decrease);
      if (!product) {
        return res.status(422).json({ error: 'Unprocessable Entity', message: 'Insufficient stock or product not found' });
      }
    } else if (stockQuantity !== undefined) {
      product = productStore.updateStock(id, stockQuantity);
      if (!product) {
        return res.status(404).json({ error: 'Not Found', message: 'Product not found' });
      }
    } else {
      return res.status(400).json({ error: 'Bad Request', message: 'stockQuantity or decrease must be provided' });
    }
    
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update stock' });
  }
};
