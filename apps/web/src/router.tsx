import { PERMISSIONS } from '@support-desk/shared';
import type { ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';
import { GuestOnly, RequireAuth, RequirePermission } from './auth/guards';
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
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', lazy: page(() => import('./pages/LoginPage')) },
          { path: '/register', lazy: page(() => import('./pages/RegisterPage')) },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, lazy: page(() => import('./pages/DashboardPage')) },
              { path: 'tickets', lazy: page(() => import('./pages/TicketsPage')) },
              { path: 'tickets/new', lazy: page(() => import('./pages/NewTicketPage')) },
              { path: 'tickets/:id', lazy: page(() => import('./pages/TicketDetailPage')) },
              { path: 'profile', lazy: page(() => import('./pages/ProfilePage')) },
              {
                element: <RequirePermission permission={PERMISSIONS.USER_MANAGE} />,
                children: [{ path: 'admin/users', lazy: page(() => import('./pages/UsersPage')) }],
              },
              {
                element: <RequirePermission permission={PERMISSIONS.CATEGORY_MANAGE} />,
                children: [
                  { path: 'admin/categories', lazy: page(() => import('./pages/CategoriesPage')) },
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
