import { useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useCurrencyStore, type AppCurrency } from '@/stores/currencyStore';
import { useNetworkStore } from '@/stores/networkStore';
import { detectCurrencyFromDevice, detectCurrencyFromLocation } from '@/lib/localeCurrency';

type CurrencyApi = {
  baseCurrency: string;
  currencies: AppCurrency[];
  liveSource?: string;
  liveDate?: string;
};

export function useCurrencyBootstrap() {
  const token = useAuthStore((s) => s.accessToken);
  const companyId = useAuthStore((s) => s.user?.companyId);
  const online = useNetworkStore((s) => s.online);
  const setFromApi = useCurrencyStore((s) => s.setFromApi);
  const applyLocationDefault = useCurrencyStore((s) => s.applyLocationDefault);
  const setLocationCurrency = useCurrencyStore((s) => s.setLocationCurrency);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['currencies', companyId],
    queryFn: async () => {
      // GET auto-refreshes stale rates on the server via ExchangeRate-API
      const res = await api.get<{ data: CurrencyApi }>('/currencies');
      return res.data.data;
    },
    enabled: !!token && !!companyId,
    staleTime: 60_000,
    refetchInterval: online ? 15 * 60_000 : false, // re-check every 15 min
  });

  useEffect(() => {
    if (query.data) {
      setFromApi({
        baseCurrency: query.data.baseCurrency,
        currencies: query.data.currencies,
        liveSource: query.data.liveSource,
      });
    }
  }, [query.data, setFromApi]);

  // Detect local currency from timezone / locale / IP and apply as display default
  useEffect(() => {
    let cancelled = false;
    const device = detectCurrencyFromDevice();
    if (!cancelled) {
      setLocationCurrency(device.currency);
      applyLocationDefault(device.currency, { lock: false });
    }

    void detectCurrencyFromLocation().then(async (loc) => {
      if (cancelled) return;
      setLocationCurrency(loc.currency);
      // Refine with IP country; lock so later refetches don't flip the top bar
      applyLocationDefault(loc.currency, { lock: true });

      // Ensure company has this currency enabled so top-bar can show it
      if (token && companyId && loc.currency) {
        const list = useCurrencyStore.getState().currencies;
        const has = list.some((c) => c.code.toUpperCase() === loc.currency.toUpperCase());
        if (!has) {
          try {
            await api.post('/currencies', { code: loc.currency });
            await qc.invalidateQueries({ queryKey: ['currencies'] });
          } catch {
            /* may lack settings.company permission — ignore */
          }
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token, companyId, setLocationCurrency, applyLocationDefault, qc]);

  const refreshRates = useCallback(async () => {
    const res = await api.post<{ data: CurrencyApi }>('/currencies/refresh');
    const data = res.data.data;
    setFromApi({
      baseCurrency: data.baseCurrency,
      currencies: data.currencies,
      liveSource: data.liveSource,
    });
    await qc.invalidateQueries({ queryKey: ['currencies'] });
    toast.success(`Rates updated${data.liveSource ? ` · ${data.liveSource}` : ''}`);
    return data;
  }, [qc, setFromApi]);

  const setBase = useCallback(
    async (code: string) => {
      const res = await api.put<{ data: CurrencyApi }>('/currencies/base', { code });
      const data = res.data.data;
      setFromApi({
        baseCurrency: data.baseCurrency,
        currencies: data.currencies,
        liveSource: data.liveSource,
      });
      useCurrencyStore.getState().setBaseCurrency(data.baseCurrency);
      useCurrencyStore.getState().setDisplayCurrency(data.baseCurrency);
      // keep auth company currency in sync
      const user = useAuthStore.getState().user;
      if (user?.company) {
        useAuthStore.getState().setUser({
          ...user,
          company: { ...user.company, currency: data.baseCurrency },
        });
      }
      await qc.invalidateQueries({ queryKey: ['currencies'] });
      await qc.invalidateQueries({ queryKey: ['company'] });
      toast.success(`Base currency is now ${data.baseCurrency} — rates rebased`);
      return data;
    },
    [qc, setFromApi]
  );

  // Force a live ExchangeRate-API pull when session comes online
  useEffect(() => {
    if (!online || !token || !companyId) return;
    let cancelled = false;
    void api
      .post('/currencies/refresh')
      .then((res) => {
        if (cancelled) return;
        const data = res.data.data as CurrencyApi;
        setFromApi({
          baseCurrency: data.baseCurrency,
          currencies: data.currencies,
          liveSource: data.liveSource,
        });
        void qc.invalidateQueries({ queryKey: ['currencies'] });
      })
      .catch(() => {
        /* keep cached rates — GET list may still auto-refresh if stale */
      });
    return () => {
      cancelled = true;
    };
  }, [online, token, companyId, setFromApi, qc]);

  return {
    ...query,
    refreshRates,
    setBase,
  };
}
