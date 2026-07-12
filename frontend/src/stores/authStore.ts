import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  companyId: string | null;
  branchId: string | null;
  roles: string[];
  permissions: string[];
  avatarUrl?: string | null;
  twoFactorEnabled?: boolean;
  company?: { id: string; name: string; slug: string; logoUrl?: string | null; currency?: string };
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: AuthUser) => void;
  logout: () => void;
  hasPermission: (code: string) => boolean;
  hasRole: (...roles: string[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setUser: (user) => set({ user }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
      hasPermission: (code) => {
        const user = get().user;
        if (!user) return false;
        if (user.roles?.includes('SUPER_ADMIN') || user.roles?.includes('COMPANY_OWNER') || user.roles?.includes('ADMINISTRATOR')) {
          return true;
        }
        return user.permissions?.includes(code) || user.permissions?.includes('*');
      },
      hasRole: (...roles) => {
        const user = get().user;
        if (!user) return false;
        return roles.some((r) => user.roles?.includes(r));
      },
    }),
    {
      name: 'eims-auth',
      // Keep tokens + user profile offline, but do not persist huge data-URL logos
      // (they reload from the API via /auth/me on every session).
      partialize: (state) => {
        const user = state.user
          ? {
              ...state.user,
              company: state.user.company
                ? {
                    ...state.user.company,
                    // Drop data: logos from localStorage (can exceed quota); paths stay fine
                    logoUrl:
                      state.user.company.logoUrl &&
                      state.user.company.logoUrl.startsWith('data:')
                        ? null
                        : state.user.company.logoUrl,
                  }
                : undefined,
            }
          : null;
        return {
          user,
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
        };
      },
    }
  )
);
