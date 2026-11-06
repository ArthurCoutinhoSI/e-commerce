import { Product } from './models/Product';
import { v4 as uuidv4 } from 'uuid';

class ProductStore {
  private products: Map<string, Product> = new Map();

  getAll(): Product[] {
    return Array.from(this.products.values());
  }

  getById(id: string): Product | undefined {
    return this.products.get(id);
  }

  create(productInput: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Product {
    const now = new Date().toISOString();
    const product: Product = {
      id: uuidv4(),
      ...productInput,
      createdAt: now,
      updatedAt: now,
    };
    this.products.set(product.id, product);
    return product;
  }

  update(id: string, productInput: Partial<Omit<Product, 'id' | 'createdAt'>>): Product | undefined {
    const existing = this.products.get(id);
    if (!existing) return undefined;
    
    const updated: Product = {
      ...existing,
      ...productInput,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.products.set(id, updated);
    return updated;
  }
  
  delete(id: string): boolean {
    return this.products.delete(id);
  }

  updateStock(id: string, quantity: number): Product | undefined {
    const existing = this.products.get(id);
    if (!existing) return undefined;
    
    const updated: Product = {
      ...existing,
      stockQuantity: quantity,
      updatedAt: new Date().toISOString(),
    };
    this.products.set(id, updated);
    return updated;
  }

  decreaseStock(id: string, amount: number): Product | undefined {
    const existing = this.products.get(id);
    if (!existing) return undefined;
    if (existing.stockQuantity < amount) return undefined;
    
    const updated: Product = {
      ...existing,
      stockQuantity: existing.stockQuantity - amount,
      updatedAt: new Date().toISOString(),
    };
    this.products.set(id, updated);
    return updated;
  }
}

export const productStore = new ProductStore();
