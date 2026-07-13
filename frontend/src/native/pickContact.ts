import { Capacitor } from '@capacitor/core';
import { Contacts } from '@capacitor-community/contacts';

export type PickedContact = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  displayName: string;
};

function cleanPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  // Keep digits, +, and leading country-code style; strip spaces/dashes/parens
  return raw.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
}

function splitDisplayName(display: string): { firstName: string; lastName: string } {
  const parts = display.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function mapPayload(contact: {
  name?: {
    display?: string | null;
    given?: string | null;
    family?: string | null;
  };
  phones?: Array<{ number?: string | null; isPrimary?: boolean | null }>;
  emails?: Array<{ address?: string | null; isPrimary?: boolean | null }>;
}): PickedContact | null {
  const phones = contact.phones || [];
  const primaryPhone =
    phones.find((p) => p.isPrimary && p.number)?.number ||
    phones.find((p) => p.number)?.number ||
    '';
  const emails = contact.emails || [];
  const primaryEmail =
    emails.find((e) => e.isPrimary && e.address)?.address ||
    emails.find((e) => e.address)?.address ||
    '';

  let firstName = (contact.name?.given || '').trim();
  let lastName = (contact.name?.family || '').trim();
  const display = (contact.name?.display || '').trim();

  if (!firstName && !lastName && display) {
    const split = splitDisplayName(display);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  const phone = cleanPhone(primaryPhone);
  const email = primaryEmail.trim();

  if (!firstName && !lastName && !phone && !email) return null;

  return {
    firstName,
    lastName,
    phone,
    email,
    displayName: display || [firstName, lastName].filter(Boolean).join(' '),
  };
}

/**
 * Open the device contact picker (Android/iOS) and return name/phone/email.
 * On web, uses the Contact Picker API when available; otherwise returns null.
 */
export async function pickDeviceContact(): Promise<PickedContact | null> {
  if (Capacitor.isNativePlatform()) {
    return pickNative();
  }
  return pickWeb();
}

export function canPickDeviceContact(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  // Chromium Contact Picker API (desktop Chrome / some Android WebViews)
  return typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window;
}

async function pickNative(): Promise<PickedContact | null> {
  try {
    let perm = await Contacts.checkPermissions();
    if (perm.contacts !== 'granted' && perm.contacts !== 'limited') {
      perm = await Contacts.requestPermissions();
    }
    if (perm.contacts !== 'granted' && perm.contacts !== 'limited') {
      throw new Error(
        'Contacts permission is required. Enable Contacts for Enterprise IMS in phone Settings.'
      );
    }

    const { contact } = await Contacts.pickContact({
      projection: {
        name: true,
        phones: true,
        emails: true,
      },
    });

    if (!contact) return null;
    return mapPayload(contact);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    if (
      lower.includes('cancel') ||
      lower.includes('user') ||
      lower.includes('dismiss') ||
      lower.includes('activity') ||
      lower.includes('no contact')
    ) {
      return null;
    }
    if (lower.includes('permission')) throw e instanceof Error ? e : new Error(msg);
    throw new Error(msg || 'Could not open contacts');
  }
}

/** Web Contact Picker API (Chrome). Not available in all browsers. */
async function pickWeb(): Promise<PickedContact | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (!nav.contacts?.select) {
      throw new Error('Contact picker is only available in the mobile app.');
    }
    const results = await nav.contacts.select(['name', 'tel', 'email'], { multiple: false });
    const row = results?.[0];
    if (!row) return null;

    const nameArr: string[] = row.name || [];
    const telArr: string[] = row.tel || [];
    const emailArr: string[] = row.email || [];
    const display = nameArr[0] || '';
    const split = splitDisplayName(display);

    return mapPayload({
      name: { display, given: split.firstName, family: split.lastName },
      phones: telArr.map((number: string, i: number) => ({
        number,
        isPrimary: i === 0,
      })),
      emails: emailArr.map((address: string, i: number) => ({
        address,
        isPrimary: i === 0,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    if (lower.includes('cancel') || lower.includes('abort')) return null;
    throw e instanceof Error ? e : new Error(msg);
  }
}
