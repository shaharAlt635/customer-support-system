import { PERMISSIONS } from '@support-desk/shared';
import type { ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';
import { GuestOnly, RequireAuth, RequirePermission } from './auth/guards';
import { CompanyRoot } from './company/CompanyRoot';
import { AppLayout } from './components/layout/AppLayout';
import { RouteError } from './components/RouteError';

/** Code-split each page; the router keeps the previous page visible while a chunk loads. */
const page = (load: () => Promise<{ default: ComponentType }>) => async () => ({
  Component: (await load()).default,
});

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      // --- Platform pages ---------------------------------------------------
      { path: '/', lazy: page(() => import('./pages/HomePage')) },
      { path: '/signup', lazy: page(() => import('./pages/CreateCompanyPage')) },
      { path: '/find', lazy: page(() => import('./pages/FindCompanyPage')) },
      { path: '/verify-email', lazy: page(() => import('./pages/VerifyEmailPage')) },
      { path: '/reset-password', lazy: page(() => import('./pages/ResetPasswordPage')) },
      {
        path: '/confirm-request',
        lazy: async () => ({
          Component: (await import('./pages/EmailLinkPages')).ConfirmRequestPage,
        }),
      },
      {
        path: '/sign-in-link',
        lazy: async () => ({ Component: (await import('./pages/EmailLinkPages')).SignInLinkPage }),
      },
      { path: '/dev/mailbox', lazy: page(() => import('./pages/DevMailboxPage')) },

      // --- A company's help desk: /:slug/... ------------------------------
      {
        path: '/:slug',
        element: <CompanyRoot />,
        children: [
          { index: true, lazy: page(() => import('./pages/PortalPage')) },
          {
            element: <GuestOnly />,
            children: [
              { path: 'login', lazy: page(() => import('./pages/LoginPage')) },
              { path: 'register', lazy: page(() => import('./pages/RegisterPage')) },
              { path: 'forgot-password', lazy: page(() => import('./pages/ForgotPasswordPage')) },
            ],
          },
          {
            element: <RequireAuth />,
            children: [
              {
                element: <AppLayout />,
                children: [
                  { path: 'dashboard', lazy: page(() => import('./pages/DashboardPage')) },
                  { path: 'tickets', lazy: page(() => import('./pages/TicketsPage')) },
                  { path: 'tickets/new', lazy: page(() => import('./pages/NewTicketPage')) },
                  { path: 'tickets/:id', lazy: page(() => import('./pages/TicketDetailPage')) },
                  { path: 'profile', lazy: page(() => import('./pages/ProfilePage')) },
                  { path: 'invitations', lazy: page(() => import('./pages/InvitationsPage')) },
                  {
                    element: <RequirePermission anyOf={[PERMISSIONS.CUSTOMERS_MANAGE]} />,
                    children: [
                      { path: 'customers', lazy: page(() => import('./pages/CustomersPage')) },
                    ],
                  },
                  {
                    element: (
                      <RequirePermission
                        anyOf={[PERMISSIONS.TEAM_INVITE, PERMISSIONS.TEAM_MANAGE]}
                      />
                    ),
                    children: [
                      { path: 'settings/team', lazy: page(() => import('./pages/TeamPage')) },
                    ],
                  },
                  {
                    element: <RequirePermission anyOf={[PERMISSIONS.GROUPS_MANAGE]} />,
                    children: [
                      { path: 'settings/groups', lazy: page(() => import('./pages/GroupsPage')) },
                    ],
                  },
                  {
                    element: <RequirePermission anyOf={[PERMISSIONS.CATEGORIES_MANAGE]} />,
                    children: [
                      {
                        path: 'settings/categories',
                        lazy: page(() => import('./pages/CategoriesPage')),
                      },
                    ],
                  },
                  {
                    element: <RequirePermission anyOf={[PERMISSIONS.COMPANY_SETTINGS]} />,
                    children: [
                      {
                        path: 'settings/company',
                        lazy: page(() => import('./pages/CompanySettingsPage')),
                      },
                    ],
                  },
                  { path: '*', lazy: page(() => import('./pages/NotFoundPage')) },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', lazy: page(() => import('./pages/NotFoundPage')) },
    ],
  },
]);
