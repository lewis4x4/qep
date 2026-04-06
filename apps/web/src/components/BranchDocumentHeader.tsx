import { useBranchBySlug, type Branch } from "@/hooks/useBranches";

interface Props {
  branchSlug?: string | null;
  branch?: Branch | null;
  showLogo?: boolean;
  showPhone?: boolean;
  showEmail?: boolean;
  showAddress?: boolean;
  className?: string;
  compact?: boolean;
}

function formatPhone(p: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return p;
}

/**
 * Reusable document header that pulls branch identity for
 * quotes, invoices, receipts, and service reports.
 * Pass either a `branch` object directly or a `branchSlug` to auto-resolve.
 */
export function BranchDocumentHeader({
  branchSlug,
  branch: branchProp,
  showLogo = true,
  showPhone = true,
  showEmail = true,
  showAddress = true,
  className = "",
  compact = false,
}: Props) {
  const resolvedQ = useBranchBySlug(branchProp ? null : branchSlug);
  const branch = branchProp ?? resolvedQ.data;

  if (!branch) return null;

  const addressParts = [
    branch.address_line1,
    branch.address_line2,
    [branch.city, branch.state_province].filter(Boolean).join(", "),
    branch.postal_code,
  ].filter(Boolean);

  if (compact) {
    return (
      <div className={`text-xs text-muted-foreground ${className}`}>
        <span className="font-semibold text-foreground">{branch.display_name}</span>
        {showAddress && addressParts.length > 0 && (
          <span className="ml-2">{addressParts.join(", ")}</span>
        )}
        {showPhone && branch.phone_main && (
          <span className="ml-2">{formatPhone(branch.phone_main)}</span>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-4 ${className}`}>
      {showLogo && branch.logo_url && (
        <img
          src={branch.logo_url}
          alt={`${branch.display_name} logo`}
          className="h-12 w-auto object-contain shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-bold text-foreground leading-tight">
          {branch.display_name}
        </h2>
        {branch.header_tagline && (
          <p className="text-[11px] text-muted-foreground italic">{branch.header_tagline}</p>
        )}

        {showAddress && addressParts.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            {addressParts.join(", ")}
          </p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
          {showPhone && branch.phone_main && (
            <span>Tel: {formatPhone(branch.phone_main)}</span>
          )}
          {showPhone && branch.fax && (
            <span>Fax: {formatPhone(branch.fax)}</span>
          )}
          {showEmail && branch.email_main && (
            <span>{branch.email_main}</span>
          )}
          {branch.website_url && (
            <span>{branch.website_url}</span>
          )}
        </div>

        {branch.tax_id && (
          <p className="text-[10px] text-muted-foreground mt-0.5">Tax ID: {branch.tax_id}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Footer line for documents — disclaimer, terms, etc.
 */
export function BranchDocumentFooter({
  branchSlug,
  branch: branchProp,
  className = "",
}: {
  branchSlug?: string | null;
  branch?: Branch | null;
  className?: string;
}) {
  const resolvedQ = useBranchBySlug(branchProp ? null : branchSlug);
  const branch = branchProp ?? resolvedQ.data;

  if (!branch?.doc_footer_text) return null;

  return (
    <div className={`text-[10px] text-muted-foreground border-t pt-2 mt-4 ${className}`}>
      {branch.doc_footer_text}
    </div>
  );
}
