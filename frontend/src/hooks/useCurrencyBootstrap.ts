import { useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useCurrencyStore, type AppCurrency } from '@/stores/currencyStore';
import { useNetworkStore } from '@/stores/networkStore';

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
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['currencies', companyId],
    queryFn: async () => {
      const res = await api.get<{ data: CurrencyApi }>('/currencies');
      return res.data.data;
    },
    enabled: !!token && !!companyId,
    staleTime: 30_000,
    refetchInterval: online ? 5 * 60_000 : false, // soft refresh every 5 min
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

  // Align display with company currency on first login if never set
  useEffect(() => {
    const userCur = useAuthStore.getState().user?.company?.currency;
    const { displayCurrency, baseCurrency, setDisplayCurrency } = useCurrencyStore.getState();
    if (userCur && displayCurrency === 'USD' && baseCurrency === 'USD' && userCur !== 'USD') {
      // only nudge if still defaults
      setDisplayCurrency(userCur);
    }
  }, [token]);

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

  // Auto refresh rates when coming online
  useEffect(() => {
    if (online && token && companyId) {
      void api
        .post('/currencies/refresh')
        .then((res) => {
          const data = res.data.data as CurrencyApi;
          setFromApi({
            baseCurrency: data.baseCurrency,
            currencies: data.currencies,
            liveSource: data.liveSource,
          });
        })
        .catch(() => {
          /* keep cached rates */
        });
    }
  }, [online, token, companyId, setFromApi]);

  return {
    ...query,
    refreshRates,
    setBase,
  };
}
