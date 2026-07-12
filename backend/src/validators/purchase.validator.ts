import { z } from 'zod';

export const createPurchaseSchema = z.object({
  supplierId: z.string().uuid(),
  expectedDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
  /** Default APPROVED for existing clients; DRAFT for reorder workflow */
  status: z.enum(['DRAFT', 'APPROVED', 'ORDERED']).optional(),
  /** When true and items empty, server fills lines from low-stock products */
  fromLowStock: z.boolean().optional().default(false),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unitCost: z.coerce.number().min(0),
        batchNumber: z.string().optional().nullable(),
        expiryDate: z.coerce.date().optional().nullable(),
      })
    )
    .optional()
    .default([]),
}).refine((d) => d.fromLowStock || (d.items && d.items.length > 0), {
  message: 'Add items or set fromLowStock',
  path: ['items'],
});

export const receivePurchaseSchema = z.object({
  /** Optional — server uses default warehouse when omitted */
  warehouseId: z
    .union([z.string().uuid(), z.literal(''), z.null(), z.undefined()])
    .optional()
    .transform((v) => (v && String(v).length > 0 ? v : null)),
  /** Optional — when empty/omitted, remaining qty on all lines is received */
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        receivedQty: z.coerce.number().positive(),
        batchNumber: z.string().optional().nullable(),
        expiryDate: z.coerce.date().optional().nullable(),
      })
    )
    .optional()
    .default([]),
});
