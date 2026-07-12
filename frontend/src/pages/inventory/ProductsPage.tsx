import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Package, Camera, ScanBarcode, Pencil, Trash2, X, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { formatCurrency, moneyInputFromBase, parseMoneyToBase } from '@/lib/utils';
import { getMediaUrl } from '@/lib/media';
import { printProductLabel } from '@/lib/labelPrint';
import { scanBarcode, canUseCameraScan } from '@/native/barcodeScan';
import { useAuthStore } from '@/stores/authStore';
import { useCurrencyStore } from '@/stores/currencyStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { isManager } from '@/lib/roleAccess';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/shared/EmptyState';

interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  type: string;
  sellingPrice: string | number;
  costPrice: string | number;
  isActive: boolean;
  stockQty?: number;
  imageUrl?: string | null;
  category?: { name: string } | null;
}

type ProductForm = {
  name: string;
  sku: string;
  sellingPrice: string;
  costPrice: string;
  barcode: string;
  type: string;
  initialStock: string;
  isActive: boolean;
  imageUrl: string;
};

const emptyForm = (): ProductForm => ({
  name: '',
  sku: '',
  sellingPrice: '',
  costPrice: '',
  barcode: '',
  type: 'PRODUCT',
  initialStock: '0',
  isActive: true,
  imageUrl: '',
});

const PRODUCT_TYPES = [
  { value: 'PRODUCT', label: 'Product' },
  { value: 'SERVICE', label: 'Service' },
  { value: 'DRUG', label: 'Drug' },
] as const;

const inputClass = 'h-10 w-full rounded-lg border border-input bg-background px-2.5 text-base';

export function ProductsPage() {
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [showForm, setShowForm] = useState(() => searchParams.get('new') === '1');
  const completeOnboardingStep = usePreferencesStore((s) => s.completeOnboardingStep);
  const companyName = useAuthStore((s) => s.user?.company?.name);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanTarget, setScanTarget] = useState<'create' | 'edit'>('create');
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const roles = useAuthStore((s) => s.user?.roles || []);
  const manager = isManager(roles);
  const moneyCode = useCurrencyStore((s) => s.displayCurrency || s.baseCurrency || 'USD');

  // Global search / deep link: /app/products?q=name&barcode=&new=1
  useEffect(() => {
    const q = searchParams.get('q');
    if (q != null) setSearch(q);
    const bc = searchParams.get('barcode');
    if (bc) {
      setForm((f) => ({ ...f, barcode: bc, name: f.name || q || '' }));
      setShowForm(true);
    }
    if (searchParams.get('new') === '1') setShowForm(true);
  }, [searchParams]);

  // Owners/managers always can manage products; staff need explicit permission
  const canCreate = hasPermission('inventory.products.create') || manager;
  const canUpdate = hasPermission('inventory.products.update') || manager;
  const canDelete = hasPermission('inventory.products.delete') || manager;

  // Prevent background scroll while any product sheet is open
  useEffect(() => {
    const open = showForm || !!editing || !!deleteTarget;
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showForm, editing, deleteTarget]);

  const scanProductBarcode = async (target: 'create' | 'edit') => {
    try {
      setScanning(true);
      setScanTarget(target);
      const code = await scanBarcode({ title: 'Scan product barcode' });
      if (!code) {
        toast.message('Scan cancelled');
        return;
      }
      if (target === 'edit') {
        setEditForm((f) => ({ ...f, barcode: code }));
      } else {
        setForm((f) => ({ ...f, barcode: code }));
      }
      toast.success(`Barcode captured: ${code}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open camera scanner');
    } finally {
      setScanning(false);
    }
  };

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['products', search],
    queryFn: async () => {
      const res = await api.get('/products', { params: { search: search || undefined, limit: 50 } });
      return res.data as { data: Product[]; meta: { total: number } };
    },
  });

  const invalidateProductQueries = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['products'], refetchType: 'active' }),
      qc.invalidateQueries({ queryKey: ['products-mini'], refetchType: 'active' }),
      qc.invalidateQueries({ queryKey: ['pos-products'], refetchType: 'active' }),
      qc.invalidateQueries({ queryKey: ['inventory'], refetchType: 'active' }),
      qc.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'active' }),
      qc.invalidateQueries({ queryKey: ['stock-levels'], refetchType: 'active' }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const sku = form.sku.trim();
      // Form prices are in the user's display currency → convert to company base for API
      const res = await api.post('/products', {
        name: form.name.trim(),
        ...(sku ? { sku } : {}),
        sellingPrice: parseMoneyToBase(form.sellingPrice),
        costPrice: parseMoneyToBase(form.costPrice),
        barcode: form.barcode.trim() || null,
        type: form.type || 'PRODUCT',
        initialStock: Math.max(0, Number.parseFloat(form.initialStock) || 0),
        isActive: true,
        imageUrl: form.imageUrl.trim() || null,
      });
      return res.data;
    },
    onSuccess: async (res) => {
      const createdSku = res?.data?.sku;
      toast.success(createdSku ? `Product created · SKU ${createdSku}` : 'Product created');
      completeOnboardingStep('product');
      setShowForm(false);
      setForm(emptyForm());
      await invalidateProductQueries();
      await refetch();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error('No product selected');
      const name = editForm.name.trim();
      if (!name) throw new Error('Product name is required');
      // Form prices are in display currency → convert to company base for storage
      const payload = {
        name,
        sellingPrice: parseMoneyToBase(editForm.sellingPrice),
        costPrice: parseMoneyToBase(editForm.costPrice),
        barcode: editForm.barcode.trim() ? editForm.barcode.trim() : null,
        type: editForm.type || 'PRODUCT',
        isActive: Boolean(editForm.isActive),
        imageUrl: editForm.imageUrl.trim() || null,
      };
      const res = await api.put(`/products/${editing.id}`, payload);
      return res.data as { data?: Product; message?: string };
    },
    onSuccess: async (res) => {
      const updated = res?.data;
      toast.success('Product saved — new prices apply to the next sale');
      setEditing(null);
      // Optimistically refresh list row
      if (updated?.id) {
        qc.setQueriesData<{ data: Product[]; meta: { total: number } }>(
          { queryKey: ['products'] },
          (old) => {
            if (!old?.data) return old;
            return {
              ...old,
              data: old.data.map((p) =>
                p.id === updated.id
                  ? {
                      ...p,
                      name: updated.name ?? p.name,
                      sellingPrice: updated.sellingPrice ?? p.sellingPrice,
                      costPrice: updated.costPrice ?? p.costPrice,
                      barcode: updated.barcode ?? p.barcode,
                      type: updated.type ?? p.type,
                      isActive: updated.isActive ?? p.isActive,
                    }
                  : p
              ),
            };
          }
        );
      }
      await invalidateProductQueries();
      await refetch();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/products/${id}`);
      return res.data;
    },
    onSuccess: async () => {
      toast.success('Product deleted');
      setDeleteTarget(null);
      setEditing(null);
      await invalidateProductQueries();
      await refetch();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const openEdit = (p: Product) => {
    if (!canUpdate && !canDelete) {
      toast.error('You do not have permission to edit products');
      return;
    }
    setEditing(p);
    // Show prices in the user's chosen display currency (not raw base)
    setEditForm({
      name: p.name || '',
      sku: p.sku || '',
      sellingPrice: moneyInputFromBase(p.sellingPrice),
      costPrice: moneyInputFromBase(p.costPrice),
      barcode: p.barcode || '',
      type: p.type || 'PRODUCT',
      initialStock: '0',
      isActive: p.isActive !== false,
      imageUrl: p.imageUrl || '',
    });
  };

  const uploadProductImage = async (file: File, target: 'create' | 'edit') => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/uploads', fd);
      const url = res.data?.data?.url as string | undefined;
      if (!url) throw new Error('Upload failed');
      if (target === 'create') setForm((f) => ({ ...f, imageUrl: url }));
      else setEditForm((f) => ({ ...f, imageUrl: url }));
      toast.success('Photo uploaded');
    } catch (e) {
      toast.error(getErrorMessage(e) || 'Photo upload failed');
    }
  };

  const openCreate = () => {
    if (!canCreate) {
      toast.error('You do not have permission to add products');
      return;
    }
    setForm(emptyForm());
    setShowForm(true);
  };

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Enter a product name');
      return;
    }
    createMutation.mutate();
  };

  const handleEditSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canUpdate) {
      toast.error('You do not have permission to save product changes');
      return;
    }
    if (!editForm.name.trim()) {
      toast.error('Enter a product name');
      return;
    }
    updateMutation.mutate();
  };

  const requestDelete = (p: Product) => {
    if (!canDelete) {
      toast.error('You do not have permission to delete products');
      return;
    }
    setDeleteTarget(p);
  };

  const productList = data?.data ?? [];

  const createModal =
    showForm && canCreate
      ? createPortal(
          <div
            className="product-modal-root"
            role="dialog"
            aria-modal="true"
            aria-label="Add product"
          >
            <button
              type="button"
              className="product-modal-backdrop"
              aria-label="Close"
              onClick={() => setShowForm(false)}
            />
            <form className="product-editor" onSubmit={handleCreateSubmit}>
              <header className="product-editor-header">
                <div className="min-w-0">
                  <h2>Add product</h2>
                  <p className="sku">All fields on this screen</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => setShowForm(false)}
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </Button>
              </header>

              <div className="product-editor-scroll">
                <div className="product-field">
                  <label htmlFor="create-name">Name *</label>
                  <Input
                    id="create-name"
                    className={inputClass}
                    placeholder="Product name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    autoFocus
                    required
                  />
                </div>
                <div className="product-field-row">
                  <div className="product-field">
                    <label htmlFor="create-sku">SKU</label>
                    <Input
                      id="create-sku"
                      className={`${inputClass} font-mono`}
                      placeholder="Auto"
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })}
                      maxLength={100}
                      autoComplete="off"
                    />
                  </div>
                  <div className="product-field">
                    <label htmlFor="create-stock">Stock</label>
                    <Input
                      id="create-stock"
                      className={inputClass}
                      placeholder="0"
                      type="number"
                      min={0}
                      step="1"
                      inputMode="numeric"
                      value={form.initialStock}
                      onChange={(e) => setForm({ ...form, initialStock: e.target.value })}
                    />
                  </div>
                </div>
                <div className="product-field">
                  <label htmlFor="create-barcode">Barcode</label>
                  <div className="flex gap-1.5 min-w-0">
                    <Input
                      id="create-barcode"
                      className={`${inputClass} font-mono flex-1 min-w-0`}
                      placeholder="Scan or type"
                      value={form.barcode}
                      onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-10 w-10 shrink-0 rounded-lg px-0"
                      loading={scanning && scanTarget === 'create'}
                      onClick={() => void scanProductBarcode('create')}
                      aria-label="Scan barcode"
                    >
                      {canUseCameraScan() ? <Camera className="h-4 w-4" /> : <ScanBarcode className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="product-field">
                  <label>Type</label>
                  <div className="product-chip-row" role="group" aria-label="Product type">
                    {PRODUCT_TYPES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        className="product-chip"
                        data-active={form.type === t.value}
                        onClick={() => setForm({ ...form, type: t.value })}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="product-field-row">
                  <div className="product-field">
                    <label htmlFor="create-cost">Cost ({moneyCode})</label>
                    <Input
                      id="create-cost"
                      className={inputClass}
                      placeholder="0.00"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={form.costPrice}
                      onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                    />
                  </div>
                  <div className="product-field">
                    <label htmlFor="create-price">Sell price ({moneyCode})</label>
                    <Input
                      id="create-price"
                      className={`${inputClass} font-semibold`}
                      placeholder="0.00"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={form.sellingPrice}
                      onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                    />
                  </div>
                </div>
                <div className="product-field">
                  <label>Photo</label>
                  <div className="flex items-center gap-2">
                    {form.imageUrl ? (
                      <img
                        src={getMediaUrl(form.imageUrl) || ''}
                        alt=""
                        className="h-12 w-12 rounded-lg object-cover border border-border"
                      />
                    ) : null}
                    <Input
                      type="file"
                      accept="image/*"
                      className="text-xs"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadProductImage(f, 'create');
                      }}
                    />
                  </div>
                </div>
              </div>

              <footer className="product-editor-footer">
                <Button
                  type="submit"
                  className="flex-1 h-11"
                  loading={createMutation.isPending}
                  disabled={!form.name.trim() || createMutation.isPending}
                >
                  Save product
                </Button>
                <Button
                  type="button"
                  className="h-11 px-4"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </footer>
            </form>
          </div>,
          document.body
        )
      : null;

  const editModal =
    editing
      ? createPortal(
          <div
            className="product-modal-root"
            role="dialog"
            aria-modal="true"
            aria-label="Edit product"
          >
            <button
              type="button"
              className="product-modal-backdrop"
              aria-label="Close"
              onClick={() => setEditing(null)}
            />
            <form className="product-editor" onSubmit={handleEditSubmit}>
              <header className="product-editor-header">
                <div className="min-w-0">
                  <h2>Edit product</h2>
                  <p className="sku truncate">SKU {editing.sku}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => setEditing(null)}
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </Button>
              </header>

              <div className="product-editor-scroll">
                <div className="product-field">
                  <label htmlFor="edit-name">Name *</label>
                  <Input
                    id="edit-name"
                    className={inputClass}
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    disabled={!canUpdate}
                    autoFocus
                    required
                  />
                </div>

                <div className="product-field">
                  <label htmlFor="edit-barcode">Barcode</label>
                  <div className="flex gap-1.5 min-w-0">
                    <Input
                      id="edit-barcode"
                      className={`${inputClass} font-mono flex-1 min-w-0`}
                      placeholder="Optional"
                      value={editForm.barcode}
                      onChange={(e) => setEditForm({ ...editForm, barcode: e.target.value })}
                      disabled={!canUpdate}
                    />
                    {canUpdate && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-10 w-10 shrink-0 rounded-lg px-0"
                        loading={scanning && scanTarget === 'edit'}
                        onClick={() => void scanProductBarcode('edit')}
                        aria-label="Scan barcode"
                      >
                        <Camera className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="product-field-row">
                  <div className="product-field">
                    <label htmlFor="edit-cost">Cost ({moneyCode})</label>
                    <Input
                      id="edit-cost"
                      className={inputClass}
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={editForm.costPrice}
                      onChange={(e) => setEditForm({ ...editForm, costPrice: e.target.value })}
                      disabled={!canUpdate}
                    />
                  </div>
                  <div className="product-field">
                    <label htmlFor="edit-price">Sell price ({moneyCode}) *</label>
                    <Input
                      id="edit-price"
                      className={`${inputClass} font-semibold`}
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={editForm.sellingPrice}
                      onChange={(e) => setEditForm({ ...editForm, sellingPrice: e.target.value })}
                      disabled={!canUpdate}
                    />
                  </div>
                </div>

                <div className="product-field">
                  <label>Type</label>
                  <div className="product-chip-row" role="group" aria-label="Product type">
                    {PRODUCT_TYPES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        className="product-chip"
                        data-active={editForm.type === t.value}
                        disabled={!canUpdate}
                        onClick={() => setEditForm({ ...editForm, type: t.value })}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="product-field">
                  <label>Status</label>
                  <div className="product-chip-row" role="group" aria-label="Product status">
                    <button
                      type="button"
                      className="product-chip"
                      data-active={editForm.isActive}
                      disabled={!canUpdate}
                      onClick={() => setEditForm({ ...editForm, isActive: true })}
                    >
                      Active
                    </button>
                    <button
                      type="button"
                      className="product-chip"
                      data-active={!editForm.isActive}
                      disabled={!canUpdate}
                      onClick={() => setEditForm({ ...editForm, isActive: false })}
                    >
                      Inactive
                    </button>
                  </div>
                </div>
              </div>

              <footer className="product-editor-footer">
                {canDelete && (
                  <Button
                    type="button"
                    className="h-11 shrink-0 px-3"
                    variant="destructive"
                    loading={deleteMutation.isPending}
                    onClick={() => requestDelete(editing)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  className="h-11 shrink-0 px-3"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
                {canUpdate && (
                  <Button
                    type="submit"
                    className="flex-1 h-11 min-w-0"
                    loading={updateMutation.isPending}
                    disabled={!editForm.name.trim() || updateMutation.isPending}
                  >
                    <Pencil className="h-4 w-4" /> Save
                  </Button>
                )}
              </footer>
            </form>
          </div>,
          document.body
        )
      : null;

  const deleteModal =
    deleteTarget
      ? createPortal(
          <div className="product-modal-root" role="dialog" aria-modal="true" aria-label="Delete product">
            <button
              type="button"
              className="product-modal-backdrop"
              aria-label="Cancel delete"
              onClick={() => setDeleteTarget(null)}
            />
            <div className="product-confirm">
              <h3 className="text-base font-bold">Delete product?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                <strong className="text-foreground">{deleteTarget.name}</strong> ({deleteTarget.sku}) will
                be removed from the catalog and POS. Past sales stay in history.
              </p>
              <div className="flex gap-2 mt-4">
                <Button
                  type="button"
                  className="flex-1 h-11"
                  variant="outline"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteMutation.isPending}
                >
                  Keep
                </Button>
                <Button
                  type="button"
                  className="flex-1 h-11"
                  variant="destructive"
                  loading={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(deleteTarget.id)}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="page-container fit-x pb-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Products</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {data?.meta?.total ?? 0} items · tap Edit to change prices
            {isFetching ? ' · refreshing…' : ''}
          </p>
        </div>
        {canCreate && (
          <Button className="shrink-0 h-10" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
      </div>

      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9 h-11 text-base sm:text-sm"
          placeholder="Search name, SKU, barcode..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 sm:hidden">
        {isLoading && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Loading products…
            </CardContent>
          </Card>
        )}
        {!isLoading && !productList.length && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Package className="mx-auto h-8 w-8 mb-2 opacity-40" />
              <EmptyState
                icon={Package}
                title="No products yet"
                description="Add your first item so POS and inventory have something to sell."
                action={
                  canCreate
                    ? { label: 'Add product', onClick: () => openCreate() }
                    : undefined
                }
              />
              {canCreate && (
                <Button className="mt-3" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> Add first product
                </Button>
              )}
            </CardContent>
          </Card>
        )}
        {productList.map((p) => (
          <Card key={p.id} className="overflow-hidden">
            <CardContent className="p-3 space-y-2.5">
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex items-start gap-2">
                    {p.imageUrl ? (
                      <img
                        src={getMediaUrl(p.imageUrl) || ''}
                        alt=""
                        className="h-11 w-11 rounded-lg object-cover border border-border shrink-0"
                      />
                    ) : null}
                    <div className="min-w-0">
                      <p className="font-semibold text-sm leading-snug break-words">{p.name}</p>
                      <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                        {p.sku}
                        {p.barcode ? ` · ${p.barcode}` : ''}
                      </p>
                    </div>
                  </div>
                  <Badge variant={p.isActive ? 'success' : 'secondary'} className="shrink-0">
                    {p.isActive ? 'Active' : 'Off'}
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center rounded-lg bg-muted/50 px-2 py-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost</p>
                    <p className="text-xs tabular-nums font-medium truncate">
                      {formatCurrency(Number(p.costPrice))}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Price</p>
                    <p className="text-xs tabular-nums font-bold truncate text-primary">
                      {formatCurrency(Number(p.sellingPrice))}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Stock</p>
                    <p className="text-xs tabular-nums font-medium">{p.stockQty ?? '—'}</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                  <Button
                    type="button"
                    className="h-10 px-3"
                    variant="secondary"
                    onClick={() =>
                      printProductLabel({
                        name: p.name,
                        price: p.sellingPrice,
                        sku: p.sku,
                        barcode: p.barcode,
                        companyName,
                      })
                    }
                  >
                    <Tag className="h-4 w-4" /> Label
                  </Button>
                  {canUpdate && (
                    <Button type="button" className="flex-1 h-10" variant="outline" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" /> Edit
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      type="button"
                      className="h-10 px-3"
                      variant="destructive"
                      onClick={() => requestDelete(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop table */}
      <Card className="hidden sm:block">
        <CardContent className="p-0 table-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium text-right">Cost</th>
                <th className="px-4 py-3 font-medium text-right">Price</th>
                <th className="px-4 py-3 font-medium text-right">Stock</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {(canUpdate || canDelete) && (
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              )}
              {!isLoading && !productList.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <Package className="mx-auto h-8 w-8 mb-2 opacity-40" />
                    No products found
                  </td>
                </tr>
              )}
              {productList.map((p) => (
                <tr key={p.id} className="border-b border-border/60 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-medium">{p.name}</p>
                    {p.category && (
                      <p className="text-xs text-muted-foreground">{p.category.name}</p>
                    )}
                    {p.barcode && (
                      <p className="text-[10px] font-mono text-muted-foreground">{p.barcode}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary">{p.type}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(Number(p.costPrice))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {formatCurrency(Number(p.sellingPrice))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.stockQty ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={p.isActive ? 'success' : 'secondary'}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  {(canUpdate || canDelete) && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {canUpdate && (
                          <Button type="button" size="sm" variant="outline" onClick={() => openEdit(p)}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => requestDelete(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {createModal}
      {editModal}
      {deleteModal}
    </div>
  );
}
