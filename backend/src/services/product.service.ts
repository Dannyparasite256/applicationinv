import { Prisma, ProductType } from '@prisma/client';
import { prisma } from '../config/database';
import { NotFoundError, ConflictError, ForbiddenError } from '../utils/errors';
import { slugify, generateSku } from '../utils/crypto';
import { PaginationParams, buildOrderBy } from '../utils/pagination';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

export async function listProducts(
  companyId: string | null | undefined,
  params: PaginationParams & {
    categoryId?: string;
    type?: ProductType;
    lowStock?: boolean;
    isActive?: boolean;
  }
) {
  const cid = requireCompany(companyId);
  const where: Prisma.ProductWhereInput = {
    companyId: cid,
    deletedAt: null,
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.type ? { type: params.type } : {}),
    ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: 'insensitive' } },
            { sku: { contains: params.search, mode: 'insensitive' } },
            { barcode: { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: buildOrderBy(params.sortBy, params.sortOrder),
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, shortName: true } },
        tax: { select: { id: true, name: true, rate: true } },
        stockLevels: {
          select: {
            id: true,
            quantity: true,
            reservedQty: true,
            warehouseId: true,
            warehouse: { select: { id: true, name: true, code: true } },
          },
        },
      },
    }),
  ]);

  let data = products.map((p) => ({
    ...p,
    stockQty: p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0),
  }));

  if (params.lowStock) {
    data = data.filter((p) => p.stockQty <= Number(p.reorderLevel));
  }

  return { data, total: params.lowStock ? data.length : total };
}

export async function getProduct(companyId: string | null | undefined, id: string) {
  const cid = requireCompany(companyId);
  const product = await prisma.product.findFirst({
    where: { id, companyId: cid, deletedAt: null },
    include: {
      category: true,
      brand: true,
      unit: true,
      tax: true,
      variants: true,
      batches: { orderBy: { expiryDate: 'asc' } },
      prices: true,
      stockLevels: { include: { warehouse: true } },
    },
  });
  if (!product) throw new NotFoundError('Product');
  return product;
}

export async function getProductByBarcode(companyId: string | null | undefined, barcode: string) {
  const cid = requireCompany(companyId);
  const code = barcode.trim();
  const product = await prisma.product.findFirst({
    where: {
      companyId: cid,
      deletedAt: null,
      isActive: true,
      OR: [
        { barcode: code },
        { sku: code },
        { barcode: { equals: code, mode: 'insensitive' } },
        { sku: { equals: code, mode: 'insensitive' } },
      ],
    },
    include: {
      stockLevels: true,
      tax: true,
    },
  });
  if (!product) throw new NotFoundError('Product');
  const stockQty = product.stockLevels.reduce((s, l) => s + Number(l.quantity), 0);
  return { ...product, stockQty };
}

export async function createProduct(
  companyId: string | null | undefined,
  data: {
    name: string;
    sku?: string;
    barcode?: string | null;
    type?: ProductType;
    categoryId?: string | null;
    brandId?: string | null;
    unitId?: string | null;
    taxId?: string | null;
    description?: string | null;
    costPrice?: number;
    sellingPrice?: number;
    wholesalePrice?: number | null;
    reorderLevel?: number;
    reorderQty?: number;
    trackInventory?: boolean;
    trackBatch?: boolean;
    trackSerial?: boolean;
    trackExpiry?: boolean;
    isActive?: boolean;
    isControlled?: boolean;
    genericName?: string | null;
    strength?: string | null;
    form?: string | null;
    manufacturer?: string | null;
    requiresPrescription?: boolean;
    imageUrl?: string | null;
    warehouseId?: string;
    initialStock?: number;
  }
) {
  const cid = requireCompany(companyId);
  const count = await prisma.product.count({ where: { companyId: cid } });
  // Allow custom SKU on registration; blank/missing → auto PRD-00000N
  const sku = (data.sku?.trim() || generateSku('PRD', count + 1)).toUpperCase();
  const baseSlug = slugify(data.name);
  let slug = baseSlug;
  let n = 1;
  while (await prisma.product.findFirst({ where: { companyId: cid, slug } })) {
    slug = `${baseSlug}-${n++}`;
  }

  const existingSku = await prisma.product.findFirst({
    where: { companyId: cid, sku, deletedAt: null },
  });
  if (existingSku) throw new ConflictError(`SKU "${sku}" already exists`);

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        companyId: cid,
        name: data.name,
        sku,
        slug,
        barcode: data.barcode,
        type: data.type || 'PRODUCT',
        categoryId: data.categoryId,
        brandId: data.brandId,
        unitId: data.unitId,
        taxId: data.taxId,
        description: data.description,
        costPrice: data.costPrice ?? 0,
        sellingPrice: data.sellingPrice ?? 0,
        wholesalePrice: data.wholesalePrice,
        reorderLevel: data.reorderLevel ?? 0,
        reorderQty: data.reorderQty ?? 0,
        trackInventory: data.trackInventory ?? true,
        trackBatch: data.trackBatch ?? false,
        trackSerial: data.trackSerial ?? false,
        trackExpiry: data.trackExpiry ?? false,
        isActive: data.isActive ?? true,
        isControlled: data.isControlled ?? false,
        genericName: data.genericName,
        strength: data.strength,
        form: data.form,
        manufacturer: data.manufacturer,
        requiresPrescription: data.requiresPrescription ?? false,
        imageUrl: data.imageUrl,
      },
    });

    // Always seed a stock row for tracked products so POS sales can deduct reliably
    if (product.trackInventory) {
      let warehouseId = data.warehouseId;
      if (!warehouseId) {
        const wh =
          (await tx.warehouse.findFirst({
            where: { companyId: cid, isDefault: true, isActive: true },
          })) ||
          (await tx.warehouse.findFirst({
            where: { companyId: cid, isActive: true },
            orderBy: { createdAt: 'asc' },
          }));
        warehouseId = wh?.id;
      }
      if (warehouseId) {
        const opening = Number(data.initialStock ?? 0) || 0;
        await tx.stockLevel.create({
          data: {
            productId: product.id,
            warehouseId,
            quantity: opening,
          },
        });
        if (opening > 0) {
          await tx.stockMovement.create({
            data: {
              companyId: cid,
              productId: product.id,
              warehouseId,
              type: 'OPENING',
              quantity: opening,
              unitCost: data.costPrice ?? 0,
              reference: 'Opening stock',
            },
          });
        }
      }
    }

    return product;
  });
}

export async function updateProduct(
  companyId: string | null | undefined,
  id: string,
  data: Partial<Parameters<typeof createProduct>[1]>
) {
  await getProduct(companyId, id);
  const cid = requireCompany(companyId);
  return prisma.product.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.barcode !== undefined ? { barcode: data.barcode } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      ...(data.brandId !== undefined ? { brandId: data.brandId } : {}),
      ...(data.unitId !== undefined ? { unitId: data.unitId } : {}),
      ...(data.taxId !== undefined ? { taxId: data.taxId } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.costPrice !== undefined ? { costPrice: data.costPrice } : {}),
      ...(data.sellingPrice !== undefined ? { sellingPrice: data.sellingPrice } : {}),
      ...(data.wholesalePrice !== undefined ? { wholesalePrice: data.wholesalePrice } : {}),
      ...(data.reorderLevel !== undefined ? { reorderLevel: data.reorderLevel } : {}),
      ...(data.reorderQty !== undefined ? { reorderQty: data.reorderQty } : {}),
      ...(data.trackInventory !== undefined ? { trackInventory: data.trackInventory } : {}),
      ...(data.trackBatch !== undefined ? { trackBatch: data.trackBatch } : {}),
      ...(data.trackSerial !== undefined ? { trackSerial: data.trackSerial } : {}),
      ...(data.trackExpiry !== undefined ? { trackExpiry: data.trackExpiry } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.isControlled !== undefined ? { isControlled: data.isControlled } : {}),
      ...(data.genericName !== undefined ? { genericName: data.genericName } : {}),
      ...(data.strength !== undefined ? { strength: data.strength } : {}),
      ...(data.form !== undefined ? { form: data.form } : {}),
      ...(data.manufacturer !== undefined ? { manufacturer: data.manufacturer } : {}),
      ...(data.requiresPrescription !== undefined
        ? { requiresPrescription: data.requiresPrescription }
        : {}),
      ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
    },
  });
}

export async function softDeleteProduct(companyId: string | null | undefined, id: string) {
  await getProduct(companyId, id);
  return prisma.product.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
}

export async function listCategories(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  return prisma.category.findMany({
    where: { companyId: cid, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { products: true } } },
  });
}

export async function createCategory(
  companyId: string | null | undefined,
  data: { name: string; parentId?: string | null; description?: string | null }
) {
  const cid = requireCompany(companyId);
  const slug = slugify(data.name);
  return prisma.category.create({
    data: {
      companyId: cid,
      name: data.name,
      slug: `${slug}-${Date.now().toString(36)}`,
      parentId: data.parentId,
      description: data.description,
    },
  });
}

export async function listBrands(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  return prisma.brand.findMany({
    where: { companyId: cid, deletedAt: null },
    orderBy: { name: 'asc' },
  });
}

export async function createBrand(
  companyId: string | null | undefined,
  data: { name: string; description?: string | null }
) {
  const cid = requireCompany(companyId);
  return prisma.brand.create({
    data: {
      companyId: cid,
      name: data.name,
      slug: `${slugify(data.name)}-${Date.now().toString(36)}`,
      description: data.description,
    },
  });
}

export async function getLowStock(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  const products = await prisma.product.findMany({
    where: { companyId: cid, deletedAt: null, isActive: true, trackInventory: true },
    include: { stockLevels: true },
  });
  return products
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      reorderLevel: Number(p.reorderLevel),
      stockQty: p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0),
    }))
    .filter((p) => p.stockQty <= p.reorderLevel);
}

export async function getExpiringProducts(companyId: string | null | undefined, days = 90) {
  const cid = requireCompany(companyId);
  const until = new Date();
  until.setDate(until.getDate() + days);
  return prisma.productBatch.findMany({
    where: {
      product: { companyId: cid, deletedAt: null },
      expiryDate: { lte: until, gte: new Date() },
      quantity: { gt: 0 },
    },
    include: {
      product: { select: { id: true, name: true, sku: true } },
    },
    orderBy: { expiryDate: 'asc' },
  });
}
