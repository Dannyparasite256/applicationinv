import { useEffect, useCallback } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useCurrencyStore, type AppCurrency } from '@/stores/currencyStore';
import { useNetworkStore } from '@/stores/networkStore';
import {
  detectCurrencyFromDevice,
  detectCurrencyFromLocation,
  requestLocationCurrency,
} from '@/lib/localeCurrency';
import { refreshMoneyViews } from '@/lib/refreshApp';

type CurrencyApi = {
  baseCurrency: string;
  currencies: AppCurrency[];
  liveSource?: string;
  liveDate?: string;
};

/** Ensure company has this currency enabled so the top-bar selector can use it. */
async function ensureCurrencyEnabled(code: string, qc: QueryClient) {
  const list = useCurrencyStore.getState().currencies;
  const has = list.some((c) => c.code.toUpperCase() === code.toUpperCase() && c.isActive !== false);
  if (has) return;
  try {
    await api.post('/currencies', { code: code.toUpperCase() });
    await qc.invalidateQueries({ queryKey: ['currencies'], refetchType: 'active' });
  } catch {
    /* may lack settings.company permission — ignore */
  }
}

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

  /**
   * Detect local currency:
   * 1) device timezone/locale (instant)
   * 2) GPS (permission) → reverse geocode — most accurate
   * 3) IP country fallback
   *
   * Does not override a currency the user picked manually in the top bar.
   */
  useEffect(() => {
    let cancelled = false;

    const apply = async (currency: string, source: string) => {
      if (cancelled || !currency) return;
      setLocationCurrency(currency);
      // Never lock from auto-detect — only top-bar manual pick locks
      applyLocationDefault(currency, { lock: false });
      if (token && companyId) {
        await ensureCurrencyEnabled(currency, qc);
      }
      // Soft log for debugging; no toast spam on every launch
      if (import.meta.env.DEV) {
        console.info(`[currency] location default ${currency} via ${source}`);
      }
    };

    const device = detectCurrencyFromDevice();
    void apply(device.currency, device.source);

    void (async () => {
      // Small delay so the app shell paints before the permission dialog
      await new Promise((r) => setTimeout(r, 600));
      if (cancelled) return;

      const loc = await detectCurrencyFromLocation();
      if (cancelled) return;
      await apply(loc.currency, loc.source);

      // After GPS/IP, remount money views if display currency changed
      const display = useCurrencyStore.getState().displayCurrency;
      if (display?.toUpperCase() === loc.currency.toUpperCase()) {
        void refreshMoneyViews(qc);
      }
    })();

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
    await qc.invalidateQueries({ queryKey: ['currencies'], refetchType: 'active' });
    await refreshMoneyViews(qc);
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
      await qc.invalidateQueries({ queryKey: ['currencies'], refetchType: 'active' });
      await qc.invalidateQueries({ queryKey: ['company'], refetchType: 'active' });
      await refreshMoneyViews(qc);
      toast.success(`Base currency is now ${data.baseCurrency} — rates rebased`);
      return data;
    },
    [qc, setFromApi]
  );

  /** Prompt for GPS and switch display currency to the local one. */
  const useMyLocation = useCallback(async () => {
    const loc = await requestLocationCurrency();
    if (!loc.currency) {
      toast.error('Could not determine your location');
      return loc;
    }

    setLocationCurrency(loc.currency);
    // Manual “use my location” should apply even if a previous auto choice was locked
    useCurrencyStore.getState().setDisplayCurrency(loc.currency, { lock: true });
    if (token && companyId) {
      await ensureCurrencyEnabled(loc.currency, qc);
    }
    await refreshMoneyViews(qc);

    const via =
      loc.source === 'gps'
        ? 'GPS'
        : loc.source === 'ip' || loc.source === 'ip-fallback'
          ? 'network location'
          : 'device settings';
    toast.success(`Display currency set to ${loc.currency}`, {
      description: loc.place ? `${loc.place} · ${via}` : `Detected via ${via}`,
    });
    return loc;
  }, [token, companyId, setLocationCurrency, qc]);

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
    useMyLocation,
  };
}
