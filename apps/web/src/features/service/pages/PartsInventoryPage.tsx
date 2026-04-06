import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { MoreHorizontal, Link as LinkIcon, Copy, Search, ArrowUpDown } from "lucide-react";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { useActiveBranches, type Branch } from "@/hooks/useBranches";
import { ServiceSubNav } from "../components/ServiceSubNav";
import { PartsSubNav } from "@/features/parts/components/PartsSubNav";
import { toast } from "@/hooks/use-toast";
import { AddInventorySheet } from "../components/AddInventorySheet";

export function PartsInventoryPage({ subNav = "service" }: { subNav?: "service" | "parts" }) {
  const qc = useQueryClient();
  const workspaceQ = useMyWorkspaceId();
  const workspaceId = workspaceQ.data;
  const branchesQ = useActiveBranches();
  const branches = branchesQ.data ?? [];

  const [filterBranch, setFilterBranch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: string, dir: 'asc' | 'desc' } | null>(null);

  const branchMap = useMemo(() => {
    const m = new Map<string, Branch>();
    for (const b of branches) m.set(b.slug, b);
    return m;
  }, [branches]);

  const {
    data: rows = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["parts-inventory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_inventory")
        .select("*")
        .is("deleted_at", null)
        .order("branch_id")
        .order("part_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const sortedAndFilteredRows = useMemo(() => {
    let result = [...rows];
    
    if (filterBranch) {
        result = result.filter(r => r.branch_id === filterBranch);
    }
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        result = result.filter(r => 
            r.part_number.toLowerCase().includes(q) || 
            (r.bin_location && r.bin_location.toLowerCase().includes(q))
        );
    }

    if (sortConfig) {
        result.sort((a, b) => {
            const valA = (a as any)[sortConfig.key];
            const valB = (b as any)[sortConfig.key];
            
            // Handle nulls gracefully
            if (valA === null && valB !== null) return sortConfig.dir === 'asc' ? 1 : -1;
            if (valA !== null && valB === null) return sortConfig.dir === 'asc' ? -1 : 1;
            
            if (valA < valB) return sortConfig.dir === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.dir === 'asc' ? 1 : -1;
            return 0;
        });
    }
    return result;
  }, [rows, filterBranch, searchQuery, sortConfig]);

  const handleSort = (key: string) => {
    let dir: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.dir === 'asc') {
        dir = 'desc';
    }
    setSortConfig({ key, dir });
  };

  const SortButton = ({ column, label }: { column: string, label: string }) => (
    <Button variant="ghost" size="sm" className="-ml-3 h-8 data-[state=open]:bg-accent" onClick={() => handleSort(column)}>
      <span>{label}</span>
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  );

  const upsert = useMutation({
    mutationFn: async (payload: {
      workspace_id?: string;
      branch_id: string;
      part_number: string;
      qty_on_hand: number;
      bin_location?: string | null;
    }) => {
      if (!workspaceId) throw new Error("Workspace unavailable for inventory write.");
      const { error } = await supabase.from("parts_inventory").upsert(
        {
          workspace_id: workspaceId,
          branch_id: payload.branch_id,
          part_number: payload.part_number.trim(),
          qty_on_hand: payload.qty_on_hand,
          bin_location: payload.bin_location || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,branch_id,part_number" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts-inventory"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save inline edit", description: err.message, variant: "destructive" });
    }
  });

  const autoLinkMut = useMutation({
    mutationFn: async (invRow: { id: string; part_number: string }) => {
      const { data: cat, error: catErr } = await supabase
        .from("parts_catalog")
        .select("id")
        .eq("part_number", invRow.part_number)
        .is("deleted_at", null)
        .maybeSingle();
      if (catErr) throw catErr;
      if (!cat) throw new Error(`No catalog entry for ${invRow.part_number}`);
      const { error } = await supabase
        .from("parts_inventory")
        .update({ catalog_id: cat.id })
        .eq("id", invRow.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parts-inventory"] });
      toast({ title: "Auto-linked successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Auto-link failed", description: err.message, variant: "destructive" });
    }
  });

  const branchCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      counts.set(r.branch_id, (counts.get(r.branch_id) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard", description: text });
  };

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6 animate-in fade-in duration-500">
      {subNav === "parts" ? <PartsSubNav /> : <ServiceSubNav />}
      
      {/* Sticky Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sticky top-0 bg-background/80 backdrop-blur-md z-20 py-4 border-b border-border/50">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Parts Inventory</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage branch quantities and monitor parts planner stock levels.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search part # or bin..."
              className="w-full bg-background shadow-sm pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <AddInventorySheet />
        </div>
      </div>

      {workspaceQ.isError && (
        <Card className="p-4 text-sm bg-destructive/10 text-destructive border-destructive/20 flex items-center gap-2">
          <div className="flex-1">
            <span className="font-semibold">Workspace connect error:</span> {(workspaceQ.error as Error)?.message ?? "Could not resolve your workspace."}
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {/* Modern Filter Ribbon */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none snap-x mask-fade-edges">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0 mr-1">Filter by Branch</span>
          <button
            type="button"
            onClick={() => setFilterBranch("")}
            className={`text-sm px-3 py-1.5 rounded-full font-medium transition-all shrink-0 snap-start border ${!filterBranch ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20" : "bg-card border-border/50 text-muted-foreground hover:bg-muted"}`}
          >
            All <Badge variant="secondary" className={`ml-1.5 ${!filterBranch ? "bg-primary-foreground/20 text-primary-foreground" : ""}`}>{rows.length}</Badge>
          </button>
          
          {branches.map((b) => (
             <button
              key={b.id}
              type="button"
              onClick={() => setFilterBranch(b.slug)}
              className={`text-sm px-3 py-1.5 rounded-full font-medium transition-all shrink-0 snap-start border flex items-center gap-1.5 ${filterBranch === b.slug ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20" : "bg-card border-border/50 text-muted-foreground hover:bg-muted"}`}
            >
              <div className="w-4 h-4 rounded-full bg-blue-500/10 flex items-center justify-center text-[10px] text-blue-600 font-bold border border-blue-500/20">
                {b.display_name.charAt(0)}
              </div>
              {b.display_name}
              {branchCounts.get(b.slug) != null && (
                <Badge variant="secondary" className={`ml-0.5 ${filterBranch === b.slug ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted/50"}`}>{branchCounts.get(b.slug)}</Badge>
              )}
            </button>
          ))}
          
          {Array.from(branchCounts.keys())
            .filter((slug) => !branchMap.has(slug))
            .map((slug) => (
              <button
                key={slug}
                type="button"
                onClick={() => setFilterBranch(slug)}
                className={`text-sm px-3 py-1.5 rounded-full font-medium transition-all shrink-0 snap-start border flex items-center gap-1.5 ${filterBranch === slug ? "bg-orange-500 text-white border-orange-600" : "bg-card border-border/50 text-orange-600 hover:bg-orange-50"}`}
              >
                {slug}
                <Badge variant="secondary" className="ml-0.5 text-[10px] bg-orange-500/20 text-orange-700">unmapped context</Badge>
              </button>
            ))}
        </div>

        {/* Data Table */}
        <Card className="border-border/50 shadow-sm overflow-hidden bg-card">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-10 w-32 bg-muted/50 rounded animate-pulse" />
                  <div className="h-10 w-48 bg-muted/50 rounded animate-pulse" />
                  <div className="h-10 w-16 bg-muted/50 rounded animate-pulse" />
                  <div className="h-10 flex-1 bg-muted/50 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="p-12 text-center text-muted-foreground">
              <p className="text-destructive font-medium">Failed to load inventory.</p>
              <p className="text-sm">{(error as Error)?.message}</p>
            </div>
          ) : sortedAndFilteredRows.length === 0 ? (
             <div className="p-16 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-lg font-medium text-foreground">No matching inventory items</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                {searchQuery ? `We couldn't find any parts matching "${searchQuery}".` : "There are no parts currently tracked in this branch context. Use the add button to begin."}
              </p>
             </div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] scrollbar-thin">
              <TooltipProvider delayDuration={300}>
                <Table>
                  <TableHeader className="sticky top-0 bg-muted/40 backdrop-blur-md z-10 shadow-sm border-b">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[180px] py-3"><SortButton column="branch_id" label="Branch Context" /></TableHead>
                      <TableHead className="w-[180px]"><SortButton column="part_number" label="Part Number" /></TableHead>
                      <TableHead className="w-[150px]"><SortButton column="qty_on_hand" label="Qty On Hand" /></TableHead>
                      <TableHead className="w-[150px]"><SortButton column="bin_location" label="Bin Location" /></TableHead>
                      <TableHead>Catalog Link</TableHead>
                      <TableHead className="w-[160px] text-right"><SortButton column="updated_at" label="Updated" /></TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedAndFilteredRows.map((r) => {
                      const branch = branchMap.get(r.branch_id);
                      return (
                        <TableRow key={r.id} className="transition-colors hover:bg-muted/10 group">
                          <TableCell className="font-medium py-2">
                            <div className="flex items-center gap-2">
                              {branch ? (
                                <Avatar className="h-6 w-6 border bg-muted/50">
                                  <AvatarFallback className="text-[10px] bg-transparent">{branch.display_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                                </Avatar>
                              ) : (
                                <div className="h-6 w-6 rounded-full border border-orange-200 bg-orange-100 flex items-center justify-center">
                                  <span className="text-[10px] text-orange-600 font-bold">?</span>
                                </div>
                              )}
                              <span>{branch?.display_name ?? r.branch_id}</span>
                              {branch?.short_code && (
                                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm uppercase tracking-wider">{branch.short_code}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-sm px-2 py-1 bg-muted/30 rounded border border-border/40 inline-block">{r.part_number}</span>
                          </TableCell>
                          <TableCell>
                            <div className="relative group">
                              <input
                                key={`${r.id}-${r.qty_on_hand}`}
                                type="number"
                                min={0}
                                className="w-24 rounded-md border border-transparent hover:border-input focus:border-ring focus:ring-1 focus:ring-ring px-2 py-1 transition-all outline-none bg-transparent hover:bg-muted focus:bg-background text-base font-semibold"
                                defaultValue={r.qty_on_hand}
                                onBlur={(e) => {
                                  let v = parseInt(e.target.value, 10);
                                  if (isNaN(v) || v < 0) v = 0;
                                  
                                  if (v !== r.qty_on_hand) {
                                     // Optional verification logic could go here
                                     upsert.mutate({
                                        branch_id: r.branch_id,
                                        part_number: r.part_number,
                                        qty_on_hand: v,
                                        bin_location: r.bin_location,
                                      });
                                  }
                                }}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{r.bin_location ?? <span className="opacity-40">—</span>}</TableCell>
                          <TableCell>
                            {r.catalog_id ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-mono bg-blue-500/5 text-blue-600/80 px-2 py-1 rounded-md border border-blue-500/10 cursor-help transition-colors hover:bg-blue-500/10 hover:text-blue-700">
                                    <LinkIcon className="h-3 w-3" />
                                    {r.catalog_id.slice(0, 8)}…
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p className="font-mono text-xs">{r.catalog_id}</p>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2 text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                                disabled={autoLinkMut.isPending}
                                onClick={() => autoLinkMut.mutate({ id: r.id, part_number: r.part_number })}
                              >
                                <LinkIcon className="h-3 w-3 mr-1" /> Auto-link
                              </Button>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {r.updated_at ? new Date(r.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                             <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem onClick={() => copyToClipboard(r.part_number)}>
                                    <Copy className="mr-2 h-4 w-4" /> Copy Part #
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => autoLinkMut.mutate({ id: r.id, part_number: r.part_number })}>
                                    <LinkIcon className="mr-2 h-4 w-4" /> Try Auto-link
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
