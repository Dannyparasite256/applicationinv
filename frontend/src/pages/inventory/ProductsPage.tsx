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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';

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

  return (
    <div className="page-container fit-x">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-sm text-muted-foreground">
            {data?.meta?.total ?? 0} items · edit prices anytime · delete when no longer needed
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => {
              setShowForm((v) => !v);
              setForm(emptyForm());
            }}
          >
            <Plus className="h-4 w-4" /> Add Product
          </Button>
        )}
      </div>

      {showForm && canCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New product</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <Input
                  placeholder="Product name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">SKU</label>
                <Input
                  placeholder="e.g. PRD-001 or leave blank"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })}
                  className="font-mono"
                  maxLength={100}
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  Optional. Leave empty to auto-generate (PRD-000001…).
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Barcode</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Scan or type barcode / EAN"
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    className="font-mono flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0 px-3"
                    title="Scan with camera"
                    loading={scanning && scanTarget === 'create'}
                    onClick={() => void scanProductBarcode('create')}
                  >
                    {canUseCameraScan() ? (
                      <Camera className="h-4 w-4" />
                    ) : (
                      <ScanBarcode className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="PRODUCT">Product</option>
                  <option value="SERVICE">Service</option>
                  <option value="DRUG">Drug</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Cost price</label>
                <Input
                  placeholder="0.00"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Selling price</label>
                <Input
                  placeholder="0.00"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.sellingPrice}
                  onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Initial stock</label>
                <Input
                  placeholder="0"
                  type="number"
                  min={0}
                  step="1"
                  value={form.initialStock}
                  onChange={(e) => setForm({ ...form, initialStock: e.target.value })}
                />
              </div>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
                <Button
                  className="flex-1"
                  loading={createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                  disabled={!form.name.trim()}
                >
                  Save product
                </Button>
                <Button variant="ghost" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search name, SKU, barcode..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
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

      {/* Edit product modal — prices, name, barcode, active */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <Card
            className="modal-sheet relative z-10 m-0 sm:m-auto w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-base">Edit product</CardTitle>
                  <CardDescription className="font-mono text-xs">
                    SKU {editing.sku} · change cost/selling price anytime
                  </CardDescription>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setEditing(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  disabled={!canUpdate}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Barcode</label>
                <div className="flex gap-2">
                  <Input
                    value={editForm.barcode}
                    onChange={(e) => setEditForm({ ...editForm, barcode: e.target.value })}
                    className="font-mono flex-1"
                    disabled={!canUpdate}
                  />
                  {canUpdate && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0 px-3"
                      loading={scanning && scanTarget === 'edit'}
                      onClick={() => void scanProductBarcode('edit')}
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={editForm.type}
                  onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                  disabled={!canUpdate}
                >
                  <option value="PRODUCT">Product</option>
                  <option value="SERVICE">Service</option>
                  <option value="DRUG">Drug</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={editForm.isActive ? 'active' : 'inactive'}
                  onChange={(e) =>
                    setEditForm({ ...editForm, isActive: e.target.value === 'active' })
                  }
                  disabled={!canUpdate}
                >
                  <option value="active">Active (for sale)</option>
                  <option value="inactive">Inactive (hidden from POS)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Cost price</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editForm.costPrice}
                  onChange={(e) => setEditForm({ ...editForm, costPrice: e.target.value })}
                  disabled={!canUpdate}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Selling price</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editForm.sellingPrice}
                  onChange={(e) => setEditForm({ ...editForm, sellingPrice: e.target.value })}
                  disabled={!canUpdate}
                  className="font-semibold"
                />
              </div>
              <div className="sm:col-span-2 flex flex-wrap gap-2 pt-1">
                {canUpdate && (
                  <Button
                    loading={updateMutation.isPending}
                    disabled={!editForm.name.trim()}
                    onClick={() => updateMutation.mutate()}
                  >
                    <Pencil className="h-4 w-4" /> Save changes
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="destructive"
                    loading={deleteMutation.isPending}
                    onClick={() => confirmDelete(editing)}
                  >
                    <Trash2 className="h-4 w-4" /> Delete product
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
