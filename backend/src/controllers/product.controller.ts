import { Request, Response } from 'express';
import * as productService from '../services/product.service';
import { success, created, paginated } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { getPagination } from '../utils/pagination';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  const { data, total } = await productService.listProducts(req.companyId, {
    ...pagination,
    categoryId: req.query.categoryId as string | undefined,
    type: req.query.type as never,
    lowStock: req.query.lowStock === 'true',
    isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
  });
  return paginated(res, data, pagination.page, pagination.limit, total);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.getProduct(req.companyId, req.params.id);
  return success(res, product);
});

export const getByBarcode = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.getProductByBarcode(req.companyId, req.params.barcode);
  return success(res, product);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.createProduct(req.companyId, req.body);
  return created(res, product, 'Product created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.updateProduct(req.companyId, req.params.id, req.body);
  return success(res, product, 'Product updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await productService.softDeleteProduct(req.companyId, req.params.id);
  return success(res, null, 'Product deleted');
});

export const categories = asyncHandler(async (req: Request, res: Response) => {
  const data = await productService.listCategories(req.companyId);
  return success(res, data);
});

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const data = await productService.createCategory(req.companyId, req.body);
  return created(res, data);
});

export const brands = asyncHandler(async (req: Request, res: Response) => {
  const data = await productService.listBrands(req.companyId);
  return success(res, data);
});

export const createBrand = asyncHandler(async (req: Request, res: Response) => {
  const data = await productService.createBrand(req.companyId, req.body);
  return created(res, data);
});

export const lowStock = asyncHandler(async (req: Request, res: Response) => {
  const data = await productService.getLowStock(req.companyId);
  return success(res, data);
});

export const expiring = asyncHandler(async (req: Request, res: Response) => {
  const days = parseInt(String(req.query.days || '90'), 10);
  const data = await productService.getExpiringProducts(req.companyId, days);
  return success(res, data);
});
