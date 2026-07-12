import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { ProductsPage } from '@/pages/inventory/ProductsPage';
import { PosPage } from '@/pages/pos/PosPage';
import {
  SalesPage,
  CustomersPage,
  SuppliersPage,
  PurchasesPage,
  InventoryPage,
  HospitalPage,
  PharmacyPage,
  LaboratoryPage,
  AccountingPage,
  HrPage,
  InvoicesPage,
  ReportsPage,
} from '@/pages/ModulePages';
import { SettingsHubPage } from '@/pages/settings/SettingsHubPage';
import { FontsPage } from '@/pages/settings/FontsPage';
import { ProfilePage } from '@/pages/settings/ProfilePage';
import { CurrencyPage } from '@/pages/settings/CurrencyPage';
import { AddStaffPage } from '@/pages/settings/AddStaffPage';
import { PlatformAdminPage } from '@/pages/admin/PlatformAdminPage';
import { PlatformBusinessesPage } from '@/pages/admin/PlatformBusinessesPage';
import { PlatformBusinessDetailPage } from '@/pages/admin/PlatformBusinessDetailPage';
import { StaffPage } from '@/pages/admin/StaffPage';
import { SyncCenterPage } from '@/pages/SyncCenterPage';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { useAuthStore } from '@/stores/authStore';
import { canAccessPath, getDefaultHome } from '@/lib/roleAccess';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Extra retries help when the free cloud API is cold-starting
      retry: (failureCount, error) => {
        if (failureCount >= 3) return false;
        const msg = error instanceof Error ? error.message.toLowerCase() : '';
        if (msg.includes('wake') || msg.includes('cannot reach') || msg.includes('timed out') || msg.includes('timeout')) {
          return true;
        }
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 15_000),
      // Keep open screens fresh after edits / focus without a full app reload
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
      staleTime: 10_000,
    },
    mutations: {
      // Failures surface via toast in each page; no global retry spam
      retry: 0,
    },
  },
});

function PublicOnly({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  // Only redirect away from login if we have a real session
  if (token && user?.id) {
    return <Navigate to={getDefaultHome(user.roles || [])} replace />;
  }
  return <>{children}</>;
}

function RoleGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const roles = user?.roles || [];
  const permissions = user?.permissions || [];
  const allowed = canAccessPath(location.pathname, roles, permissions);
  if (!allowed) {
    return <Navigate to={getDefaultHome(roles)} replace />;
  }
  return <>{children}</>;
}

function Guard({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <RoleGuard>{children}</RoleGuard>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route
              path="/login"
              element={
                <PublicOnly>
                  <LoginPage />
                </PublicOnly>
              }
            />
            <Route
              path="/register"
              element={
                <PublicOnly>
                  <RegisterPage />
                </PublicOnly>
              }
            />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Guard><DashboardPage /></Guard>} />
              <Route path="platform" element={<Guard><PlatformAdminPage /></Guard>} />
              <Route path="platform/businesses" element={<Guard><PlatformBusinessesPage /></Guard>} />
              <Route path="platform/businesses/:id" element={<Guard><PlatformBusinessDetailPage /></Guard>} />
              <Route path="staff" element={<Guard><StaffPage /></Guard>} />
              <Route path="pos" element={<Guard><PosPage /></Guard>} />
              <Route path="products" element={<Guard><ProductsPage /></Guard>} />
              <Route path="inventory" element={<Guard><InventoryPage /></Guard>} />
              <Route path="sales" element={<Guard><SalesPage /></Guard>} />
              <Route path="purchases" element={<Guard><PurchasesPage /></Guard>} />
              <Route path="customers" element={<Guard><CustomersPage /></Guard>} />
              <Route path="suppliers" element={<Guard><SuppliersPage /></Guard>} />
              <Route path="invoices" element={<Guard><InvoicesPage /></Guard>} />
              <Route path="accounting" element={<Guard><AccountingPage /></Guard>} />
              <Route path="hospital" element={<Guard><HospitalPage /></Guard>} />
              <Route path="pharmacy" element={<Guard><PharmacyPage /></Guard>} />
              <Route path="laboratory" element={<Guard><LaboratoryPage /></Guard>} />
              <Route path="hr" element={<Guard><HrPage /></Guard>} />
              <Route path="reports" element={<Guard><ReportsPage /></Guard>} />
              <Route path="settings" element={<Guard><SettingsHubPage /></Guard>} />
              <Route path="settings/fonts" element={<Guard><FontsPage /></Guard>} />
              <Route path="settings/profile" element={<Guard><ProfilePage /></Guard>} />
              <Route path="settings/currency" element={<Guard><CurrencyPage /></Guard>} />
              <Route path="settings/staff" element={<Guard><AddStaffPage /></Guard>} />
              <Route path="sync" element={<Guard><SyncCenterPage /></Guard>} />
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
