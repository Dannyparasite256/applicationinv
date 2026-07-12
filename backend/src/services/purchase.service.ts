import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { generateDocNo } from '../utils/crypto';
import { PaginationParams, buildOrderBy } from '../utils/pagination';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

export async function listPurchases(companyId: string | null | undefined, params: PaginationParams) {
  const cid = requireCompany(companyId);
  const where: Prisma.PurchaseOrderWhereInput = {
    companyId: cid,
    deletedAt: null,
    ...(params.search
      ? { orderNo: { contains: params.search, mode: 'insensitive' } }
      : {}),
  };
  const [total, data] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: buildOrderBy(params.sortBy, params.sortOrder),
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
        _count: { select: { items: true } },
      },
    }),
  ]);
  return { data, total };
}

export async function getPurchase(companyId: string | null | undefined, id: string) {
  const cid = requireCompany(companyId);
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, companyId: cid, deletedAt: null },
    include: {
      supplier: { select: { id: true, name: true, code: true, email: true, phone: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, barcode: true } },
        },
      },
    },
  });
  if (!po) throw new NotFoundError('Purchase order');
  return po;
}

export async function createPurchase(
  companyId: string | null | undefined,
  userId: string,
  input: {
    supplierId: string;
    expectedDate?: Date | null;
    notes?: string | null;
    status?: 'DRAFT' | 'APPROVED' | 'ORDERED';
    fromLowStock?: boolean;
    items?: Array<{
      productId: string;
      quantity: number;
      unitCost: number;
      batchNumber?: string | null;
      expiryDate?: Date | null;
    }>;
  }
) {
  const cid = requireCompany(companyId);
  const supplier = await prisma.supplier.findFirst({
    where: { id: input.supplierId, companyId: cid },
  });
  if (!supplier) throw new NotFoundError('Supplier');

  let lineItems = input.items || [];

  if (input.fromLowStock && lineItems.length === 0) {
    // Build lines from products at/below reorder level
    const products = await prisma.product.findMany({
      where: { companyId: cid, deletedAt: null, isActive: true, trackInventory: true },
      include: {
        stockLevels: { select: { quantity: true } },
      },
      take: 100,
    });
    lineItems = products
      .map((p) => {
        const qty = p.stockLevels.reduce((s, l) => s + Number(l.quantity || 0), 0);
        const reorder = Number(p.reorderLevel || 0);
        if (qty > reorder) return null;
        const need = Math.max(Number(p.reorderQty || 0), reorder - qty, 1);
        return {
          productId: p.id,
          quantity: need,
          unitCost: Number(p.costPrice || 0),
          batchNumber: null as string | null,
          expiryDate: null as Date | null,
        };
      })
      .filter(Boolean) as Array<{
      productId: string;
      quantity: number;
      unitCost: number;
      batchNumber?: string | null;
      expiryDate?: Date | null;
    }>;
    if (!lineItems.length) {
      throw new ValidationError('No low-stock products to order');
    }
  }

  if (!lineItems.length) throw new ValidationError('Purchase needs at least one item');

  let subtotal = 0;
  const items = lineItems.map((item) => {
    const total = item.quantity * item.unitCost;
    subtotal += total;
    return { ...item, taxAmount: 0, total };
  });

  const status = input.status || 'APPROVED';
  const count = await prisma.purchaseOrder.count({ where: { companyId: cid } });
  return prisma.purchaseOrder.create({
    data: {
      companyId: cid,
      orderNo: generateDocNo('PO', count + 1),
      supplierId: input.supplierId,
      status,
      subtotal,
      taxAmount: 0,
      total: subtotal,
      notes: input.notes || (input.fromLowStock ? 'Auto draft from low-stock list' : null),
      expectedDate: input.expectedDate,
      orderedAt: status === 'DRAFT' ? null : new Date(),
      createdBy: userId,
      items: {
        create: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitCost: i.unitCost,
          taxAmount: i.taxAmount,
          total: i.total,
          batchNumber: i.batchNumber,
          expiryDate: i.expiryDate,
        })),
      },
    },
    include: { items: true, supplier: true },
  });
}

export async function updatePurchaseStatus(
  companyId: string | null | undefined,
  id: string,
  status: string
) {
  const cid = requireCompany(companyId);
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, companyId: cid, deletedAt: null },
  });
  if (!po) throw new NotFoundError('Purchase order');
  const allowed: Record<string, string[]> = {
    DRAFT: ['APPROVED', 'ORDERED', 'CANCELLED'],
    PENDING_APPROVAL: ['APPROVED', 'ORDERED', 'CANCELLED'],
    APPROVED: ['ORDERED', 'CANCELLED'],
    ORDERED: ['CANCELLED'],
    PARTIALLY_RECEIVED: ['CANCELLED', 'CLOSED'],
    RECEIVED: ['CLOSED'],
  };
  const next = status.toUpperCase();
  const from = po.status;
  if (!(allowed[from] || []).includes(next) && from !== next) {
    throw new ValidationError(`Cannot change status from ${from} to ${next}`);
  }
  return prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: next as never,
      orderedAt: next === 'ORDERED' || next === 'APPROVED' ? new Date() : po.orderedAt,
    },
    include: { items: true, supplier: true },
  });
}

export async function receivePurchase(
  companyId: string | null | undefined,
  purchaseId: string,
  input: {
    warehouseId?: string | null;
    items?: Array<{
      itemId: string;
      receivedQty: number;
      batchNumber?: string | null;
      expiryDate?: Date | null;
    }>;
  },
  userId: string
) {
  const cid = requireCompany(companyId);
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseId, companyId: cid, deletedAt: null },
    include: { items: true },
  });
  if (!po) throw new NotFoundError('Purchase order');
  if (po.status === 'CANCELLED' || po.status === 'CLOSED') {
    throw new ValidationError(`Cannot receive a ${po.status.toLowerCase()} purchase order`);
  }
  if (po.status === 'RECEIVED') {
    throw new ValidationError('Purchase order is already fully received');
  }

  // Resolve warehouse: explicit → default → any active
  let warehouseId = input.warehouseId || undefined;
  if (!warehouseId) {
    const wh =
      (await prisma.warehouse.findFirst({
        where: { companyId: cid, isDefault: true, isActive: true, deletedAt: null },
      })) ||
      (await prisma.warehouse.findFirst({
        where: { companyId: cid, isActive: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }));
    warehouseId = wh?.id;
  }
  if (!warehouseId) {
    throw new ValidationError('No warehouse available. Create a warehouse first.');
  }

  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, companyId: cid, deletedAt: null },
  });
  if (!warehouse) throw new NotFoundError('Warehouse');

  // If client omits items, receive remaining qty for every line
  let recvItems = input.items?.filter((i) => Number(i.receivedQty) > 0) || [];
  if (!recvItems.length) {
    recvItems = po.items
      .map((line) => ({
        itemId: line.id,
        receivedQty: Math.max(0, Number(line.quantity) - Number(line.receivedQty)),
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
      }))
      .filter((i) => i.receivedQty > 0);
  }
  if (!recvItems.length) {
    throw new ValidationError('Nothing left to receive on this purchase order');
  }

  return prisma.$transaction(async (tx) => {
    for (const recv of recvItems) {
      const line = po.items.find((i) => i.id === recv.itemId);
      if (!line) throw new ValidationError(`Item ${recv.itemId} not found on PO`);
      const qty = Number(recv.receivedQty);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new ValidationError(`Invalid receive quantity for item ${line.id}`);
      }
      const newReceived = Number(line.receivedQty) + qty;
      if (newReceived > Number(line.quantity) + 0.0001) {
        throw new ValidationError(
          `Received quantity exceeds ordered for line (ordered ${line.quantity}, already received ${line.receivedQty})`
        );
      }
      await tx.purchaseOrderItem.update({
        where: { id: line.id },
        data: {
          receivedQty: newReceived,
          batchNumber: recv.batchNumber || line.batchNumber,
          expiryDate: recv.expiryDate || line.expiryDate,
        },
      });

      // Keep in-memory line in sync for multi-line same-item edge cases
      (line as { receivedQty: unknown }).receivedQty = newReceived;

      const existing = await tx.stockLevel.findFirst({
        where: { productId: line.productId, warehouseId },
      });
      if (existing) {
        await tx.stockLevel.update({
          where: { id: existing.id },
          data: { quantity: { increment: qty } },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            productId: line.productId,
            warehouseId,
            quantity: qty,
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          companyId: cid,
          productId: line.productId,
          warehouseId,
          type: 'PURCHASE',
          quantity: qty,
          unitCost: Number(line.unitCost),
          reference: po.orderNo,
          referenceId: po.id,
          batchNumber: recv.batchNumber || line.batchNumber || undefined,
          performedBy: userId,
        },
      });

      const batchNo = recv.batchNumber || line.batchNumber;
      if (batchNo) {
        await tx.productBatch.upsert({
          where: {
            productId_batchNumber: {
              productId: line.productId,
              batchNumber: batchNo,
            },
          },
          create: {
            productId: line.productId,
            batchNumber: batchNo,
            expiryDate: recv.expiryDate || line.expiryDate || undefined,
            quantity: qty,
            costPrice: Number(line.unitCost),
            supplierId: po.supplierId,
          },
          update: {
            quantity: { increment: qty },
          },
        });
      }
    }

    const updatedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseId } });
    const allReceived = updatedItems.every((i) => Number(i.receivedQty) >= Number(i.quantity));
    const anyReceived = updatedItems.some((i) => Number(i.receivedQty) > 0);

    return tx.purchaseOrder.update({
      where: { id: purchaseId },
      data: {
        status: allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : po.status,
        receivedAt: allReceived ? new Date() : po.receivedAt,
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        supplier: true,
      },
    });
  });
}
