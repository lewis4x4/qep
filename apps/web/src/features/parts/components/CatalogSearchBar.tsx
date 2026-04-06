import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  category: string;
  onCategoryChange: (v: string) => void;
  canCreate: boolean;
  creating: boolean;
  onToggleCreate: () => void;
}

export function CatalogSearchBar({
  query,
  onQueryChange,
  category,
  onCategoryChange,
  canCreate,
  creating,
  onToggleCreate,
}: Props) {
  return (
    <div className="flex flex-wrap gap-2 items-end">
      <div className="space-y-1">
        <label htmlFor="catalog-search" className="text-xs text-muted-foreground">Search</label>
        <Input
          id="catalog-search"
          className="w-[220px]"
          placeholder="Part #, description, mfr"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="catalog-category" className="text-xs text-muted-foreground">Category</label>
        <Input
          id="catalog-category"
          className="w-[160px]"
          placeholder="Filter"
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
        />
      </div>
      {canCreate && (
        <Button type="button" variant="secondary" size="sm" onClick={onToggleCreate}>
          {creating ? "Cancel" : "Add part"}
        </Button>
      )}
    </div>
  );
}
