/**
 * Guess / detect ISO currency from device location.
 * Pipeline: GPS (permission) → reverse geocode → IP → timezone / locale.
 */

/** Country ISO-3166-1 alpha-2 → currency ISO-4217 */
const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD',
  CA: 'CAD',
  MX: 'MXN',
  BR: 'BRL',
  AR: 'ARS',
  CL: 'CLP',
  CO: 'COP',
  PE: 'PEN',
  GB: 'GBP',
  IE: 'EUR',
  FR: 'EUR',
  DE: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  PT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  LU: 'EUR',
  MT: 'EUR',
  CY: 'EUR',
  SK: 'EUR',
  SI: 'EUR',
  EE: 'EUR',
  LV: 'EUR',
  LT: 'EUR',
  HR: 'EUR',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  BG: 'BGN',
  TR: 'TRY',
  RU: 'RUB',
  UA: 'UAH',
  UG: 'UGX',
  KE: 'KES',
  TZ: 'TZS',
  RW: 'RWF',
  BI: 'BIF',
  SS: 'SSP',
  ET: 'ETB',
  SO: 'SOS',
  DJ: 'DJF',
  ER: 'ERN',
  SD: 'SDG',
  NG: 'NGN',
  GH: 'GHS',
  ZA: 'ZAR',
  ZM: 'ZMW',
  ZW: 'ZWL',
  BW: 'BWP',
  MW: 'MWK',
  MZ: 'MZN',
  AO: 'AOA',
  NA: 'NAD',
  SN: 'XOF',
  CI: 'XOF',
  ML: 'XOF',
  BF: 'XOF',
  NE: 'XOF',
  TG: 'XOF',
  BJ: 'XOF',
  CM: 'XAF',
  CF: 'XAF',
  TD: 'XAF',
  CG: 'XAF',
  GA: 'XAF',
  GQ: 'XAF',
  EG: 'EGP',
  MA: 'MAD',
  DZ: 'DZD',
  TN: 'TND',
  LY: 'LYD',
  AE: 'AED',
  SA: 'SAR',
  QA: 'QAR',
  KW: 'KWD',
  BH: 'BHD',
  OM: 'OMR',
  IL: 'ILS',
  JO: 'JOD',
  LB: 'LBP',
  IN: 'INR',
  PK: 'PKR',
  BD: 'BDT',
  LK: 'LKR',
  NP: 'NPR',
  CN: 'CNY',
  JP: 'JPY',
  KR: 'KRW',
  HK: 'HKD',
  TW: 'TWD',
  SG: 'SGD',
  MY: 'MYR',
  TH: 'THB',
  ID: 'IDR',
  PH: 'PHP',
  VN: 'VND',
  AU: 'AUD',
  NZ: 'NZD',
  FJ: 'FJD',
};

/** IANA timezone → country code */
const TZ_COUNTRY: Array<[RegExp | string, string]> = [
  [/^Africa\/Kampala$/i, 'UG'],
  [/^Africa\/Nairobi$/i, 'KE'],
  [/^Africa\/Dar_es_Salaam$/i, 'TZ'],
  [/^Africa\/Kigali$/i, 'RW'],
  [/^Africa\/Lagos$/i, 'NG'],
  [/^Africa\/Accra$/i, 'GH'],
  [/^Africa\/Johannesburg$/i, 'ZA'],
  [/^Africa\/Cairo$/i, 'EG'],
  [/^Africa\/Casablanca$/i, 'MA'],
  [/^Africa\/Addis_Ababa$/i, 'ET'],
  [/^Africa\/Khartoum$/i, 'SD'],
  [/^Africa\/Juba$/i, 'SS'],
  [/^Africa\/Mogadishu$/i, 'SO'],
  [/^Africa\/Lusaka$/i, 'ZM'],
  [/^Africa\/Harare$/i, 'ZW'],
  [/^Africa\/Windhoek$/i, 'NA'],
  [/^Africa\/Gaborone$/i, 'BW'],
  [/^Africa\/Blantyre$/i, 'MW'],
  [/^Africa\/Maputo$/i, 'MZ'],
  [/^Africa\/Luanda$/i, 'AO'],
  [/^Africa\/Abidjan$/i, 'CI'],
  [/^Africa\/Dakar$/i, 'SN'],
  [/^Africa\/Douala$/i, 'CM'],
  [/^Africa\/Tunis$/i, 'TN'],
  [/^Africa\/Algiers$/i, 'DZ'],
  [/^Europe\/London$/i, 'GB'],
  [/^Europe\/Dublin$/i, 'IE'],
  [/^Europe\/Paris$/i, 'FR'],
  [/^Europe\/Berlin$/i, 'DE'],
  [/^Europe\/Madrid$/i, 'ES'],
  [/^Europe\/Rome$/i, 'IT'],
  [/^Europe\/Amsterdam$/i, 'NL'],
  [/^Europe\/Brussels$/i, 'BE'],
  [/^Europe\/Zurich$/i, 'CH'],
  [/^Europe\/Stockholm$/i, 'SE'],
  [/^Europe\/Oslo$/i, 'NO'],
  [/^Europe\/Copenhagen$/i, 'DK'],
  [/^Europe\/Warsaw$/i, 'PL'],
  [/^Europe\/Istanbul$/i, 'TR'],
  [/^Europe\/Moscow$/i, 'RU'],
  [/^Europe\/Kyiv$/i, 'UA'],
  [/^America\/New_York$/i, 'US'],
  [/^America\/Chicago$/i, 'US'],
  [/^America\/Denver$/i, 'US'],
  [/^America\/Los_Angeles$/i, 'US'],
  [/^America\/Phoenix$/i, 'US'],
  [/^America\/Toronto$/i, 'CA'],
  [/^America\/Vancouver$/i, 'CA'],
  [/^America\/Mexico_City$/i, 'MX'],
  [/^America\/Sao_Paulo$/i, 'BR'],
  [/^America\/Buenos_Aires$/i, 'AR'],
  [/^America\/Bogota$/i, 'CO'],
  [/^America\/Lima$/i, 'PE'],
  [/^America\/Santiago$/i, 'CL'],
  [/^Asia\/Dubai$/i, 'AE'],
  [/^Asia\/Riyadh$/i, 'SA'],
  [/^Asia\/Qatar$/i, 'QA'],
  [/^Asia\/Kuwait$/i, 'KW'],
  [/^Asia\/Bahrain$/i, 'BH'],
  [/^Asia\/Muscat$/i, 'OM'],
  [/^Asia\/Jerusalem$/i, 'IL'],
  [/^Asia\/Kolkata$/i, 'IN'],
  [/^Asia\/Karachi$/i, 'PK'],
  [/^Asia\/Dhaka$/i, 'BD'],
  [/^Asia\/Colombo$/i, 'LK'],
  [/^Asia\/Shanghai$/i, 'CN'],
  [/^Asia\/Hong_Kong$/i, 'HK'],
  [/^Asia\/Tokyo$/i, 'JP'],
  [/^Asia\/Seoul$/i, 'KR'],
  [/^Asia\/Singapore$/i, 'SG'],
  [/^Asia\/Kuala_Lumpur$/i, 'MY'],
  [/^Asia\/Bangkok$/i, 'TH'],
  [/^Asia\/Jakarta$/i, 'ID'],
  [/^Asia\/Manila$/i, 'PH'],
  [/^Asia\/Ho_Chi_Minh$/i, 'VN'],
  [/^Australia\/Sydney$/i, 'AU'],
  [/^Australia\/Melbourne$/i, 'AU'],
  [/^Australia\/Perth$/i, 'AU'],
  [/^Pacific\/Auckland$/i, 'NZ'],
  [/^Europe\//i, 'EUR'],
  [/^America\//i, 'US'],
  [/^Australia\//i, 'AU'],
];

function countryFromTimezone(tz: string): string | null {
  for (const [key, country] of TZ_COUNTRY) {
    if (typeof key === 'string') {
      if (key.toLowerCase() === tz.toLowerCase()) return country;
    } else if (key.test(tz)) {
      return country;
    }
  }
  return null;
}

function countryFromLocale(locale: string): string | null {
  const parts = locale.replace('_', '-').split('-');
  if (parts.length >= 2) {
    const region = parts[parts.length - 1].toUpperCase();
    if (/^[A-Z]{2}$/.test(region)) return region;
  }
  return null;
}

export function currencyFromCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = country.toUpperCase();
  if (c === 'EUR') return 'EUR';
  return COUNTRY_CURRENCY[c] || null;
}

/** Sync guess from device only (no network). */
export function detectCurrencyFromDevice(): {
  currency: string;
  country: string | null;
  source: string;
} {
  try {
    const tz =
      (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || '';
    const locale =
      (typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) ||
      'en-US';

    const fromTz = countryFromTimezone(tz);
    if (fromTz === 'EUR') {
      return { currency: 'EUR', country: null, source: `timezone:${tz}` };
    }
    const curTz = currencyFromCountry(fromTz);
    if (curTz) return { currency: curTz, country: fromTz, source: `timezone:${tz}` };

    const fromLoc = countryFromLocale(locale);
    const curLoc = currencyFromCountry(fromLoc);
    if (curLoc) return { currency: curLoc, country: fromLoc, source: `locale:${locale}` };
  } catch {
    /* ignore */
  }
  return { currency: 'USD', country: null, source: 'default' };
}

export type LocationCurrencyResult = {
  currency: string;
  country: string | null;
  source: string;
  place?: string | null;
  latitude?: number;
  longitude?: number;
};

async function fetchJson(url: string, ms = 8000): Promise<unknown | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, {
      signal: ctrl.signal,
      // Avoid CapacitorHttp quirks with some free geo APIs
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Reverse-geocode lat/lon → country + currency (several free providers). */
export async function currencyFromCoordinates(
  latitude: number,
  longitude: number
): Promise<LocationCurrencyResult | null> {
  // 1) BigDataCloud (no key)
  {
    const data = (await fetchJson(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
    )) as {
      countryCode?: string;
      countryName?: string;
      city?: string;
      locality?: string;
      principalSubdivision?: string;
    } | null;
    if (data?.countryCode) {
      const country = data.countryCode.toUpperCase();
      const currency = currencyFromCountry(country);
      if (currency) {
        const place =
          [data.city || data.locality, data.principalSubdivision, data.countryName]
            .filter(Boolean)
            .join(', ') || null;
        return { currency, country, source: 'gps', place, latitude, longitude };
      }
    }
  }

  // 2) OpenStreetMap Nominatim
  {
    const data = (await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`,
      10_000
    )) as {
      address?: { country_code?: string; country?: string; city?: string; town?: string; state?: string };
    } | null;
    const cc = data?.address?.country_code?.toUpperCase();
    if (cc) {
      const currency = currencyFromCountry(cc);
      if (currency) {
        const place =
          [data?.address?.city || data?.address?.town, data?.address?.state, data?.address?.country]
            .filter(Boolean)
            .join(', ') || null;
        return { currency, country: cc, source: 'gps', place, latitude, longitude };
      }
    }
  }

  // 3) geocode.maps.co (no key for light use)
  {
    const data = (await fetchJson(
      `https://geocode.maps.co/reverse?lat=${latitude}&lon=${longitude}`
    )) as {
      address?: { country_code?: string; country?: string; city?: string; town?: string };
    } | null;
    const cc = data?.address?.country_code?.toUpperCase();
    if (cc) {
      const currency = currencyFromCountry(cc);
      if (currency) {
        return {
          currency,
          country: cc,
          source: 'gps',
          place: [data?.address?.city || data?.address?.town, data?.address?.country]
            .filter(Boolean)
            .join(', '),
          latitude,
          longitude,
        };
      }
    }
  }

  return null;
}

async function getGpsCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
  // Capacitor native
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation');
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        perm = await Geolocation.requestPermissions();
      }
      const ok =
        perm.location === 'granted' ||
        perm.coarseLocation === 'granted' ||
        // some Android builds only return `location`
        (perm as { location?: string }).location === 'granted';
      if (!ok && perm.location !== 'granted') {
        // Still try getCurrentPosition — some devices grant at OS level without plugin state
      }
      try {
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 20_000,
          maximumAge: 60_000,
        });
        return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      } catch {
        // try low accuracy
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 20_000,
          maximumAge: 300_000,
        });
        return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      }
    }
  } catch {
    /* browser fallback */
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;

  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20_000,
        maximumAge: 60_000,
      });
    });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 20_000,
          maximumAge: 300_000,
        });
      });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch {
      return null;
    }
  }
}

/**
 * Request device GPS and map to local currency.
 */
export async function detectCurrencyFromGps(): Promise<LocationCurrencyResult | null> {
  const coords = await getGpsCoordinates();
  if (!coords) return null;
  const mapped = await currencyFromCoordinates(coords.latitude, coords.longitude);
  if (mapped) return mapped;
  // GPS worked but reverse geocode failed — still return coords for debugging
  return null;
}

/** Free IP → country currency. Tries several providers. */
export async function detectCurrencyFromIp(): Promise<LocationCurrencyResult | null> {
  // ipwho.is
  {
    const data = (await fetchJson('https://ipwho.is/', 5000)) as {
      success?: boolean;
      country_code?: string;
      currency?: { code?: string } | string;
      city?: string;
      country?: string;
    } | null;
    if (data && data.success !== false) {
      const country = data.country_code?.toUpperCase() || null;
      let currency: string | null = null;
      if (typeof data.currency === 'string') currency = data.currency.toUpperCase();
      else if (data.currency && typeof data.currency === 'object' && data.currency.code) {
        currency = data.currency.code.toUpperCase();
      }
      if (!currency) currency = currencyFromCountry(country);
      if (currency && /^[A-Z]{3}$/.test(currency)) {
        return {
          currency,
          country,
          source: 'ip',
          place: [data.city, data.country].filter(Boolean).join(', ') || null,
        };
      }
    }
  }

  // ipapi.co
  {
    const data = (await fetchJson('https://ipapi.co/json/', 5000)) as {
      country_code?: string;
      currency?: string;
      city?: string;
      country_name?: string;
      error?: boolean;
    } | null;
    if (data && !data.error && data.country_code) {
      const country = data.country_code.toUpperCase();
      const currency = (data.currency || currencyFromCountry(country) || '').toUpperCase();
      if (/^[A-Z]{3}$/.test(currency)) {
        return {
          currency,
          country,
          source: 'ip',
          place: [data.city, data.country_name].filter(Boolean).join(', ') || null,
        };
      }
    }
  }

  // ip-api.com (HTTP — may fail on HTTPS pages; try anyway on native)
  {
    const data = (await fetchJson('https://ipapi.co/json/', 4000)) as null;
    void data;
  }

  return null;
}

/**
 * Full pipeline: GPS → IP → device.
 */
export async function detectCurrencyFromLocation(opts?: {
  skipGps?: boolean;
}): Promise<LocationCurrencyResult> {
  const device = detectCurrencyFromDevice();

  if (!opts?.skipGps) {
    try {
      const gps = await detectCurrencyFromGps();
      if (gps?.currency) return gps;
    } catch {
      /* continue */
    }
  }

  try {
    const ip = await detectCurrencyFromIp();
    if (ip?.currency) return ip;
  } catch {
    /* continue */
  }

  return {
    currency: device.currency,
    country: device.country,
    source: device.source,
  };
}

/**
 * Manual “use my location” — always tries GPS first.
 */
export async function requestLocationCurrency(): Promise<LocationCurrencyResult> {
  try {
    const gps = await detectCurrencyFromGps();
    if (gps?.currency) return gps;
  } catch {
    /* continue */
  }

  try {
    const ip = await detectCurrencyFromIp();
    if (ip?.currency) return { ...ip, source: 'ip-fallback' };
  } catch {
    /* continue */
  }

  const device = detectCurrencyFromDevice();
  return {
    currency: device.currency,
    country: device.country,
    source: device.source,
  };
}
