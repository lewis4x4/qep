import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import type { CrmCompanyHierarchy } from "../lib/types";

interface CrmCompanyHierarchyCardProps {
  hierarchy: CrmCompanyHierarchy;
}

export function CrmCompanyHierarchyCard({ hierarchy }: CrmCompanyHierarchyCardProps) {
  return (
    <Card className="space-y-4 border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Company Hierarchy</h2>
          <p className="text-sm text-muted-foreground">Ancestors, children, and subtree rollups.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-secondary px-2 py-1 text-foreground">
            Contacts: {hierarchy.rollups.contacts}
          </span>
          <span className="rounded bg-secondary px-2 py-1 text-foreground">
            Equipment: {hierarchy.rollups.equipment}
          </span>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Breadcrumb
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-sm">
          {hierarchy.ancestors.length === 0 ? (
            <span className="text-muted-foreground">Top-level company</span>
          ) : (
            hierarchy.ancestors.map((ancestor) => (
              <span key={ancestor.id} className="inline-flex items-center gap-1">
                <Link
                  className="text-primary underline-offset-2 hover:underline"
                  to={`/crm/companies/${ancestor.id}`}
                >
                  {ancestor.name}
                </Link>
                <span className="text-muted-foreground/70">/</span>
              </span>
            ))
          )}
          <span className="font-semibold text-foreground">{hierarchy.company.name}</span>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Child Companies
        </p>
        {hierarchy.children.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No child companies.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {hierarchy.children.map((child) => (
              <li
                key={child.id}
                className="rounded border border-border bg-muted/20 px-2 py-1"
              >
                <Link
                  className="text-primary underline-offset-2 hover:underline"
                  to={`/crm/companies/${child.id}`}
                >
                  {child.name}
                </Link>
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  Child company
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
