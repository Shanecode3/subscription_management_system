import { Plus, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { TemplateFormModal } from '../components/catalog/TemplateFormModal';
import { AppShell } from '../components/layout/AppShell';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { useAuth } from '../lib/auth-context';
import { formatMoney, intervalLabel } from '../lib/format';
import type { QuotationTemplate } from '../lib/types';
import { useApiResource } from '../lib/use-api-resource';

export function TemplatesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { data, setData, isLoading, error, reload } =
    useApiResource<QuotationTemplate[]>('/quotation-templates');

  const [isFormOpen, setIsFormOpen] = useState(false);

  const templates = data ?? [];

  const applyCreated = (created: QuotationTemplate) => {
    setData([...templates, created].sort((a, b) => a.name.localeCompare(b.name)));
    setIsFormOpen(false);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Quotation templates"
          description="Pre-configured offers. Starting a quotation from a template copies its plan and every line, so a sales rep can draft a proposal in seconds."
          action={
            isAdmin ? (
              <Button className="w-auto" onClick={() => setIsFormOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New template
              </Button>
            ) : null
          }
        />

        {isLoading ? (
          <div className="space-y-4">
            {[0, 1].map((panel) => (
              <div key={panel} className="h-56 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Alert tone="error" title="Templates could not be loaded">
              {error}
            </Alert>
            <Button variant="secondary" className="w-auto" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : templates.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No quotation templates yet"
            description="A template bundles a plan, a validity window and the product lines a rep should offer."
            action={
              isAdmin ? (
                <Button className="w-auto" onClick={() => setIsFormOpen(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New template
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-5">
            {templates.map((template) => (
              <article key={template.id} className="card overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/60 px-5 py-4">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink">{template.name}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600">
                      <Badge tone="plum">{template.planName}</Badge>
                      <span>{intervalLabel(template.planBillingInterval)} billing</span>
                      <span aria-hidden="true">·</span>
                      <span>Valid for {template.validityDays} days</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {template.lineCount} {template.lineCount === 1 ? 'line' : 'lines'}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-xs text-slate-500">Template value</p>
                    <p className="text-lg font-semibold tabular-nums text-ink">
                      {formatMoney(template.totalValue)}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                        <th scope="col" className="px-5 py-2">
                          Product
                        </th>
                        <th scope="col" className="px-3 py-2">
                          Variant
                        </th>
                        <th scope="col" className="px-3 py-2 text-right">
                          Qty
                        </th>
                        <th scope="col" className="px-3 py-2 text-right">
                          Unit price
                        </th>
                        <th scope="col" className="px-5 py-2 text-right">
                          Line total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {template.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="px-5 py-2.5 font-medium text-ink">{line.productName}</td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {line.variantLabel ?? (
                              <span className="text-slate-400">No variant</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                            {line.quantity}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                            {formatMoney(line.unitPrice)}
                          </td>
                          <td className="px-5 py-2.5 text-right font-medium tabular-nums text-ink">
                            {formatMoney(line.lineTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {template.notes ? (
                  <p className="border-t border-slate-100 px-5 py-3 text-xs leading-relaxed text-slate-500">
                    {template.notes}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>

      <TemplateFormModal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSaved={applyCreated}
      />
    </AppShell>
  );
}
