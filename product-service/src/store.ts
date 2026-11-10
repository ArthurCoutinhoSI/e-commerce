import { Product } from './models/Product';
import { v4 as uuidv4 } from 'uuid';
import { query } from './db';
import { productsCreatedTotal, productsDeletedTotal, SERVICE } from './metrics';

interface ProductRow {
  id: string;
  name: string;
  description: string;
  price: string;
  stock_quantity: number;
  created_at: Date;
  updated_at: Date;
}

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  name: row.name,
  description: row.description,
  price: Number(row.price),
  stockQuantity: row.stock_quantity,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const isInvalidUuidError = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === '22P02';

class ProductStore {
  async getAll(): Promise<Product[]> {
    const result = await query('SELECT * FROM products ORDER BY created_at ASC, id ASC');
    return result.rows.map((row) => toProduct(row as ProductRow));
  }

  async getById(id: string): Promise<Product | undefined> {
    try {
      const result = await query('SELECT * FROM products WHERE id = $1', [id]);
      return result.rows[0] ? toProduct(result.rows[0] as ProductRow) : undefined;
    } catch (error) {
      if (isInvalidUuidError(error)) return undefined;
      throw error;
    }
  }

  async create(productInput: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product> {
    const result = await query(
      `INSERT INTO products (id, name, description, price, stock_quantity, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       RETURNING *`,
      [uuidv4(), productInput.name, productInput.description, productInput.price, productInput.stockQuantity]
    );
    productsCreatedTotal.inc({ service: SERVICE });
    return toProduct(result.rows[0] as ProductRow);
  }

  async update(
    id: string,
    productInput: Partial<Omit<Product, 'id' | 'createdAt'>>
  ): Promise<Product | undefined> {
    try {
      const result = await query(
        `UPDATE products
         SET name = COALESCE($2, name),
             description = COALESCE($3, description),
             price = COALESCE($4, price),
             stock_quantity = COALESCE($5, stock_quantity),
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          productInput.name ?? null,
          productInput.description ?? null,
          productInput.price ?? null,
          productInput.stockQuantity ?? null,
        ]
      );
      return result.rows[0] ? toProduct(result.rows[0] as ProductRow) : undefined;
    } catch (error) {
      if (isInvalidUuidError(error)) return undefined;
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await query('DELETE FROM products WHERE id = $1', [id]);
      const deleted = (result.rowCount ?? 0) > 0;
      if (deleted) productsDeletedTotal.inc({ service: SERVICE });
      return deleted;
    } catch (error) {
      if (isInvalidUuidError(error)) return false;
      throw error;
    }
  }

  async updateStock(id: string, quantity: number): Promise<Product | undefined> {
    try {
      const result = await query(
        `UPDATE products
         SET stock_quantity = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, quantity]
      );
      return result.rows[0] ? toProduct(result.rows[0] as ProductRow) : undefined;
    } catch (error) {
      if (isInvalidUuidError(error)) return undefined;
      throw error;
    }
  }

  async decreaseStock(id: string, amount: number): Promise<Product | undefined> {
    try {
      const result = await query(
        `UPDATE products
         SET stock_quantity = stock_quantity - $2,
             updated_at = now()
         WHERE id = $1 AND stock_quantity >= $2
         RETURNING *`,
        [id, amount]
      );
      return result.rows[0] ? toProduct(result.rows[0] as ProductRow) : undefined;
    } catch (error) {
      if (isInvalidUuidError(error)) return undefined;
      throw error;
    }
  }

  async incrementStock(id: string, amount: number): Promise<Product | undefined> {
    try {
      const result = await query(
        `UPDATE products
         SET stock_quantity = stock_quantity + $2,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, amount]
      );
      return result.rows[0] ? toProduct(result.rows[0] as ProductRow) : undefined;
    } catch (error) {
      if (isInvalidUuidError(error)) return undefined;
      throw error;
    }
  }
}

export const productStore = new ProductStore();
