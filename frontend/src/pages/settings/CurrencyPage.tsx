import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Coins, RefreshCw } from 'lucide-react';
import { api, getErrorMessage } from '@/lib/api';
import { useCurrencyStore } from '@/stores/currencyStore';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

type CurrencyRow = {
  code: string;
  name: string;
  symbol: string;
  exchangeRate: number;
  marketRate?: number;
  isBase: boolean;
  isActive: boolean;
  lastSyncedAt?: string | null;
};

type CurrencyApi = {
  baseCurrency: string;
  currencies: CurrencyRow[];
  catalog: Array<{ code: string; name: string; symbol: string }>;
  liveSource?: string | null;
  liveDate?: string | null;
};

export function CurrencyPage() {
  const qc = useQueryClient();
  const [addCurrencyCode, setAddCurrencyCode] = useState('EUR');

  const { data: currencyData, refetch, isFetching } = useQuery({
    queryKey: ['currencies'],
    queryFn: async () => (await api.get('/currencies')).data.data as CurrencyApi,
  });

  const refreshFx = useMutation({
    mutationFn: async () => (await api.post('/currencies/refresh')).data.data as CurrencyApi,
    onSuccess: (d) => {
      toast.success(`Live rates updated${d?.liveSource ? ` · ${d.liveSource}` : ''}`);
      if (d?.baseCurrency && d?.currencies) {
        useCurrencyStore.getState().setFromApi({
          baseCurrency: d.baseCurrency,
          currencies: d.currencies,
          liveSource: d.liveSource,
        });
      }
      void qc.invalidateQueries({ queryKey: ['currencies'] });
      void refetch();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const addCurrency = useMutation({
    mutationFn: async () => api.post('/currencies', { code: addCurrencyCode }),
    onSuccess: () => {
      toast.success(`${addCurrencyCode} enabled with live rate`);
      void qc.invalidateQueries({ queryKey: ['currencies'] });
      void refetch();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const base = currencyData?.baseCurrency || 'USD';

  return (
    <div className="page-container fit-x pb-6 space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to="/app/settings"
          aria-label="Back to Settings"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold truncate">Currency & FX rates</h1>
          <p className="text-xs sm:text-sm text-muted-foreground truncate">
            Base: <strong>{base}</strong>
            {currencyData?.liveSource ? <> · {currencyData.liveSource}</> : null}
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0"
          loading={refreshFx.isPending || isFetching}
          onClick={() => refreshFx.mutate()}
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="h-4 w-4 text-primary" />
            Live exchange rates
          </CardTitle>
          <CardDescription>
            {currencyData?.liveDate
              ? `Feed: ${String(currencyData.liveDate).slice(0, 28)}`
              : 'Rates from ExchangeRate-API. Refresh if values look stuck.'}
            <br />
            Display currency is chosen from the top bar (converts amounts app-wide).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[10rem]">
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
                  <th className="p-2.5">Code</th>
                  <th className="p-2.5">Name</th>
                  <th className="p-2.5">Symbol</th>
                  <th className="p-2.5">Market rate</th>
                  <th className="p-2.5">Synced</th>
                </tr>
              </thead>
              <tbody>
                {(currencyData?.currencies || []).map((c) => {
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
                      <td className="p-2.5 font-mono font-semibold">
                        {c.code}
                        {c.isBase ? (
                          <span className="ml-1 text-[10px] text-primary">BASE</span>
                        ) : null}
                      </td>
                      <td className="p-2.5">{c.name}</td>
                      <td className="p-2.5">{c.symbol}</td>
                      <td className="p-2.5 tabular-nums">
                        {c.isBase ? (
                          <span>
                            1 {c.code} = 1 {base}
                          </span>
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
                      <td className="p-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  );
                })}
                {!currencyData?.currencies?.length && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                      No currencies yet. Tap Refresh to pull live rates.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
