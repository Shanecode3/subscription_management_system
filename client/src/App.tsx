import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute, PublicOnlyRoute } from './components/layout/ProtectedRoute';
import { RoleRoute } from './components/layout/RoleRoute';
import { BillingDayView } from './pages/BillingDayView';
import { DashboardPage } from './pages/DashboardPage';
import { DiscountsPage } from './pages/DiscountsPage';
import { InvoiceDetailView } from './pages/InvoiceDetailView';
import { InvoicesPage } from './pages/InvoicesPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlansPage } from './pages/PlansPage';
import { PortalPage } from './pages/PortalPage';
import { PrintInvoiceView } from './pages/PrintInvoiceView';
import { ProductsPage } from './pages/ProductsPage';
import { SubscriptionDetailPage } from './pages/SubscriptionDetailPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { TaxRulesPage } from './pages/TaxRulesPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { LoginPage } from './pages/auth/LoginPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { SignupPage } from './pages/auth/SignupPage';

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicOnlyRoute>
            <SignupPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicOnlyRoute>
            <ForgotPasswordPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/reset-password"
        element={
          <PublicOnlyRoute>
            <ResetPasswordPage />
          </PublicOnlyRoute>
        }
      />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/products"
        element={
          <ProtectedRoute>
            <ProductsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/plans"
        element={
          <ProtectedRoute>
            <PlansPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/templates"
        element={
          <ProtectedRoute>
            <RoleRoute roles={['ADMIN', 'STAFF']}>
              <TemplatesPage />
            </RoleRoute>
          </ProtectedRoute>
        }
      />

      <Route
        path="/subscriptions"
        element={
          <ProtectedRoute>
            <RoleRoute roles={['ADMIN', 'STAFF']}>
              <SubscriptionsPage />
            </RoleRoute>
          </ProtectedRoute>
        }
      />

      <Route
        path="/subscriptions/:id"
        element={
          <ProtectedRoute>
            <RoleRoute roles={['ADMIN', 'STAFF']}>
              <SubscriptionDetailPage />
            </RoleRoute>
          </ProtectedRoute>
        }
      />

      <Route
        path="/portal"
        element={
          <ProtectedRoute>
            <RoleRoute roles={['CUSTOMER']}>
              <PortalPage />
            </RoleRoute>
          </ProtectedRoute>
        }
      />

      <Route
        path="/billing"
        element={
          <ProtectedRoute>
            <RoleRoute roles={['ADMIN', 'STAFF']}>
              <BillingDayView />
            </RoleRoute>
          </ProtectedRoute>
        }
      />

      {/* Every role may read the ledger; the API narrows a customer to its own rows. */}
      <Route
        path="/invoices"
        element={
          <ProtectedRoute>
            <InvoicesPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/invoices/:id"
        element={
          <ProtectedRoute>
            <InvoiceDetailView />
          </ProtectedRoute>
        }
      />

      {/* Printing records a staff action, so the printable sheet stays internal. */}
      <Route
        path="/invoices/:id/print"
        element={
          <ProtectedRoute>
            <RoleRoute roles={['ADMIN', 'STAFF']}>
              <PrintInvoiceView />
            </RoleRoute>
          </ProtectedRoute>
        }
      />

      <Route
        path="/discounts"
        element={
          <ProtectedRoute>
            <RoleRoute roles={['ADMIN', 'STAFF']}>
              <DiscountsPage />
            </RoleRoute>
          </ProtectedRoute>
        }
      />

      <Route
        path="/tax-rules"
        element={
          <ProtectedRoute>
            <RoleRoute roles={['ADMIN', 'STAFF']}>
              <TaxRulesPage />
            </RoleRoute>
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
