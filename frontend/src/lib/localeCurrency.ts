/**
 * Guess a default ISO currency from the user's device location.
 * Uses timezone → country, browser locale region, then optional IP lookup.
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

/** IANA timezone prefix / exact → country code */
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
  // Soft region fallbacks (only when city not listed above)
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
  // e.g. en-UG, en-GB, fr-FR, en_US
  const parts = locale.replace('_', '-').split('-');
  if (parts.length >= 2) {
    const region = parts[parts.length - 1].toUpperCase();
    if (/^[A-Z]{2}$/.test(region)) return region;
  }
  return null;
}

function currencyFromCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = country.toUpperCase();
  // EUR pseudo-country from Europe/* fallback
  if (c === 'EUR') return 'EUR';
  return COUNTRY_CURRENCY[c] || null;
}

/** Sync guess from device only (no network). */
export function detectCurrencyFromDevice(): { currency: string; country: string | null; source: string } {
  try {
    const tz =
      (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || '';
    const locale =
      (typeof navigator !== 'undefined' &&
        (navigator.language || navigator.languages?.[0])) ||
      'en-US';

    const fromTz = countryFromTimezone(tz);
    // Europe/* maps to EUR as "country" sentinel
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
  /** City / locality when reverse-geocoded */
  place?: string | null;
};

/** Reverse-geocode lat/lon → country + currency (free client API, no key). */
export async function currencyFromCoordinates(
  latitude: number,
  longitude: number
): Promise<LocationCurrencyResult | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${encodeURIComponent(String(latitude))}` +
      `&longitude=${encodeURIComponent(String(longitude))}` +
      `&localityLanguage=en`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      countryCode?: string;
      countryName?: string;
      city?: string;
      locality?: string;
      principalSubdivision?: string;
    };
    const country = data.countryCode?.toUpperCase() || null;
    const currency = currencyFromCountry(country);
    if (!currency) return null;
    const place =
      [data.city || data.locality, data.principalSubdivision, data.countryName]
        .filter(Boolean)
        .join(', ') || null;
    return { currency, country, source: 'gps', place };
  } catch {
    return null;
  }
}

/**
 * Request device GPS (browser or Capacitor) and map to local currency.
 * Triggers the OS / browser location permission prompt when needed.
 */
export async function detectCurrencyFromGps(opts?: {
  /** Force permission prompt even if already denied once this session */
  forcePrompt?: boolean;
}): Promise<LocationCurrencyResult | null> {
  let latitude: number | null = null;
  let longitude: number | null = null;

  // Prefer Capacitor Geolocation on Android/iOS (proper permission flow)
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation');
      const current = await Geolocation.checkPermissions();
      let status = current.location;
      if (status !== 'granted') {
        const req = await Geolocation.requestPermissions();
        status = req.location;
      }
      if (status !== 'granted') {
        return null;
      }
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 15_000,
        maximumAge: 120_000,
      });
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    }
  } catch {
    /* fall through to browser API */
  }

  // Web (and native fallback): W3C Geolocation
  if (latitude == null || longitude == null) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return null;
    }
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 15_000,
          maximumAge: 120_000,
        });
      });
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    } catch {
      // Permission denied / unavailable — caller may fall back to IP
      if (opts?.forcePrompt) {
        /* already prompted via getCurrentPosition */
      }
      return null;
    }
  }

  if (latitude == null || longitude == null) return null;
  return currencyFromCoordinates(latitude, longitude);
}

/** Free IP → country currency (no GPS permission required). */
export async function detectCurrencyFromIp(): Promise<LocationCurrencyResult | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('https://ipwho.is/', { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      success?: boolean;
      country_code?: string;
      currency?: { code?: string } | string;
      city?: string;
      country?: string;
    };
    if (data?.success === false) return null;

    const country = data.country_code?.toUpperCase() || null;
    let currency: string | null = null;
    if (typeof data.currency === 'string') currency = data.currency.toUpperCase();
    else if (data.currency && typeof data.currency === 'object' && data.currency.code) {
      currency = data.currency.code.toUpperCase();
    }
    if (!currency) currency = currencyFromCountry(country);
    if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;

    const place = [data.city, data.country].filter(Boolean).join(', ') || null;
    return { currency, country, source: 'ip', place };
  } catch {
    return null;
  }
}

/**
 * Full location pipeline for display currency:
 * 1) GPS (permission) → reverse geocode
 * 2) IP geolocation
 * 3) Device timezone / locale
 */
export async function detectCurrencyFromLocation(opts?: {
  /** Skip GPS (e.g. offline or user declined) */
  skipGps?: boolean;
}): Promise<LocationCurrencyResult> {
  const device = detectCurrencyFromDevice();

  if (!opts?.skipGps) {
    const gps = await detectCurrencyFromGps();
    if (gps?.currency) return gps;
  }

  const ip = await detectCurrencyFromIp();
  if (ip?.currency) return ip;

  return {
    currency: device.currency,
    country: device.country,
    source: device.source,
  };
}

/**
 * Manual “use my location” — always tries GPS first and surfaces errors to the UI.
 */
export async function requestLocationCurrency(): Promise<LocationCurrencyResult> {
  const gps = await detectCurrencyFromGps({ forcePrompt: true });
  if (gps?.currency) return gps;

  const ip = await detectCurrencyFromIp();
  if (ip?.currency) {
    return { ...ip, source: 'ip-fallback' };
  }

  const device = detectCurrencyFromDevice();
  return {
    currency: device.currency,
    country: device.country,
    source: device.source,
  };
}
