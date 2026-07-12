import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/config';
import { formatCurrency, formatDate, parseMoneyToBase, displayCurrencyCode } from '@/lib/utils';
import { getMediaUrl, brandInitials } from '@/lib/media';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { useCurrencyStore } from '@/stores/currencyStore';
import { canRefundOrDeleteSales } from '@/lib/roleAccess';
import { APP_FONTS } from '@/lib/fonts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  Plus,
  RefreshCw,
  Package,
  Share2,
  UserCheck,
  Camera,
  Building2,
  ImagePlus,
  Type,
  ChevronRight,
} from 'lucide-react';
import { PrintShareDialog } from '@/components/shared/PrintShareDialog';
import { Link } from 'react-router-dom';

function PageShell({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-subtitle">{description}</p>}
        </div>
        {action && <div className="page-actions">{action}</div>}
      </div>
      <div className="stack-y fit-x">{children}</div>
    </div>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: React.ReactNode[][] }) {
  return (
    <Card className="fit-x">
      <CardContent className="p-0 table-scroll">
        <table className="w-full text-[11px] sm:text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              {columns.map((c) => (
                <th key={c} className="px-2 sm:px-3 py-2 font-medium whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                  No records found
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/60 hover:bg-muted/30">
                {row.map((cell, j) => (
                  <td key={j} className="px-2 sm:px-3 py-1.5 sm:py-2.5 max-w-[9rem] sm:max-w-[14rem]">
                    <div className="min-w-0 truncate">{cell}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

async function downloadAuth(path: string, filename: string) {
  const token = useAuthStore.getState().accessToken;
  const base = getApiBaseUrl();
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function openPdf(path: string) {
  const token = useAuthStore.getState().accessToken;
  const base = getApiBaseUrl();
  // Authenticated fetch + blob URL (do not open the API URL bare — auth header is required)
  fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => {
      if (!r.ok) throw new Error('PDF request failed');
      return r.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    })
    .catch(() => toast.error('Could not open PDF'));
}

// ═══════════════════ SALES ═══════════════════
/** After refund/delete/charge — refresh every surface that shows sales or money. */
function invalidateAfterSaleChange(qc: ReturnType<typeof useQueryClient>) {
  const keys = [
    'sales',
    'dashboard',
    'products',
    'products-mini',
    'pos-products-search',
    'pos-products',
    'stock-levels',
    'stock-movements',
    'low-stock',
    'current-shift',
    'reports',
    'report-sales',
    'report-profit',
    'invoices',
  ] as const;
  for (const key of keys) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
  // Force dashboard/sales to re-fetch now (not only when the page remounts)
  void qc.refetchQueries({ queryKey: ['dashboard'], type: 'all' });
  void qc.refetchQueries({ queryKey: ['sales'], type: 'all' });
  void qc.refetchQueries({ queryKey: ['products'], type: 'all' });
  void qc.refetchQueries({ queryKey: ['stock-levels'], type: 'all' });
}

export function SalesPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canReverseSales = canRefundOrDeleteSales(user?.roles || [], user?.permissions || []);
  const [printId, setPrintId] = useState<string | null>(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['sales'],
    queryFn: async () => (await api.get('/sales', { params: { limit: 50 } })).data,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  const refund = useMutation({
    mutationFn: async (id: string) =>
      api.post(`/sales/${id}/refund`, { reason: 'Customer return' }),
    onSuccess: () => {
      toast.success('Sale refunded — stock & totals updated');
      invalidateAfterSaleChange(qc);
      void refetch();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const remove = useMutation({
    // POST /void is more reliable than DELETE on some mobile WebViews / proxies
    mutationFn: async (id: string) =>
      api.post(`/sales/${id}/void`, { reason: 'Mistake — deleted by user' }),
    onSuccess: () => {
      toast.success('Sale deleted — inventory restored');
      invalidateAfterSaleChange(qc);
      void refetch();
    },
    onError: (e) => toast.error(getErrorMessage(e) || 'Could not delete sale'),
  });

  const rows = data?.data || [];

  return (
    <PageShell
      title="Sales"
      description={
        canReverseSales
          ? 'POS transactions — refund, delete mistakes, print & share'
          : 'POS transactions — print & share (refund/delete: managers only)'
      }
      action={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link to="/app/pos">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Record sale (POS)
            </Button>
          </Link>
        </div>
      }
    >
      {printId && (
        <PrintShareDialog
          open={!!printId}
          onClose={() => {
            setPrintId(null);
            setAutoPrint(false);
          }}
          type="receipt"
          id={printId}
          autoPrint={autoPrint}
        />
      )}
      {isLoading ? (
        <p className="text-muted-foreground">Loading sales…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-muted-foreground">No sales recorded yet.</p>
            <Link to="/app/pos">
              <Button>
                <Plus className="h-4 w-4 mr-1" />
                Open POS to record a sale
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={['Sale #', 'Customer', 'Total', 'Payment', 'Date', 'Actions']}
          rows={rows.map(
            (s: {
              id: string;
              saleNo: string;
              total: number;
              paymentStatus: string;
              status: string;
              saleDate: string;
              customer?: { firstName?: string; lastName?: string; businessName?: string };
            }) => {
              const active =
                s.status !== 'RETURNED' &&
                s.status !== 'CANCELLED' &&
                s.paymentStatus !== 'REFUNDED' &&
                s.paymentStatus !== 'VOID';
              return [
                <span key="n" className="font-mono text-xs font-medium">
                  {s.saleNo}
                </span>,
                s.customer?.businessName ||
                  `${s.customer?.firstName || ''} ${s.customer?.lastName || ''}`.trim() ||
                  'Walk-in',
                formatCurrency(Number(s.total)),
                <div key="p" className="flex gap-1 flex-wrap">
                  <Badge
                    variant={
                      s.paymentStatus === 'PAID'
                        ? 'success'
                        : s.paymentStatus === 'REFUNDED' || s.paymentStatus === 'VOID'
                          ? 'destructive'
                          : 'warning'
                    }
                  >
                    {s.paymentStatus}
                  </Badge>
                  {s.status === 'RETURNED' && <Badge variant="secondary">RETURNED</Badge>}
                  {s.status === 'CANCELLED' && <Badge variant="secondary">CANCELLED</Badge>}
                </div>,
                formatDate(s.saleDate),
                <div key="a" className="flex gap-1 flex-wrap items-center max-w-[280px]">
                  <Button
                    size="sm"
                    variant="outline"
                    title="Print receipt"
                    onClick={() => {
                      setAutoPrint(true);
                      setPrintId(s.id);
                    }}
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    title="Share receipt"
                    onClick={() => {
                      setAutoPrint(false);
                      setPrintId(s.id);
                    }}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </Button>
                  {active && canReverseSales ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        title="Customer return — restore stock"
                        loading={refund.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Refund sale ${s.saleNo}? Stock will be put back and totals updated.`
                            )
                          ) {
                            refund.mutate(s.id);
                          }
                        }}
                      >
                        Refund
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        title="Delete this sale (mistake) — restores stock"
                        loading={remove.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete sale ${s.saleNo}?\n\nUse this when you made a mistake.\n• Stock is restored\n• Sale is removed from the list`
                            )
                          ) {
                            remove.mutate(s.id);
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  ) : active && !canReverseSales ? (
                    <span className="text-[11px] text-muted-foreground px-1">View only</span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground px-1">
                      {s.status === 'RETURNED' || s.paymentStatus === 'REFUNDED'
                        ? 'Refunded'
                        : 'Closed'}
                    </span>
                  )}
                </div>,
              ];
            }
          )}
        />
      )}
    </PageShell>
  );
}

// ═══════════════════ CUSTOMERS ═══════════════════
export function CustomersPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '' });
  const [show, setShow] = useState(false);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await api.get('/customers', { params: { limit: 50 } })).data,
  });
  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };
      if (!payload.firstName && !payload.lastName && !payload.phone && !payload.email) {
        throw new Error('Enter a name, phone, or email');
      }
      return api.post('/customers', payload);
    },
    onSuccess: () => {
      toast.success('Customer created');
      setShow(false);
      setForm({ firstName: '', lastName: '', phone: '', email: '' });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <PageShell
      title="Customers"
      description="CRM profiles, balances & loyalty points"
      action={
        <Button onClick={() => setShow((v) => !v)}>
          <Plus className="h-4 w-4" /> Add customer
        </Button>
      }
    >
      {show && (
        <Card>
          <CardContent className="pt-5 grid gap-3 sm:grid-cols-5">
            <Input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            <Input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Button onClick={() => create.mutate()} loading={create.isPending}>
              Save
            </Button>
          </CardContent>
        </Card>
      )}
      <DataTable
        columns={['Code', 'Name', 'Phone', 'Email', 'Balance', 'Points']}
        rows={(data?.data || []).map(
          (c: {
            code: string;
            firstName?: string;
            lastName?: string;
            businessName?: string;
            phone?: string;
            email?: string;
            balance: number;
            loyaltyPoints: number;
          }) => [
            c.code,
            c.businessName || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
            c.phone || '—',
            c.email || '—',
            formatCurrency(Number(c.balance)),
            String(c.loyaltyPoints),
          ]
        )}
      />
    </PageShell>
  );
}

// ═══════════════════ SUPPLIERS ═══════════════════
export function SuppliersPage() {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', contactPerson: '' });
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data,
  });
  const create = useMutation({
    mutationFn: async () => api.post('/suppliers', form),
    onSuccess: () => {
      toast.success('Supplier created');
      setShow(false);
      qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <PageShell
      title="Suppliers"
      description="Vendor management"
      action={
        <Button onClick={() => setShow((v) => !v)}>
          <Plus className="h-4 w-4" /> Add supplier
        </Button>
      }
    >
      {show && (
        <Card>
          <CardContent className="pt-5 grid gap-3 sm:grid-cols-5">
            <Input placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Contact" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
            <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.name}>
              Save
            </Button>
          </CardContent>
        </Card>
      )}
      <DataTable
        columns={['Code', 'Name', 'Email', 'Phone', 'Balance']}
        rows={(data?.data || []).map((s: { code: string; name: string; email?: string; phone?: string; balance: number }) => [
          s.code,
          s.name,
          s.email || '—',
          s.phone || '—',
          formatCurrency(Number(s.balance)),
        ])}
      />
    </PageShell>
  );
}

// ═══════════════════ PURCHASES ═══════════════════
export function PurchasesPage() {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('10');
  const [cost, setCost] = useState('5');

  const { data } = useQuery({
    queryKey: ['purchases'],
    queryFn: async () => (await api.get('/purchases')).data,
  });
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data,
  });
  const { data: products } = useQuery({
    queryKey: ['products-mini'],
    queryFn: async () => (await api.get('/products', { params: { limit: 100 } })).data,
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error('Select a supplier');
      if (!productId) throw new Error('Select a product');
      const quantity = parseFloat(qty);
      const unitCost = parseFloat(cost);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a valid quantity');
      if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error('Enter a valid unit cost');
      return api.post('/purchases', {
        supplierId,
        items: [{ productId, quantity, unitCost }],
      });
    },
    onSuccess: () => {
      toast.success('Purchase order created');
      setShow(false);
      qc.invalidateQueries({ queryKey: ['purchases'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const receive = useMutation({
    mutationFn: async (po: { id: string; orderNo?: string; items?: Array<{ id: string; quantity: number; receivedQty: number }> }) => {
      // Prefer default warehouse, then first available
      const whList = (warehouses?.data || []) as Array<{ id: string; isDefault?: boolean; name?: string }>;
      const wh =
        whList.find((w) => w.isDefault)?.id ||
        whList[0]?.id ||
        (await api.get('/warehouses')).data?.data?.[0]?.id;
      if (!wh) throw new Error('No warehouse configured. Create one under Settings first.');

      // List payload may omit items — always load full PO when needed
      let lines = Array.isArray(po.items) ? po.items : [];
      if (!lines.length) {
        const full = await api.get(`/purchases/${po.id}`);
        lines = full.data?.data?.items || [];
      }
      if (!lines.length) throw new Error('This purchase order has no line items');

      const items = lines
        .map((i) => ({
          itemId: i.id,
          receivedQty: Math.max(0, Number(i.quantity) - Number(i.receivedQty || 0)),
        }))
        .filter((i) => i.receivedQty > 0);

      if (!items.length) throw new Error('Already fully received');

      return api.post(`/purchases/${po.id}/receive`, {
        warehouseId: wh,
        items,
      });
    },
    onSuccess: (res) => {
      const status = res.data?.data?.status;
      toast.success(
        status === 'RECEIVED'
          ? 'Goods fully received — stock updated'
          : 'Partial receipt recorded — stock updated'
      );
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
    },
    onError: (e) => toast.error(getErrorMessage(e) || 'Could not receive goods'),
  });

  return (
    <PageShell
      title="Purchases"
      description="Purchase orders & goods receipt (updates stock)"
      action={
        <Button onClick={() => setShow((v) => !v)}>
          <Plus className="h-4 w-4" /> New PO
        </Button>
      }
    >
      {show && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create purchase order</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select supplier</option>
              {(suppliers?.data || []).map((s: { id: string; name: string }) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Select product</option>
              {(products?.data || []).map((p: { id: string; name: string; sku: string }) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
            <Input type="number" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
            <Input type="number" placeholder="Unit cost" value={cost} onChange={(e) => setCost(e.target.value)} />
            <Button loading={create.isPending} disabled={!supplierId || !productId} onClick={() => create.mutate()}>
              Create PO
            </Button>
          </CardContent>
        </Card>
      )}
      <DataTable
        columns={['PO #', 'Supplier', 'Total', 'Status', 'Created', 'Actions']}
        rows={(data?.data || []).map(
          (p: {
            id: string;
            orderNo: string;
            total: number;
            status: string;
            createdAt: string;
            supplier?: { name: string };
            items?: Array<{ id: string; quantity: number; receivedQty: number }>;
          }) => [
            p.orderNo,
            p.supplier?.name || '—',
            formatCurrency(Number(p.total)),
            <Badge key="s" variant={p.status === 'RECEIVED' ? 'success' : 'secondary'}>
              {p.status}
            </Badge>,
            formatDate(p.createdAt),
            p.status !== 'RECEIVED' && p.status !== 'CANCELLED' ? (
              <Button key="r" size="sm" variant="outline" loading={receive.isPending} onClick={() => receive.mutate(p as never)}>
                Receive
              </Button>
            ) : (
              '—'
            ),
          ]
        )}
      />
    </PageShell>
  );
}

// ═══════════════════ INVENTORY ═══════════════════
export function InventoryPage() {
  const qc = useQueryClient();
  const [adjProduct, setAdjProduct] = useState('');
  const [adjQty, setAdjQty] = useState('0');
  const [adjReason, setAdjReason] = useState('Stock count');

  const { data: low } = useQuery({
    queryKey: ['low-stock'],
    queryFn: async () => (await api.get('/products/low-stock')).data.data,
  });
  const { data: stock } = useQuery({
    queryKey: ['stock-levels'],
    queryFn: async () => (await api.get('/stock')).data.data,
  });
  const { data: movements } = useQuery({
    queryKey: ['stock-movements'],
    queryFn: async () => (await api.get('/stock/movements', { params: { limit: 20 } })).data,
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await api.get('/warehouses')).data,
  });
  const { data: products } = useQuery({
    queryKey: ['products-mini'],
    queryFn: async () => (await api.get('/products', { params: { limit: 100 } })).data,
  });

  const adjust = useMutation({
    mutationFn: async () => {
      if (!adjProduct) throw new Error('Select a product');
      const qty = parseFloat(adjQty);
      if (!Number.isFinite(qty) || qty < 0) throw new Error('Enter a valid counted quantity');
      const whList = (warehouses?.data || []) as Array<{ id: string; isDefault?: boolean }>;
      const wh =
        whList.find((w) => w.isDefault)?.id ||
        whList[0]?.id ||
        (await api.get('/warehouses')).data?.data?.[0]?.id;
      if (!wh) throw new Error('No warehouse configured. Create one under Settings first.');
      return api.post('/stock/adjust', {
        warehouseId: wh,
        reason: adjReason,
        items: [{ productId: adjProduct, countedQty: qty }],
      });
    },
    onSuccess: () => {
      toast.success('Stock adjusted');
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['low-stock'] });
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <PageShell title="Inventory" description="Stock levels, adjustments, movements & alerts">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock adjustment</CardTitle>
            <CardDescription>Set counted quantity (stock take)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <select className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" value={adjProduct} onChange={(e) => setAdjProduct(e.target.value)}>
              <option value="">Product</option>
              {(products?.data || []).map((p: { id: string; name: string }) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Input type="number" placeholder="Counted qty" value={adjQty} onChange={(e) => setAdjQty(e.target.value)} />
            <Input placeholder="Reason" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
            <Button disabled={!adjProduct} loading={adjust.isPending} onClick={() => adjust.mutate()}>
              Apply adjustment
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Low stock alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-64 overflow-y-auto">
            {(low || []).map((p: { id: string; name: string; sku: string; stockQty: number; reorderLevel: number }) => (
              <div key={p.id} className="flex justify-between text-sm border-b border-border/50 pb-2">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.sku}</p>
                </div>
                <Badge variant="destructive">
                  {p.stockQty} / {p.reorderLevel}
                </Badge>
              </div>
            ))}
            {!low?.length && <p className="text-sm text-muted-foreground">All stock healthy</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current stock by warehouse</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={['Product', 'SKU', 'Warehouse', 'Qty', 'Value']}
            rows={(stock || []).map(
              (s: {
                quantity: number;
                product: { name: string; sku: string; costPrice: number };
                warehouse: { name: string };
              }) => [
                s.product.name,
                s.product.sku,
                s.warehouse.name,
                String(Number(s.quantity)),
                formatCurrency(Number(s.quantity) * Number(s.product.costPrice)),
              ]
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent movements</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={['Date', 'Product', 'Type', 'Qty', 'Warehouse', 'Ref']}
            rows={(movements?.data || []).map(
              (m: {
                createdAt: string;
                type: string;
                quantity: number;
                reference?: string;
                product: { name: string };
                warehouse: { name: string };
              }) => [
                formatDate(m.createdAt),
                m.product.name,
                <Badge key="t" variant="outline">
                  {m.type}
                </Badge>,
                String(Number(m.quantity)),
                m.warehouse.name,
                m.reference || '—',
              ]
            )}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}

// ═══════════════════ INVOICES ═══════════════════
type InvoiceLineDraft = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
};

type InvoiceRow = {
  id: string;
  invoiceNo: string;
  total: number | string;
  paidAmount: number | string;
  subtotal?: number | string;
  taxAmount?: number | string;
  discountAmount?: number | string;
  paymentStatus: string;
  status: string;
  dueDate?: string | null;
  notes?: string | null;
  createdAt?: string;
  issuedAt?: string | null;
  currency?: string;
  customer?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    businessName?: string;
    email?: string;
    phone?: string;
  } | null;
  items?: Array<{
    id: string;
    description: string;
    quantity: number | string;
    unitPrice: number | string;
    taxAmount: number | string;
    total: number | string;
  }>;
  payments?: Array<{
    id: string;
    amount: number | string;
    method: string;
    createdAt: string;
    reference?: string | null;
  }>;
  _count?: { items: number; payments: number };
};

function emptyLine(): InvoiceLineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: '',
    quantity: '1',
    unitPrice: '',
    taxRate: '0',
  };
}

export function InvoicesPage() {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [printId, setPrintId] = useState<string | null>(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create form
  const [customerId, setCustomerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState('');
  const [lines, setLines] = useState<InvoiceLineDraft[]>([
    { ...emptyLine(), description: 'Services' },
  ]);

  // Payment form (detail panel)
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER'>('CASH');
  const [payRef, setPayRef] = useState('');

  // From sale
  const [fromSaleId, setFromSaleId] = useState('');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['invoices', search, statusFilter],
    queryFn: async () =>
      (
        await api.get('/invoices', {
          params: {
            limit: 50,
            search: search || undefined,
            paymentStatus: statusFilter || undefined,
            sortBy: 'createdAt',
            sortOrder: 'desc',
          },
        })
      ).data as { data: InvoiceRow[]; meta?: { total: number } },
  });

  const { data: summary } = useQuery({
    queryKey: ['invoices-summary'],
    queryFn: async () =>
      (await api.get('/invoices/summary')).data.data as {
        total: number;
        unpaid: number;
        partial: number;
        paid: number;
        voided: number;
        outstanding: number;
      },
  });

  const { data: customers } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await api.get('/customers', { params: { limit: 100 } })).data,
  });

  const { data: recentSales } = useQuery({
    queryKey: ['sales-for-invoice'],
    queryFn: async () =>
      (await api.get('/sales', { params: { limit: 30, sortBy: 'saleDate', sortOrder: 'desc' } })).data
        .data as Array<{ id: string; saleNo: string; total: number; customer?: { businessName?: string } }>,
  });

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ['invoice-detail', selectedId],
    enabled: !!selectedId,
    queryFn: async () => (await api.get(`/invoices/${selectedId}`)).data.data as InvoiceRow,
  });

  const linePreview = useMemo(() => {
    // Line prices are entered in display currency; convert to base for preview/formatCurrency
    let sub = 0;
    let tax = 0;
    for (const l of lines) {
      const qty = parseFloat(l.quantity) || 0;
      const price = parseMoneyToBase(l.unitPrice);
      const rate = parseFloat(l.taxRate) || 0;
      const lineSub = qty * price;
      sub += lineSub;
      tax += (lineSub * rate) / 100;
    }
    const disc = Math.max(0, parseMoneyToBase(discount));
    return { sub, tax, disc, total: Math.max(0, sub + tax - disc) };
  }, [lines, discount]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['invoices-summary'] });
    qc.invalidateQueries({ queryKey: ['invoice-detail'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const items = lines
        .filter((l) => l.description.trim())
        .map((l) => {
          const quantity = parseFloat(l.quantity) || 0;
          // Prices typed in display currency → company base for API
          const unitPrice = parseMoneyToBase(l.unitPrice);
          const taxRate = parseFloat(l.taxRate) || 0;
          return {
            description: l.description.trim(),
            quantity,
            unitPrice,
            taxRate,
          };
        });
      if (!items.length) throw new Error('Add at least one line with a description');
      if (items.some((i) => i.quantity <= 0)) throw new Error('Quantity must be greater than 0');

      return api.post('/invoices', {
        customerId: customerId || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        notes: notes.trim() || null,
        discountAmount: Math.max(0, parseMoneyToBase(discount)),
        items,
      });
    },
    onSuccess: (res) => {
      toast.success(`Invoice ${res.data?.data?.invoiceNo || ''} created`);
      setShow(false);
      setLines([{ ...emptyLine(), description: 'Services' }]);
      setDiscount('');
      setNotes('');
      setDueDate('');
      setCustomerId('');
      refreshAll();
      if (res.data?.data?.id) setSelectedId(res.data.data.id);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const fromSale = useMutation({
    mutationFn: async (saleId: string) => api.post(`/invoices/from-sale/${saleId}`),
    onSuccess: (res) => {
      toast.success(`Invoice ${res.data?.data?.invoiceNo || ''} created from sale`);
      setFromSaleId('');
      refreshAll();
      if (res.data?.data?.id) setSelectedId(res.data.data.id);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const pay = useMutation({
    mutationFn: async () => {
      if (!selectedId || !detail) throw new Error('Select an invoice');
      const balance = Math.max(0, Number(detail.total) - Number(detail.paidAmount));
      const amount = parseFloat(payAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid payment amount');
      if (amount > balance + 0.001) throw new Error(`Amount exceeds balance (${balance.toFixed(2)})`);
      return api.post(`/invoices/${selectedId}/payments`, {
        amount,
        method: payMethod,
        reference: payRef.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success('Payment recorded');
      setPayAmount('');
      setPayRef('');
      refreshAll();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const voidInv = useMutation({
    mutationFn: async (id: string) =>
      api.post(`/invoices/${id}/void`, { reason: 'Voided from invoices screen' }),
    onSuccess: () => {
      toast.success('Invoice voided');
      refreshAll();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const removeInv = useMutation({
    mutationFn: async (id: string) => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      toast.success('Invoice deleted');
      setSelectedId(null);
      refreshAll();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const rows = data?.data || [];
  const balanceOf = (inv: InvoiceRow) =>
    Math.max(0, Number(inv.total) - Number(inv.paidAmount));

  useEffect(() => {
    if (detail && selectedId === detail.id) {
      const bal = balanceOf(detail);
      if (!payAmount && bal > 0) setPayAmount(String(Math.round(bal * 10000) / 10000));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  return (
    <PageShell
      title="Invoices"
      description="Create multi-line invoices, record payments, print/share PDFs, void mistakes"
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button size="sm" onClick={() => setShow((v) => !v)}>
            <Plus className="h-4 w-4" /> New invoice
          </Button>
        </div>
      }
    >
      {printId && (
        <PrintShareDialog
          open={!!printId}
          onClose={() => {
            setPrintId(null);
            setAutoPrint(false);
          }}
          type="invoice"
          id={printId}
          autoPrint={autoPrint}
        />
      )}

      {/* KPIs */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 min-w-0">
        {[
          { label: 'All invoices', value: summary?.total ?? '—' },
          { label: 'Unpaid', value: summary?.unpaid ?? '—', tone: 'text-warning' },
          { label: 'Partial', value: summary?.partial ?? '—' },
          { label: 'Paid', value: summary?.paid ?? '—', tone: 'text-success' },
          {
            label: 'Outstanding',
            value: summary ? formatCurrency(summary.outstanding) : '—',
            tone: 'text-primary',
          },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-2.5 sm:p-3 shadow-sm min-w-0">
            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{k.label}</p>
            <p className={`text-sm sm:text-lg font-bold tabular-nums mt-0.5 truncate ${k.tone || ''}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Create form */}
      {show && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">New invoice</CardTitle>
            <CardDescription>Add multiple line items, tax %, discount, due date</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Customer</label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">Walk-in / no customer</option>
                  {(customers?.data || []).map(
                    (c: {
                      id: string;
                      firstName?: string;
                      lastName?: string;
                      businessName?: string;
                      code?: string;
                    }) => (
                      <option key={c.id} value={c.id}>
                        {c.businessName ||
                          `${c.firstName || ''} ${c.lastName || ''}`.trim()}
                        {c.code ? ` (${c.code})` : ''}
                      </option>
                    )
                  )}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Due date</label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Invoice discount</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Notes</label>
                <Input
                  placeholder="Optional notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Line items</p>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setLines((prev) => [...prev, emptyLine()])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div
                    key={line.key}
                    className="grid gap-2 sm:grid-cols-12 items-end rounded-xl border border-border p-2 bg-muted/20"
                  >
                    <div className="sm:col-span-5 space-y-1">
                      <label className="text-[11px] text-muted-foreground">Description</label>
                      <Input
                        value={line.description}
                        placeholder="Item or service"
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, description: e.target.value } : l
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[11px] text-muted-foreground">Qty</label>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={line.quantity}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, quantity: e.target.value } : l
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[11px] text-muted-foreground">
                        Unit price ({displayCurrencyCode()})
                      </label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, unitPrice: e.target.value } : l
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[11px] text-muted-foreground">Tax %</label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.taxRate}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, taxRate: e.target.value } : l
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-1 flex justify-end pb-0.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        disabled={lines.length <= 1}
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        ✕
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <div className="text-sm space-y-0.5">
                <p className="text-muted-foreground">
                  Subtotal {formatCurrency(linePreview.sub)} · Tax {formatCurrency(linePreview.tax)}
                  {linePreview.disc > 0 ? ` · Discount −${formatCurrency(linePreview.disc)}` : ''}
                </p>
                <p className="text-lg font-bold text-primary tabular-nums">
                  Total {formatCurrency(linePreview.total)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShow(false)}>
                  Cancel
                </Button>
                <Button loading={create.isPending} onClick={() => create.mutate()}>
                  Create invoice
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create from sale */}
      <Card>
        <CardContent className="pt-4 flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">Create invoice from a sale</label>
            <select
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={fromSaleId}
              onChange={(e) => setFromSaleId(e.target.value)}
            >
              <option value="">Select a recent sale…</option>
              {(recentSales || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.saleNo} · {formatCurrency(Number(s.total))}
                  {s.customer?.businessName ? ` · ${s.customer.businessName}` : ''}
                </option>
              ))}
            </select>
          </div>
          <Button
            loading={fromSale.isPending}
            disabled={!fromSaleId}
            onClick={() => fromSale.mutate(fromSaleId)}
          >
            Invoice from sale
          </Button>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          className="sm:max-w-xs"
          placeholder="Search invoice #, customer, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm sm:w-44"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All payment status</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIAL">Partial</option>
          <option value="PAID">Paid</option>
          <option value="VOID">Void</option>
        </select>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* List */}
        <div className="xl:col-span-3 space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading invoices…</p>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-2">
                <p className="text-muted-foreground">No invoices yet</p>
                <Button onClick={() => setShow(true)}>
                  <Plus className="h-4 w-4" /> Create first invoice
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {rows.map((inv) => {
                const bal = balanceOf(inv);
                const active =
                  inv.paymentStatus !== 'PAID' &&
                  inv.paymentStatus !== 'VOID' &&
                  inv.status !== 'CANCELLED';
                return (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(inv.id);
                      setPayAmount('');
                    }}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      selectedId === inv.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40 bg-card'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold font-mono text-sm">{inv.invoiceNo}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {inv.customer?.businessName ||
                            `${inv.customer?.firstName || ''} ${inv.customer?.lastName || ''}`.trim() ||
                            'No customer'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {inv.issuedAt || inv.createdAt
                            ? formatDate((inv.issuedAt || inv.createdAt) as string)
                            : '—'}
                          {inv.dueDate ? ` · Due ${formatDate(inv.dueDate)}` : ''}
                          {inv._count?.items != null ? ` · ${inv._count.items} lines` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold tabular-nums">{formatCurrency(Number(inv.total))}</p>
                        <Badge
                          variant={
                            inv.paymentStatus === 'PAID'
                              ? 'success'
                              : inv.paymentStatus === 'VOID'
                                ? 'destructive'
                                : inv.paymentStatus === 'PARTIAL'
                                  ? 'warning'
                                  : 'secondary'
                          }
                        >
                          {inv.paymentStatus}
                        </Badge>
                        {active && bal > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Due {formatCurrency(bal)}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="xl:col-span-2">
          <Card className="sticky top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {detail?.invoiceNo || 'Invoice detail'}
              </CardTitle>
              <CardDescription>
                {selectedId
                  ? 'View lines, record payment, print or void'
                  : 'Select an invoice from the list'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedId && (
                <p className="text-sm text-muted-foreground py-10 text-center">
                  Tap an invoice to manage it
                </p>
              )}
              {selectedId && loadingDetail && (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}
              {detail && (
                <>
                  <div className="flex flex-wrap gap-2 items-center">
                    <Badge
                      variant={
                        detail.paymentStatus === 'PAID'
                          ? 'success'
                          : detail.paymentStatus === 'VOID'
                            ? 'destructive'
                            : 'warning'
                      }
                    >
                      {detail.paymentStatus}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{detail.status}</span>
                  </div>

                  <div className="rounded-lg border border-border p-3 text-sm space-y-1">
                    <p>
                      <span className="text-muted-foreground">Customer: </span>
                      <strong>
                        {detail.customer?.businessName ||
                          `${detail.customer?.firstName || ''} ${detail.customer?.lastName || ''}`.trim() ||
                          '—'}
                      </strong>
                    </p>
                    {detail.customer?.phone && (
                      <p className="text-muted-foreground text-xs">{detail.customer.phone}</p>
                    )}
                    {detail.customer?.email && (
                      <p className="text-muted-foreground text-xs">{detail.customer.email}</p>
                    )}
                    {detail.dueDate && (
                      <p>
                        <span className="text-muted-foreground">Due: </span>
                        {formatDate(detail.dueDate)}
                      </p>
                    )}
                    {detail.notes && (
                      <p className="text-xs text-muted-foreground pt-1">{detail.notes}</p>
                    )}
                  </div>

                  <div className="table-scroll rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/40 text-left text-muted-foreground">
                          <th className="px-2 py-2">Item</th>
                          <th className="px-2 py-2 text-right">Qty</th>
                          <th className="px-2 py-2 text-right">Price</th>
                          <th className="px-2 py-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.items || []).map((it) => (
                          <tr key={it.id} className="border-t border-border/60">
                            <td className="px-2 py-2">{it.description}</td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {Number(it.quantity)}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {formatCurrency(Number(it.unitPrice))}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums font-medium">
                              {formatCurrency(Number(it.total))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-sm space-y-1 border-t border-border pt-2">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span>
                      <span>{formatCurrency(Number(detail.subtotal || 0))}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Tax</span>
                      <span>{formatCurrency(Number(detail.taxAmount || 0))}</span>
                    </div>
                    {Number(detail.discountAmount || 0) > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Discount</span>
                        <span>−{formatCurrency(Number(detail.discountAmount))}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-base">
                      <span>Total</span>
                      <span className="text-primary">{formatCurrency(Number(detail.total))}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Paid</span>
                      <span>{formatCurrency(Number(detail.paidAmount))}</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span>Balance</span>
                      <span>{formatCurrency(balanceOf(detail))}</span>
                    </div>
                  </div>

                  {(detail.payments || []).length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Payments</p>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {detail.payments!.map((p) => (
                          <div
                            key={p.id}
                            className="flex justify-between text-xs rounded border border-border px-2 py-1"
                          >
                            <span>
                              {p.method.replace(/_/g, ' ')}
                              {p.reference ? ` · ${p.reference}` : ''}
                            </span>
                            <span className="tabular-nums font-medium">
                              {formatCurrency(Number(p.amount))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAutoPrint(true);
                        setPrintId(detail.id);
                      }}
                    >
                      <Printer className="h-3.5 w-3.5" /> Print
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setAutoPrint(false);
                        setPrintId(detail.id);
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5" /> PDF / Share
                    </Button>
                  </div>

                  {detail.paymentStatus !== 'PAID' &&
                    detail.paymentStatus !== 'VOID' &&
                    detail.status !== 'CANCELLED' && (
                      <div className="rounded-xl border border-border p-3 space-y-2 bg-muted/20">
                        <p className="text-sm font-medium">Record payment</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Amount"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                          />
                          <select
                            className="h-10 rounded-lg border border-input bg-background px-2 text-sm"
                            value={payMethod}
                            onChange={(e) =>
                              setPayMethod(e.target.value as typeof payMethod)
                            }
                          >
                            <option value="CASH">Cash</option>
                            <option value="CARD">Card</option>
                            <option value="MOBILE_MONEY">Mobile money</option>
                            <option value="BANK_TRANSFER">Bank transfer</option>
                          </select>
                        </div>
                        <Input
                          placeholder="Reference (optional)"
                          value={payRef}
                          onChange={(e) => setPayRef(e.target.value)}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" loading={pay.isPending} onClick={() => pay.mutate()}>
                            Pay
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setPayAmount(String(Math.round(balanceOf(detail) * 10000) / 10000))
                            }
                          >
                            Full balance
                          </Button>
                        </div>
                      </div>
                    )}

                  {detail.paymentStatus !== 'PAID' && detail.paymentStatus !== 'VOID' && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        loading={voidInv.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Void invoice ${detail.invoiceNo}? It will be marked cancelled.`
                            )
                          ) {
                            voidInv.mutate(detail.id);
                          }
                        }}
                      >
                        Void
                      </Button>
                      {Number(detail.paidAmount) <= 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={removeInv.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete invoice ${detail.invoiceNo}? This cannot be undone.`
                              )
                            ) {
                              removeInv.mutate(detail.id);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

// ═══════════════════ HOSPITAL ═══════════════════
export function HospitalPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', gender: 'UNKNOWN' });
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['patients'],
    queryFn: async () => (await api.get('/patients')).data,
  });
  const create = useMutation({
    mutationFn: async () => api.post('/patients', form),
    onSuccess: () => {
      toast.success('Patient registered');
      setForm({ firstName: '', lastName: '', phone: '', gender: 'UNKNOWN' });
      qc.invalidateQueries({ queryKey: ['patients'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <PageShell title="Hospital / Clinic" description="Patient registration & EMR access">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register patient</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-5">
          <Input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <Input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="UNKNOWN">Gender</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </select>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.firstName || !form.lastName}>
            Register
          </Button>
        </CardContent>
      </Card>
      <DataTable
        columns={['Patient #', 'Name', 'Phone', 'Type', 'Blood']}
        rows={(data?.data || []).map((p: { patientNo: string; firstName: string; lastName: string; phone?: string; type: string; bloodGroup?: string }) => [
          p.patientNo,
          `${p.firstName} ${p.lastName}`,
          p.phone || '—',
          <Badge key="t" variant="secondary">
            {p.type}
          </Badge>,
          p.bloodGroup || '—',
        ])}
      />
    </PageShell>
  );
}

export function PharmacyPage() {
  const { data } = useQuery({
    queryKey: ['drugs'],
    queryFn: async () => (await api.get('/products', { params: { type: 'DRUG', limit: 50 } })).data,
  });
  return (
    <PageShell title="Pharmacy" description="Drug inventory, Rx flags & expiry tracking">
      <DataTable
        columns={['Drug', 'SKU', 'Price', 'Stock', 'Rx']}
        rows={(data?.data || []).map((p: { name: string; sku: string; sellingPrice: number; stockQty?: number; requiresPrescription?: boolean }) => [
          p.name,
          p.sku,
          formatCurrency(Number(p.sellingPrice)),
          String(p.stockQty ?? 0),
          p.requiresPrescription ? (
            <Badge key="rx" variant="warning">
              Rx
            </Badge>
          ) : (
            '—'
          ),
        ])}
      />
    </PageShell>
  );
}

export function LaboratoryPage() {
  const { data } = useQuery({
    queryKey: ['lab-orders'],
    queryFn: async () => (await api.get('/lab-orders')).data,
  });
  return (
    <PageShell title="Laboratory" description="Test orders & results">
      <DataTable
        columns={['Order #', 'Patient', 'Status', 'Priority', 'Ordered']}
        rows={(data?.data || []).map(
          (o: { orderNo: string; status: string; priority: string; orderedAt: string; patient?: { firstName: string; lastName: string } }) => [
            o.orderNo,
            o.patient ? `${o.patient.firstName} ${o.patient.lastName}` : '—',
            <Badge key="s">{o.status}</Badge>,
            o.priority,
            formatDate(o.orderedAt),
          ]
        )}
      />
    </PageShell>
  );
}

export function AccountingPage() {
  const { data } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data,
  });
  const { data: profit } = useQuery({
    queryKey: ['profit-report'],
    queryFn: async () => (await api.get('/reports/profit')).data.data,
  });

  return (
    <PageShell title="Accounting" description="Chart of accounts & profit snapshot">
      {profit && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: 'Revenue', value: profit.revenue },
            { label: 'COGS', value: profit.cogs },
            { label: 'Gross Profit', value: profit.grossProfit },
            { label: 'Margin %', value: profit.grossMargin, isPct: true },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="pt-5">
                <p className="text-sm text-muted-foreground">{k.label}</p>
                <p className="text-xl font-bold tabular-nums">
                  {k.isPct ? `${Number(k.value).toFixed(1)}%` : formatCurrency(Number(k.value))}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <DataTable
        columns={['Code', 'Name', 'Type', 'Balance']}
        rows={(data?.data || []).map((a: { code: string; name: string; type: string; balance: number }) => [
          <span key="c" className="font-mono text-xs">
            {a.code}
          </span>,
          a.name,
          <Badge key="t" variant="outline">
            {a.type}
          </Badge>,
          formatCurrency(Number(a.balance)),
        ])}
      />
    </PageShell>
  );
}

export function HrPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ firstName: '', lastName: '', position: '', phone: '' });
  const { data } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => (await api.get('/employees')).data,
  });
  const create = useMutation({
    mutationFn: async () => api.post('/employees', form),
    onSuccess: () => {
      toast.success('Employee added');
      setForm({ firstName: '', lastName: '', position: '', phone: '' });
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <PageShell title="Human Resources" description="Employees, attendance & payroll-ready records">
      <Card>
        <CardContent className="pt-5 grid gap-3 sm:grid-cols-5">
          <Input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <Input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <Input placeholder="Position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
          <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Button loading={create.isPending} disabled={!form.firstName || !form.lastName} onClick={() => create.mutate()}>
            Add employee
          </Button>
        </CardContent>
      </Card>
      <DataTable
        columns={['Employee #', 'Name', 'Position', 'Status']}
        rows={(data?.data || []).map((e: { employeeNo: string; firstName: string; lastName: string; position?: string; status: string }) => [
          e.employeeNo,
          `${e.firstName} ${e.lastName}`,
          e.position || '—',
          <Badge key="s" variant={e.status === 'ACTIVE' ? 'success' : 'secondary'}>
            {e.status}
          </Badge>,
        ])}
      />
    </PageShell>
  );
}

// ═══════════════════ REPORTS ═══════════════════
export function ReportsPage() {
  const reports = [
    { name: 'Sales Report', desc: 'All sales with totals', excel: '/reports/sales.xlsx', csv: '/reports/sales.csv', view: '/reports/sales' },
    { name: 'Inventory Valuation', desc: 'Stock qty & value', excel: '/reports/inventory.xlsx', view: '/reports/inventory' },
    { name: 'Profit & Loss', desc: 'Revenue, COGS, margin', view: '/reports/profit' },
    { name: 'Customer Balances', desc: 'Outstanding AR', view: '/reports/customer-balances' },
  ];

  const [preview, setPreview] = useState<unknown>(null);
  const [previewTitle, setPreviewTitle] = useState('');

  const loadPreview = async (path: string, title: string) => {
    try {
      const res = await api.get(path);
      setPreview(res.data.data);
      setPreviewTitle(title);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  return (
    <PageShell title="Reports" description="Live reports — export Excel, CSV, or print">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {reports.map((r) => (
          <Card key={r.name} className="hover:border-primary/50 transition-colors">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{r.name}</CardTitle>
              <CardDescription>{r.desc}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => loadPreview(r.view, r.name)}>
                View
              </Button>
              {r.excel && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    downloadAuth(r.excel!, `${r.name.replace(/\s+/g, '-').toLowerCase()}.xlsx`)
                      .then(() => toast.success('Excel downloaded'))
                      .catch((e) => toast.error(getErrorMessage(e)))
                  }
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                </Button>
              )}
              {r.csv && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    downloadAuth(r.csv!, 'sales.csv')
                      .then(() => toast.success('CSV downloaded'))
                      .catch((e) => toast.error(getErrorMessage(e)))
                  }
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {preview != null && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">{previewTitle}</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="text-xs overflow-auto max-h-96 bg-muted/40 p-4 rounded-lg">
              {JSON.stringify(preview, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

// ═══════════════════ SETTINGS ═══════════════════
export function SettingsPage() {
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const authUser = useAuthStore((s) => s.user);
  const fontId = useThemeStore((s) => s.fontId);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const currentFontLabel = APP_FONTS.find((f) => f.id === fontId)?.label || 'Phone system font';
  const { data } = useQuery({
    queryKey: ['company'],
    queryFn: async () => (await api.get('/company')).data.data,
  });
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users')).data,
  });
  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data.data,
  });

  const confirmStaff = useMutation({
    mutationFn: async (id: string) => api.post(`/users/${id}/approve`),
    onSuccess: () => {
      toast.success('Staff confirmed — they can login now');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['staff-pending'] });
      qc.invalidateQueries({ queryKey: ['staff-pending-count'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const [profile, setProfile] = useState({ name: '', phone: '', email: '', address: '', currency: 'USD' });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [userForm, setUserForm] = useState({
    email: '',
    password: 'Cashier@123',
    firstName: '',
    lastName: '',
    roleCode: 'CASHIER',
  });
  const [branchForm, setBranchForm] = useState({ code: '', name: '' });
  const [addCurrencyCode, setAddCurrencyCode] = useState('EUR');

  const { data: currencyData, refetch: refetchCurrencies } = useQuery({
    queryKey: ['currencies'],
    queryFn: async () => (await api.get('/currencies')).data.data as {
      baseCurrency: string;
      currencies: Array<{
        code: string;
        name: string;
        symbol: string;
        exchangeRate: number;
        /** Units of this code per 1 base (ExchangeRate-API style) */
        marketRate?: number;
        isBase: boolean;
        isActive: boolean;
        lastSyncedAt?: string | null;
      }>;
      catalog: Array<{ code: string; name: string; symbol: string }>;
      liveSource?: string | null;
      liveDate?: string | null;
    },
  });

  useEffect(() => {
    if (data) {
      setProfile({
        name: data.name || '',
        phone: data.phone || '',
        email: data.email || '',
        address: data.address || '',
        currency: data.currency || 'USD',
      });
      setLogoPreview(getMediaUrl(data.logoUrl));
    }
  }, [data]);

  const saveCompany = useMutation({
    mutationFn: async () => api.put('/company', profile),
    onSuccess: (res) => {
      toast.success('Company profile saved');
      qc.invalidateQueries({ queryKey: ['company'] });
      qc.invalidateQueries({ queryKey: ['currencies'] });
      const c = res.data?.data;
      if (authUser && c) {
        setUser({
          ...authUser,
          company: {
            id: c.id,
            name: c.name,
            slug: c.slug,
            logoUrl: c.logoUrl,
            currency: c.currency,
          },
        });
      }
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('logo', file);
      return api.post('/company/logo', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (res) => {
      const c = res.data?.data;
      toast.success('Business logo updated');
      setLogoPreview(getMediaUrl(c?.logoUrl));
      qc.invalidateQueries({ queryKey: ['company'] });
      if (authUser && c) {
        setUser({
          ...authUser,
          company: {
            id: c.id,
            name: c.name,
            slug: c.slug,
            logoUrl: c.logoUrl,
            currency: c.currency,
          },
        });
      }
    },
    onError: (e) => toast.error(getErrorMessage(e) || 'Logo upload failed'),
  });

  const refreshFx = useMutation({
    mutationFn: async () => (await api.post('/currencies/refresh')).data.data,
    onSuccess: (d) => {
      toast.success(`Live rates updated${d?.liveSource ? ` · ${d.liveSource}` : ''}`);
      // Push into app-wide currency store so POS/top-bar convert immediately
      if (d?.baseCurrency && d?.currencies) {
        useCurrencyStore.getState().setFromApi({
          baseCurrency: d.baseCurrency,
          currencies: d.currencies,
          liveSource: d.liveSource,
        });
      }
      qc.invalidateQueries({ queryKey: ['currencies'] });
      void refetchCurrencies();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const addCurrency = useMutation({
    mutationFn: async () => api.post('/currencies', { code: addCurrencyCode }),
    onSuccess: () => {
      toast.success(`${addCurrencyCode} enabled with live rate`);
      qc.invalidateQueries({ queryKey: ['currencies'] });
      void refetchCurrencies();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const createUser = useMutation({
    mutationFn: async () => api.post('/users', userForm),
    onSuccess: (res) => {
      const pending = res.data?.data?.pendingApproval;
      toast.success(
        pending
          ? 'Staff added — pending approval (see Staff & Approvals)'
          : 'User created'
      );
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['staff-pending'] });
      qc.invalidateQueries({ queryKey: ['staff-pending-count'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const createBranch = useMutation({
    mutationFn: async () => api.post('/branches', branchForm),
    onSuccess: () => {
      toast.success('Branch created');
      qc.invalidateQueries({ queryKey: ['company'] });
      qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <PageShell
      title="Settings"
      description="Brand your business, manage team, currencies & preferences"
    >
      {/* Appearance — theme here; fonts open their own screen */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Theme and app font</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">Theme</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={theme === 'light' ? 'default' : 'outline'}
                onClick={() => setTheme('light')}
              >
                Light
              </Button>
              <Button
                size="sm"
                variant={theme === 'dark' ? 'default' : 'outline'}
                onClick={() => setTheme('dark')}
              >
                Dark
              </Button>
            </div>
          </div>

          <Link
            to="/app/settings/fonts"
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-3.5 hover:bg-muted/40 transition-colors min-h-[3.25rem]"
          >
            <div className="min-w-0 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Type className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Fonts</p>
                <p className="text-xs text-muted-foreground truncate">
                  Current: {currentFontLabel} · tap to choose
                </p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden lg:col-span-2 border-primary/15">
          <div className="h-24 md:h-28 bg-brand-gradient relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(255,255,255,0.2),transparent_50%)]" />
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-card to-transparent" />
          </div>
          <CardContent className="pt-0 -mt-12 relative space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4">
              <div className="relative group">
                <div className="brand-mark h-24 w-24 text-2xl ring-4 ring-card shadow-elevated">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Business logo" className="h-full w-full object-cover" />
                  ) : (
                    brandInitials(profile.name || data?.name)
                  )}
                </div>
                <button
                  type="button"
                  className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow hover:scale-105 transition-transform"
                  title="Upload business logo"
                  onClick={() => logoInputRef.current?.click()}
                >
                  <Camera className="h-4 w-4" />
                </button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 8 * 1024 * 1024) {
                      toast.error('Image must be under 8 MB');
                      return;
                    }
                    const local = URL.createObjectURL(file);
                    setLogoPreview(local);
                    uploadLogo.mutate(file);
                    e.target.value = '';
                  }}
                />
              </div>
              <div className="flex-1 min-w-0 pb-1">
                <p className="section-label mb-1">Business branding</p>
                <h2 className="text-xl font-bold font-display truncate">
                  {profile.name || data?.name || 'Your business'}
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Profile picture appears in the sidebar, top bar, and branded documents.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={uploadLogo.isPending}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    <ImagePlus className="h-4 w-4" />
                    {logoPreview ? 'Change logo' : 'Add logo'}
                  </Button>
                  <Badge variant="secondary" className="h-8 px-3">
                    {data?.status || '—'} · {data?.slug || 'workspace'}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Company profile
            </CardTitle>
            <CardDescription>Legal name, contact, and accounting base currency</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Business name</label>
              <Input
                placeholder="Company name"
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Email</label>
              <Input
                placeholder="Email"
                value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Phone</label>
              <Input
                placeholder="Phone"
                value={profile.phone}
                onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Address</label>
              <Input
                placeholder="Address"
                value={profile.address}
                onChange={(e) => setProfile({ ...profile, address: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Base currency (accounting)
              </label>
              <select
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                value={profile.currency}
                onChange={(e) => setProfile({ ...profile, currency: e.target.value })}
              >
                {(currencyData?.catalog || [{ code: 'USD', name: 'US Dollar' }]).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Changing base rebases FX rates across POS, invoices, and reports.
              </p>
            </div>
            <Button className="w-full sm:w-auto" loading={saveCompany.isPending} onClick={() => saveCompany.mutate()}>
              Save company profile
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Currencies & live FX rates</CardTitle>
              <CardDescription>
                Base: <strong>{currencyData?.baseCurrency || profile.currency}</strong>
                {currencyData?.liveSource ? (
                  <>
                    {' '}
                    · Source: <strong>{currencyData.liveSource}</strong>
                  </>
                ) : null}
                {currencyData?.liveDate ? (
                  <> · Feed date: {String(currencyData.liveDate).slice(0, 25)}</>
                ) : null}
                <br />
                Rates from ExchangeRate-API. Tap refresh if numbers look stuck at 1.
              </CardDescription>
            </div>
            <Button size="sm" loading={refreshFx.isPending} onClick={() => refreshFx.mutate()}>
              Refresh live rates
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[160px]">
                <label className="text-xs text-muted-foreground">Enable currency</label>
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={addCurrencyCode}
                  onChange={(e) => setAddCurrencyCode(e.target.value)}
                >
                  {(currencyData?.catalog || []).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button variant="secondary" loading={addCurrency.isPending} onClick={() => addCurrency.mutate()}>
                Add / update rate
              </Button>
            </div>
            <div className="table-scroll rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">Code</th>
                    <th className="p-2">Name</th>
                    <th className="p-2">Symbol</th>
                    <th className="p-2">Market rate (API)</th>
                    <th className="p-2">Synced</th>
                  </tr>
                </thead>
                <tbody>
                  {(currencyData?.currencies || []).map((c) => {
                    const base = currencyData?.baseCurrency || 'BASE';
                    const market =
                      typeof c.marketRate === 'number' && c.marketRate > 0
                        ? c.marketRate
                        : c.isBase
                          ? 1
                          : Number(c.exchangeRate) > 0
                            ? 1 / Number(c.exchangeRate)
                            : 0;
                    return (
                      <tr key={c.code} className="border-t border-border">
                        <td className="p-2 font-mono font-semibold">
                          {c.code}
                          {c.isBase ? (
                            <span className="ml-1 text-[10px] text-primary">BASE</span>
                          ) : null}
                        </td>
                        <td className="p-2">{c.name}</td>
                        <td className="p-2">{c.symbol}</td>
                        <td className="p-2 tabular-nums">
                          {c.isBase ? (
                            <span>1 {c.code} = 1 {base}</span>
                          ) : (
                            <span>
                              1 {base} ={' '}
                              {market >= 100
                                ? market.toLocaleString(undefined, { maximumFractionDigits: 2 })
                                : market.toLocaleString(undefined, { maximumFractionDigits: 6 })}{' '}
                              {c.code}
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add user (staff)</CardTitle>
            <CardDescription>
              Staff start as <strong>Pending approval</strong>. Approve them under{' '}
              <a href="/app/staff" className="text-primary underline">
                Staff & Approvals
              </a>{' '}
              before they can login.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="First name" value={userForm.firstName} onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })} />
              <Input placeholder="Last name" value={userForm.lastName} onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })} />
            </div>
            <Input placeholder="Password" type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
            <select
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              value={userForm.roleCode}
              onChange={(e) => setUserForm({ ...userForm, roleCode: e.target.value })}
            >
              {['CASHIER', 'STORE_MANAGER', 'WAREHOUSE_MANAGER', 'ACCOUNTANT', 'SALES_PERSON', 'PHARMACIST', 'DOCTOR', 'ADMINISTRATOR'].map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <Button loading={createUser.isPending} onClick={() => createUser.mutate()}>
              Create user
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Branches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.branches || []).map((b: { id: string; name: string; code: string; isHeadOffice: boolean }) => (
              <div key={b.id} className="flex justify-between text-sm">
                <span>
                  {b.name} <span className="text-muted-foreground">({b.code})</span>
                </span>
                {b.isHeadOffice && <Badge>HQ</Badge>}
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Input placeholder="Code" value={branchForm.code} onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })} />
              <Input placeholder="Name" value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} />
              <Button size="sm" loading={createBranch.isPending} onClick={() => createBranch.mutate()}>
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team members</CardTitle>
            <CardDescription>
              Pending staff need a <strong>Confirm Staff</strong> click before they can login.{' '}
              <Link to="/app/staff" className="text-primary underline">
                Open Staff & Approvals
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 max-h-80 overflow-y-auto">
            {(users?.data || []).map(
              (u: {
                id: string;
                email: string;
                firstName: string;
                lastName: string;
                status: string;
                roles: Array<{ name: string }>;
              }) => (
                <div
                  key={u.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm border-b border-border/40 pb-3 ${
                    u.status === 'PENDING_VERIFICATION' ? 'bg-warning/5 -mx-1 px-2 rounded-lg pt-2' : ''
                  }`}
                >
                  <div>
                    <p className="font-medium">
                      {u.firstName} {u.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{u.roles?.[0]?.name}</p>
                  </div>
                  <div className="flex flex-col sm:items-end gap-2">
                    <Badge
                      variant={
                        u.status === 'ACTIVE'
                          ? 'success'
                          : u.status === 'PENDING_VERIFICATION'
                            ? 'warning'
                            : 'secondary'
                      }
                    >
                      {u.status === 'PENDING_VERIFICATION' ? 'PENDING APPROVAL' : u.status}
                    </Badge>
                    {u.status === 'PENDING_VERIFICATION' && (
                      <Button
                        size="sm"
                        variant="success"
                        className="font-semibold"
                        loading={confirmStaff.isPending}
                        onClick={() => confirmStaff.mutate(u.id)}
                      >
                        <UserCheck className="h-4 w-4" /> Confirm Staff
                      </Button>
                    )}
                  </div>
                </div>
              )
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Notifications <RefreshCw className="h-3.5 w-3.5" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(notifications || []).map((n: { id: string; title: string; body: string; createdAt: string; status: string }) => (
              <div key={n.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{n.title}</p>
                <p className="text-muted-foreground">{n.body}</p>
                <p className="text-xs text-muted-foreground mt-1">{formatDate(n.createdAt)}</p>
              </div>
            ))}
            {!notifications?.length && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Package className="h-4 w-4" /> No notifications yet
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
