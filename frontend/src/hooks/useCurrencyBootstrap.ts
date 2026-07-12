import { useEffect, useCallback, useRef } from 'react';
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

/** Enable currency on the company so rates exist for conversion. */
async function ensureCurrencyEnabled(
  code: string,
  qc: QueryClient
): Promise<CurrencyApi | null> {
  const upper = code.toUpperCase();
  const list = useCurrencyStore.getState().currencies;
  const has = list.some((c) => c.code.toUpperCase() === upper && c.isActive !== false);

  try {
    if (!has) {
      await api.post('/currencies', { code: upper });
    }
    // Always re-fetch so exchange rates are present for the new code
    const res = await api.get<{ data: CurrencyApi }>('/currencies');
    const data = res.data.data;
    useCurrencyStore.getState().setFromApi({
      baseCurrency: data.baseCurrency,
      currencies: data.currencies,
      liveSource: data.liveSource,
    });
    await qc.invalidateQueries({ queryKey: ['currencies'], refetchType: 'active' });
    return data;
  } catch {
    /* staff may lack permission — display code can still change client-side */
    return null;
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
  const locationRunId = useRef(0);

  const query = useQuery({
    queryKey: ['currencies', companyId],
    queryFn: async () => {
      const res = await api.get<{ data: CurrencyApi }>('/currencies');
      return res.data.data;
    },
    enabled: !!token && !!companyId,
    staleTime: 60_000,
    refetchInterval: online ? 15 * 60_000 : false,
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
   * Detect local currency and force it into the UI:
   * 1) device timezone (instant)
   * 2) GPS (permission) → reverse geocode
   * 3) IP country
   * Then enable that currency on the company and re-apply rates.
   */
  useEffect(() => {
    let cancelled = false;
    const runId = ++locationRunId.current;

    const applyDetected = async (currency: string, source: string, force: boolean) => {
      if (cancelled || runId !== locationRunId.current || !currency) return;

      setLocationCurrency(currency);
      applyLocationDefault(currency, { force });

      if (token && companyId) {
        await ensureCurrencyEnabled(currency, qc);
        if (cancelled || runId !== locationRunId.current) return;
        // Re-apply after rates load (setFromApi may have briefly preferred base)
        applyLocationDefault(currency, { force });
      }

      await refreshMoneyViews(qc);

      if (import.meta.env.DEV) {
        console.info(
          `[currency] applied ${currency} via ${source} (display=${useCurrencyStore.getState().displayCurrency})`
        );
      }
    };

    // Instant device guess (timezone is often enough for Uganda / Africa / etc.)
    const device = detectCurrencyFromDevice();
    void applyDetected(device.currency, device.source, false);

    void (async () => {
      // Let the shell paint, then request GPS (shows permission dialog)
      await new Promise((r) => setTimeout(r, 800));
      if (cancelled || runId !== locationRunId.current) return;

      const loc = await detectCurrencyFromLocation();
      if (cancelled || runId !== locationRunId.current) return;

      // GPS / IP should win over a stale locked USD from older app versions
      const force =
        loc.source === 'gps' ||
        loc.source === 'ip' ||
        loc.source === 'ip-fallback' ||
        useCurrencyStore.getState().displayCurrencySource !== 'user';

      await applyDetected(loc.currency, loc.source, force);
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
    // Keep location display if not user-picked
    const loc = useCurrencyStore.getState().locationCurrency;
    if (loc && useCurrencyStore.getState().displayCurrencySource !== 'user') {
      applyLocationDefault(loc, { force: true });
    }
    await qc.invalidateQueries({ queryKey: ['currencies'], refetchType: 'active' });
    await refreshMoneyViews(qc);
    toast.success(`Rates updated${data.liveSource ? ` · ${data.liveSource}` : ''}`);
    return data;
  }, [qc, setFromApi, applyLocationDefault]);

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

  /** Prompt for GPS and switch display currency to the local one (always force). */
  const useMyLocation = useCallback(async () => {
    toast.message('Detecting location…', { description: 'Allow location if prompted' });
    const loc = await requestLocationCurrency();
    if (!loc.currency) {
      toast.error('Could not determine your location');
      return loc;
    }

    setLocationCurrency(loc.currency);
    applyLocationDefault(loc.currency, { force: true });

    if (token && companyId) {
      await ensureCurrencyEnabled(loc.currency, qc);
      applyLocationDefault(loc.currency, { force: true });
    }

    // Final hard set so top bar + amounts update immediately
    useCurrencyStore.setState({
      displayCurrency: loc.currency.toUpperCase(),
      displayCurrencySource: 'location',
      displayCurrencyLocked: false,
      locationCurrency: loc.currency.toUpperCase(),
      uiRevision: useCurrencyStore.getState().uiRevision + 1,
    });

    await refreshMoneyViews(qc);

    const via =
      loc.source === 'gps'
        ? 'GPS'
        : loc.source === 'ip' || loc.source === 'ip-fallback'
          ? 'network location'
          : 'device settings';
    toast.success(`Currency set to ${loc.currency}`, {
      description: loc.place ? `${loc.place} · ${via}` : `Detected via ${via}`,
    });
    return loc;
  }, [token, companyId, setLocationCurrency, applyLocationDefault, qc]);

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
        const loc = useCurrencyStore.getState().locationCurrency;
        if (loc && useCurrencyStore.getState().displayCurrencySource !== 'user') {
          applyLocationDefault(loc, { force: true });
        }
        void qc.invalidateQueries({ queryKey: ['currencies'] });
      })
      .catch(() => {
        /* keep cached rates */
      });
    return () => {
      cancelled = true;
    };
  }, [online, token, companyId, setFromApi, applyLocationDefault, qc]);

  return {
    ...query,
    refreshRates,
    setBase,
    useMyLocation,
  };
}
