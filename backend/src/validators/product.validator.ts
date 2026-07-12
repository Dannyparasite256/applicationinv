import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string().min(1).max(255),
  /** Custom stock-keeping unit. Empty/omitted → server auto-generates PRD-###### */
  sku: z
    .union([z.string().max(100), z.literal(''), z.null(), z.undefined()])
    .optional()
    .transform((v) => {
      if (v == null) return undefined;
      const t = String(v).trim();
      return t.length ? t : undefined;
    }),
  barcode: z.string().max(100).optional().nullable(),
  type: z.enum(['PRODUCT', 'SERVICE', 'DRUG', 'COMBO']).default('PRODUCT'),
  categoryId: z.string().uuid().optional().nullable(),
  brandId: z.string().uuid().optional().nullable(),
  unitId: z.string().uuid().optional().nullable(),
  taxId: z.string().uuid().optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  costPrice: z.coerce.number().min(0).default(0),
  sellingPrice: z.coerce.number().min(0).default(0),
  wholesalePrice: z.coerce.number().min(0).optional().nullable(),
  reorderLevel: z.coerce.number().min(0).default(0),
  reorderQty: z.coerce.number().min(0).default(0),
  trackInventory: z.boolean().default(true),
  trackBatch: z.boolean().default(false),
  trackSerial: z.boolean().default(false),
  trackExpiry: z.boolean().default(false),
  isActive: z.boolean().default(true),
  isControlled: z.boolean().default(false),
  genericName: z.string().optional().nullable(),
  strength: z.string().optional().nullable(),
  form: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  requiresPrescription: z.boolean().default(false),
  // Absolute https URL or local upload path `/uploads/...`
  imageUrl: z
    .union([
      z.string().url(),
      z.string().regex(/^\/uploads\//, 'Must be a URL or /uploads/ path'),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v)),
  warehouseId: z.string().uuid().optional(),
  initialStock: z.coerce.number().min(0).optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const createCategorySchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
});

export const createBrandSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional().nullable(),
});
