import type { PublicCompanyDTO } from '@support-desk/shared';
import { createContext, useContext } from 'react';

export interface CompanyContextValue {
  company: PublicCompanyDTO;
  /** Prefix an in-app path with the company, e.g. `/tickets` → `/acme/tickets`. */
  path: (to: string) => string;
}

export const CompanyContext = createContext<CompanyContextValue | null>(null);

export function useCompany(): PublicCompanyDTO {
  const context = useContext(CompanyContext);
  if (!context) throw new Error('useCompany must be used inside a company route');
  return context.company;
}

export function useCompanyPath(): (to: string) => string {
  const context = useContext(CompanyContext);
  if (!context) throw new Error('useCompanyPath must be used inside a company route');
  return context.path;
}
