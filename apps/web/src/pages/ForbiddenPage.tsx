import { ShieldX } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '../components/ui/States';
import { useCompanyPath } from '../company/company-context';

export function ForbiddenPage() {
  const companyPath = useCompanyPath();
  return (
    <EmptyState
      icon={ShieldX}
      title="You don't have access to this page"
      description="Ask an administrator if you think you should."
      action={
        <Link
          to={companyPath('/dashboard')}
          className="text-sm font-medium text-brand-600 hover:text-brand-800"
        >
          Back to dashboard
        </Link>
      }
      className="py-24"
    />
  );
}
