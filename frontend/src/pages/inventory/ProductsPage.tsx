import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Package, Camera, ScanBarcode, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { scanBarcode, canUseCameraScan } from '@/native/barcodeScan';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';

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
});

export function ProductsPage() {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [scanning, setScanning] = useState(false);
  const [scanTarget, setScanTarget] = useState<'create' | 'edit'>('create');
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const canCreate = hasPermission('inventory.products.create');
  const canUpdate = hasPermission('inventory.products.update');
  const canDelete = hasPermission('inventory.products.delete');

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

  const { data, isLoading } = useQuery({
    queryKey: ['products', search],
    queryFn: async () => {
      const res = await api.get('/products', { params: { search: search || undefined, limit: 50 } });
      return res.data as { data: Product[]; meta: { total: number } };
    },
  });

  const invalidateProductQueries = () => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['products-mini'] });
    qc.invalidateQueries({ queryKey: ['pos-products'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const sku = form.sku.trim();
      const res = await api.post('/products', {
        name: form.name.trim(),
        ...(sku ? { sku } : {}),
        sellingPrice: parseFloat(form.sellingPrice) || 0,
        costPrice: parseFloat(form.costPrice) || 0,
        barcode: form.barcode.trim() || undefined,
        type: form.type,
        initialStock: Math.max(0, parseFloat(form.initialStock) || 0),
      });
      return res.data;
    },
    onSuccess: (res) => {
      const createdSku = res?.data?.sku;
      toast.success(createdSku ? `Product created · SKU ${createdSku}` : 'Product created');
      setShowForm(false);
      setForm(emptyForm());
      invalidateProductQueries();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error('No product selected');
      const res = await api.put(`/products/${editing.id}`, {
        name: editForm.name.trim(),
        sellingPrice: parseFloat(editForm.sellingPrice) || 0,
        costPrice: parseFloat(editForm.costPrice) || 0,
        barcode: editForm.barcode.trim() || null,
        type: editForm.type,
        isActive: editForm.isActive,
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Product updated — prices apply to new sales immediately');
      setEditing(null);
      invalidateProductQueries();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      toast.success('Product deleted');
      setEditing(null);
      invalidateProductQueries();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const openEdit = (p: Product) => {
    if (!canUpdate && !canDelete) {
      toast.message('You do not have permission to edit products');
      return;
    }
    setEditing(p);
    setEditForm({
      name: p.name,
      sku: p.sku,
      sellingPrice: String(Number(p.sellingPrice) || 0),
      costPrice: String(Number(p.costPrice) || 0),
      barcode: p.barcode || '',
      type: p.type || 'PRODUCT',
      initialStock: '0',
      isActive: p.isActive !== false,
    });
  };

  const confirmDelete = (p: Product) => {
    if (!canDelete) {
      toast.message('You do not have permission to delete products');
      return;
    }
    if (
      window.confirm(
        `Delete “${p.name}” (${p.sku})?\n\nIt will be removed from the catalog and POS. Past sales stay in history.`
      )
    ) {
      deleteMutation.mutate(p.id);
    }
  };

  const openCreate = () => {
    setForm(emptyForm());
    setShowForm(true);
  };

  const productTypes = [
    { value: 'PRODUCT', label: 'Product' },
    { value: 'SERVICE', label: 'Service' },
    { value: 'DRUG', label: 'Drug' },
  ] as const;

  const inputClass =
    'h-10 w-full rounded-lg border border-input bg-background px-2.5 text-base';

  return (
    <div className="page-container fit-x pb-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Products</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {data?.meta?.total ?? 0} items · tap a product to edit
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

      {/* —— Mobile: stacked product cards (fits phone width) —— */}
      <div className="space-y-2 sm:hidden">
        {isLoading && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Loading products…
            </CardContent>
          </Card>
        )}
        {!isLoading && !data?.data?.length && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Package className="mx-auto h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">No products found</p>
            </CardContent>
          </Card>
        )}
        {data?.data?.map((p) => (
          <Card key={p.id} className="overflow-hidden">
            <CardContent className="p-3 space-y-2.5">
              <button
                type="button"
                className="w-full text-left min-w-0"
                onClick={() => (canUpdate || canDelete) && openEdit(p)}
                disabled={!canUpdate && !canDelete}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm leading-snug break-words">{p.name}</p>
                    <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                      {p.sku}
                      {p.barcode ? ` · ${p.barcode}` : ''}
                    </p>
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
              </button>
              {(canUpdate || canDelete) && (
                <div className="flex gap-2 pt-0.5">
                  {canUpdate && (
                    <Button className="flex-1 h-10" variant="outline" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4" /> Edit
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      className="h-10 px-3"
                      variant="destructive"
                      loading={deleteMutation.isPending}
                      onClick={() => confirmDelete(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* —— Desktop / tablet: table —— */}
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
              {!isLoading && !data?.data?.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <Package className="mx-auto h-8 w-8 mb-2 opacity-40" />
                    No products found
                  </td>
                </tr>
              )}
              {data?.data?.map((p) => (
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
                          <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="destructive"
                            loading={deleteMutation.isPending}
                            onClick={() => confirmDelete(p)}
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

      {/* —— Compact full-screen Add product (all fields on one screen) —— */}
      {showForm && canCreate && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Add product"
          onClick={() => setShowForm(false)}
        >
          <div className="product-editor" onClick={(e) => e.stopPropagation()}>
            <header className="product-editor-header">
              <div className="min-w-0">
                <h2>Add product</h2>
                <p className="sku">Fill in and tap Save</p>
              </div>
              <Button
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
                  {productTypes.map((t) => (
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
                  <label htmlFor="create-cost">Cost</label>
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
                  <label htmlFor="create-price">Sell price</label>
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
            </div>

            <footer className="product-editor-footer">
              <Button
                className="flex-1 h-10"
                loading={createMutation.isPending}
                onClick={() => createMutation.mutate()}
                disabled={!form.name.trim()}
              >
                Save
              </Button>
              <Button className="h-10 px-4" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </footer>
          </div>
        </div>
      )}

      {/* —— Compact full-screen Edit product (all fields + buttons visible) —— */}
      {editing && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Edit product"
          onClick={() => setEditing(null)}
        >
          <div className="product-editor" onClick={(e) => e.stopPropagation()}>
            <header className="product-editor-header">
              <div className="min-w-0">
                <h2>Edit product</h2>
                <p className="sku truncate">SKU {editing.sku}</p>
              </div>
              <Button
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
                  <label htmlFor="edit-cost">Cost price</label>
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
                  <label htmlFor="edit-price">Sell price *</label>
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
                  {productTypes.map((t) => (
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
                  className="h-10 shrink-0 px-3"
                  variant="destructive"
                  loading={deleteMutation.isPending}
                  onClick={() => confirmDelete(editing)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Button className="h-10 shrink-0 px-3" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              {canUpdate && (
                <Button
                  className="flex-1 h-10 min-w-0"
                  loading={updateMutation.isPending}
                  disabled={!editForm.name.trim()}
                  onClick={() => updateMutation.mutate()}
                >
                  <Pencil className="h-4 w-4" /> Save
                </Button>
              )}
              {!canUpdate && !canDelete && (
                <p className="text-xs text-center text-muted-foreground flex-1">
                  No permission to edit products
                </p>
              )}
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
