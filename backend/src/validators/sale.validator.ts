import { z } from 'zod';

/** Empty string / invalid optional UUIDs → null (mobile clients often send "") */
const optionalUuid = z
  .union([z.string().uuid(), z.literal(''), z.null(), z.undefined()])
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const saleItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: optionalUuid,
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).default(0),
  batchNumber: z.string().optional().nullable(),
  serialNo: z.string().optional().nullable(),
});

const paymentSchema = z.object({
  method: z.enum([
    'CASH',
    'CARD',
    'BANK_TRANSFER',
    'MOBILE_MONEY',
    'CHEQUE',
    'GIFT_CARD',
    'LOYALTY_POINTS',
    'CREDIT',
    'SPLIT',
    'OTHER',
  ]),
  amount: z.coerce.number().positive(),
  reference: z.string().optional().nullable(),
  /** Tender currency (ISO). Converted to company base for settlement. */
  currency: z.string().trim().min(3).max(3).optional().nullable(),
  exchangeRate: z.coerce.number().positive().optional().nullable(),
});

export const createSaleSchema = z.object({
  customerId: optionalUuid,
  branchId: optionalUuid,
  warehouseId: optionalUuid,
  shiftId: optionalUuid,
  items: z.array(saleItemSchema).min(1, 'Add at least one product'),
  payments: z.array(paymentSchema).optional().default([]),
  /** Sale display / tender currency */
  currency: z.string().trim().min(3).max(3).optional().nullable(),
  discountAmount: z.coerce.number().min(0).default(0),
  notes: z.string().optional().nullable(),
  isOffline: z.boolean().optional().default(false),
  offlineId: z.string().optional().nullable(),
  promotionCode: z.string().optional().nullable(),
  /** Loyalty points to redeem for currency discount */
  redeemPoints: z.coerce.number().int().min(0).optional().nullable(),
});

export const openShiftSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  openingCash: z.coerce.number().min(0).default(0),
});

export const closeShiftSchema = z.object({
  closingCash: z.coerce.number().min(0),
  notes: z.string().optional().nullable(),
});
