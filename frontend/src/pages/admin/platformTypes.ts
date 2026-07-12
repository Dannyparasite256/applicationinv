export type CredentialUser = {
  id: string;
  email: string;
  loginEmail?: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  status: string;
  lastLoginAt?: string | null;
  roles: Array<{ code: string; name: string }>;
  knownPassword?: string | null;
  passwordSetAt?: string | null;
  hasKnownPassword?: boolean;
  note?: string;
};

export type OwnerInfo = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  status: string;
  lastLoginAt?: string | null;
  role: string;
};

export type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  address?: string | null;
  status: string;
  currency?: string;
  createdAt: string;
  trialEndsAt?: string | null;
  _count: {
    users: number;
    products: number;
    sales: number;
    customers: number;
    branches: number;
  };
  primaryOwner?: OwnerInfo | null;
  owners?: OwnerInfo[];
  metrics: {
    revenue30d: number;
    sales30d: number;
    lastActivityAt?: string;
  };
};

export const statusVariant = (
  s: string
): 'success' | 'warning' | 'destructive' | 'secondary' | 'default' => {
  if (s === 'ACTIVE') return 'success';
  if (s === 'TRIAL') return 'warning';
  if (s === 'SUSPENDED' || s === 'CANCELLED') return 'destructive';
  return 'secondary';
};
