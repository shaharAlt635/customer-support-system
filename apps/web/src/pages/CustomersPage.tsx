import type { UserDTO } from '@support-desk/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, UserCheck, UserX, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { getErrorMessage } from '../api/client';
import { customersApi } from '../api/endpoints';
import { useCustomers } from '../api/queries';
import { useCompanyPath } from '../company/company-context';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Select } from '../components/ui/Input';
import { ConfirmDialog } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { Pagination } from '../components/ui/Pagination';
import { SectionSpinner } from '../components/ui/Spinner';
import { EmptyState, ErrorState } from '../components/ui/States';
import { formatDate, formatRelative } from '../lib/format';
import { useDebouncedValue, useDocumentTitle } from '../lib/hooks';

export default function CustomersPage() {
  useDocumentTitle('Customers');
  const companyPath = useCompanyPath();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | ''>('');
  const [page, setPage] = useState(1);
  const [toggling, setToggling] = useState<UserDTO | null>(null);
  const q = useDebouncedValue(search.trim(), 300);

  const { data, isPending, isError, error, refetch } = useCustomers({
    q: q || undefined,
    status: status || undefined,
    page,
    pageSize: 20,
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      customersApi.setActive(id, isActive),
    onSuccess: (customer) => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`${customer.name} was ${customer.isActive ? 'reactivated' : 'deactivated'}`);
      setToggling(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone with a customer account at your company."
      />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search by name or email…"
              aria-label="Search customers"
              className="pl-9"
            />
          </div>
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as 'active' | 'inactive' | '');
              setPage(1);
            }}
            className="sm:w-40"
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </Select>
        </div>

        {isPending ? (
          <SectionSpinner />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No customers found"
            description="Customers appear here once they create an account on your company page."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Customer
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                      Last sign-in
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">
                      Joined
                    </th>
                    <th scope="col" className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.data.map((customer) => (
                    <tr key={customer.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={customer.name} />
                          <div className="min-w-0">
                            <Link
                              to={companyPath(`/tickets?q=${encodeURIComponent(customer.email)}`)}
                              className="block truncate font-medium text-slate-900 hover:text-brand-700"
                            >
                              {customer.name}
                            </Link>
                            <p className="truncate text-xs text-slate-500">{customer.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {!customer.isActive ? (
                          <Badge tone="red">Deactivated</Badge>
                        ) : !customer.hasPassword ? (
                          <Badge tone="blue">Guest · email sign-in</Badge>
                        ) : !customer.emailVerified ? (
                          <Badge tone="amber">Unconfirmed email</Badge>
                        ) : (
                          <Badge tone="green">Active</Badge>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
                        {customer.lastLoginAt ? formatRelative(customer.lastLoginAt) : 'Never'}
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-slate-500 lg:table-cell">
                        {formatDate(customer.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setToggling(customer)}>
                          {customer.isActive ? (
                            <>
                              <UserX className="size-4 text-red-600" /> Deactivate
                            </>
                          ) : (
                            <>
                              <UserCheck className="size-4 text-emerald-600" /> Reactivate
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination meta={data.meta} noun="customers" onPageChange={setPage} />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(toggling)}
        onClose={() => setToggling(null)}
        title={`${toggling?.isActive ? 'Deactivate' : 'Reactivate'} ${toggling?.name}?`}
        description={
          toggling?.isActive
            ? 'They will be signed out and can no longer sign in. Their tickets are kept.'
            : 'They will be able to sign in again.'
        }
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Reactivate'}
        tone={toggling?.isActive ? 'danger' : 'primary'}
        loading={setActive.isPending}
        onConfirm={() =>
          toggling && setActive.mutate({ id: toggling.id, isActive: !toggling.isActive })
        }
      />
    </>
  );
}
