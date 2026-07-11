import { prisma } from '../config/database';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { generateDocNo } from '../utils/crypto';
import { PaginationParams, buildOrderBy } from '../utils/pagination';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

export async function listStockLevels(companyId: string | null | undefined, warehouseId?: string) {
  const cid = requireCompany(companyId);
  return prisma.stockLevel.findMany({
    where: {
      product: { companyId: cid, deletedAt: null },
      ...(warehouseId ? { warehouseId } : {}),
    },
    include: {
      product: { select: { id: true, name: true, sku: true, barcode: true, reorderLevel: true, costPrice: true, sellingPrice: true } },
      warehouse: { select: { id: true, name: true, code: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function listMovements(
  companyId: string | null | undefined,
  params: PaginationParams & { productId?: string; warehouseId?: string }
) {
  const cid = requireCompany(companyId);
  const where = {
    companyId: cid,
    ...(params.productId ? { productId: params.productId } : {}),
    ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
  };
  const [total, data] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        warehouse: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { data, total };
}

export async function adjustStock(
  companyId: string | null | undefined,
  userId: string,
  input: {
    warehouseId: string;
    reason: string;
    notes?: string | null;
    items: Array<{ productId: string; countedQty: number }>;
  }
) {
  const cid = requireCompany(companyId);
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: input.warehouseId, companyId: cid },
  });
  if (!warehouse) throw new NotFoundError('Warehouse');

  const count = await prisma.stockAdjustment.count({ where: { companyId: cid } });

  return prisma.$transaction(async (tx) => {
    const adjustment = await tx.stockAdjustment.create({
      data: {
        companyId: cid,
        adjustmentNo: generateDocNo('ADJ', count + 1),
        warehouseId: input.warehouseId,
        reason: input.reason,
        notes: input.notes,
        adjustedBy: userId,
      },
    });

    for (const item of input.items) {
      let level = await tx.stockLevel.findFirst({
        where: { productId: item.productId, warehouseId: input.warehouseId },
      });
      const systemQty = level ? Number(level.quantity) : 0;
      const difference = item.countedQty - systemQty;

      await tx.stockAdjustmentItem.create({
        data: {
          adjustmentId: adjustment.id,
          productId: item.productId,
          systemQty,
          countedQty: item.countedQty,
          difference,
        },
      });

      if (!level) {
        level = await tx.stockLevel.create({
          data: {
            productId: item.productId,
            warehouseId: input.warehouseId,
            quantity: item.countedQty,
          },
        });
      } else {
        await tx.stockLevel.update({
          where: { id: level.id },
          data: { quantity: item.countedQty },
        });
      }

      if (difference !== 0) {
        await tx.stockMovement.create({
          data: {
            companyId: cid,
            productId: item.productId,
            warehouseId: input.warehouseId,
            type: 'ADJUSTMENT',
            quantity: difference,
            reference: adjustment.adjustmentNo,
            referenceId: adjustment.id,
            notes: input.reason,
            performedBy: userId,
          },
        });
      }
    }

    return tx.stockAdjustment.findUnique({
      where: { id: adjustment.id },
      include: { items: true },
    });
  });
}

export async function createTransfer(
  companyId: string | null | undefined,
  userId: string,
  input: {
    fromWarehouseId: string;
    toWarehouseId: string;
    notes?: string | null;
    items: Array<{ productId: string; quantity: number }>;
  }
) {
  const cid = requireCompany(companyId);
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new ValidationError('Source and destination warehouses must differ');
  }
  const [fromWh, toWh] = await Promise.all([
    prisma.warehouse.findFirst({ where: { id: input.fromWarehouseId, companyId: cid } }),
    prisma.warehouse.findFirst({ where: { id: input.toWarehouseId, companyId: cid } }),
  ]);
  if (!fromWh || !toWh) throw new NotFoundError('Warehouse');

  const count = await prisma.stockTransfer.count({ where: { companyId: cid } });

  return prisma.$transaction(async (tx) => {
    // Validate stock
    for (const item of input.items) {
      const level = await tx.stockLevel.findFirst({
        where: { productId: item.productId, warehouseId: input.fromWarehouseId },
      });
      if (!level || Number(level.quantity) < item.quantity) {
        const p = await tx.product.findUnique({ where: { id: item.productId } });
        throw new ValidationError(`Insufficient stock for ${p?.name || item.productId}`);
      }
    }

    const transfer = await tx.stockTransfer.create({
      data: {
        companyId: cid,
        transferNo: generateDocNo('TRF', count + 1),
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        status: 'COMPLETED',
        notes: input.notes,
        transferredBy: userId,
        receivedBy: userId,
        transferredAt: new Date(),
        receivedAt: new Date(),
        items: {
          create: input.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            receivedQty: i.quantity,
          })),
        },
      },
      include: { items: true },
    });

    for (const item of input.items) {
      const fromLevel = await tx.stockLevel.findFirst({
        where: { productId: item.productId, warehouseId: input.fromWarehouseId },
      });
      await tx.stockLevel.update({
        where: { id: fromLevel!.id },
        data: { quantity: { decrement: item.quantity } },
      });

      const toLevel = await tx.stockLevel.findFirst({
        where: { productId: item.productId, warehouseId: input.toWarehouseId },
      });
      if (toLevel) {
        await tx.stockLevel.update({
          where: { id: toLevel.id },
          data: { quantity: { increment: item.quantity } },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            productId: item.productId,
            warehouseId: input.toWarehouseId,
            quantity: item.quantity,
          },
        });
      }

      await tx.stockMovement.createMany({
        data: [
          {
            companyId: cid,
            productId: item.productId,
            warehouseId: input.fromWarehouseId,
            type: 'TRANSFER_OUT',
            quantity: -item.quantity,
            reference: transfer.transferNo,
            referenceId: transfer.id,
            performedBy: userId,
          },
          {
            companyId: cid,
            productId: item.productId,
            warehouseId: input.toWarehouseId,
            type: 'TRANSFER_IN',
            quantity: item.quantity,
            reference: transfer.transferNo,
            referenceId: transfer.id,
            performedBy: userId,
          },
        ],
      });
    }

    return transfer;
  });
}

export async function listTransfers(companyId: string | null | undefined, params: PaginationParams) {
  const cid = requireCompany(companyId);
  const [total, data] = await Promise.all([
    prisma.stockTransfer.count({ where: { companyId: cid } }),
    prisma.stockTransfer.findMany({
      where: { companyId: cid },
      skip: params.skip,
      take: params.limit,
      orderBy: buildOrderBy(params.sortBy, params.sortOrder),
      include: {
        fromWarehouse: { select: { name: true, code: true } },
        toWarehouse: { select: { name: true, code: true } },
        items: true,
      },
    }),
  ]);
  return { data, total };
}
