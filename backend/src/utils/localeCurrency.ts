/**
 * Resolve a default company currency from request locale / geo headers.
 */

const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD',
  CA: 'CAD',
  MX: 'MXN',
  BR: 'BRL',
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
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  TR: 'TRY',
  UG: 'UGX',
  KE: 'KES',
  TZ: 'TZS',
  RW: 'RWF',
  NG: 'NGN',
  GH: 'GHS',
  ZA: 'ZAR',
  EG: 'EGP',
  MA: 'MAD',
  AE: 'AED',
  SA: 'SAR',
  IN: 'INR',
  PK: 'PKR',
  BD: 'BDT',
  CN: 'CNY',
  JP: 'JPY',
  KR: 'KRW',
  HK: 'HKD',
  SG: 'SGD',
  MY: 'MYR',
  TH: 'THB',
  ID: 'IDR',
  PH: 'PHP',
  VN: 'VND',
  AU: 'AUD',
  NZ: 'NZD',
};

export function currencyFromCountryCode(country?: string | null): string | null {
  if (!country) return null;
  const c = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  return COUNTRY_CURRENCY[c] || null;
}

/** Parse Accept-Language e.g. en-UG,en;q=0.9 → UG */
export function countryFromAcceptLanguage(header?: string | null): string | null {
  if (!header) return null;
  const first = header.split(',')[0]?.trim() || '';
  const parts = first.replace('_', '-').split('-');
  if (parts.length >= 2) {
    const region = parts[parts.length - 1].toUpperCase();
    if (/^[A-Z]{2}$/.test(region)) return region;
  }
  return null;
}

/**
 * Prefer explicit currency body field, then CDN/geo headers, then Accept-Language.
 */
export function resolveDefaultCurrency(input: {
  currency?: string | null;
  country?: string | null;
  acceptLanguage?: string | null;
  cfCountry?: string | null;
  vercelCountry?: string | null;
}): string {
  const explicit = (input.currency || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(explicit)) return explicit;

  const fromCountry =
    currencyFromCountryCode(input.country) ||
    currencyFromCountryCode(input.cfCountry) ||
    currencyFromCountryCode(input.vercelCountry) ||
    currencyFromCountryCode(countryFromAcceptLanguage(input.acceptLanguage));

  return fromCountry || 'USD';
}
