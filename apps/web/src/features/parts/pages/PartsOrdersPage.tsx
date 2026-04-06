import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePartsOrders } from "../hooks/usePartsOrders";
import { PartsSubNav } from "../components/PartsSubNav";
import { OrderStatusBadge } from "../components/OrderStatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function PartsOrdersPage() {
  const { data: rows = [], isLoading, isError, error } = usePartsOrders();
  const [source, setSource] = useState<"all" | "portal" | "internal">("all");

  const filtered = useMemo(() => {
    if (source === "all") return rows;
    if (source === "portal") return rows.filter((r) => r.order_source === "portal");
    return rows.filter((r) => r.order_source !== "portal");
  }, [rows, source]);

  function customerLabel(r: (typeof rows)[0]) {
    if (r.portal_customers) {
      const c = r.portal_customers;
      return `${c.first_name} ${c.last_name}`.trim();
    }
    if (r.crm_companies?.name) return r.crm_companies.name;
    return "—";
  }

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Parts orders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Portal, counter, and phone orders in one pipeline.
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/parts/orders/new">New order</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All sources"],
            ["portal", "Portal"],
            ["internal", "Counter / phone / other"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            type="button"
            variant={source === key ? "default" : "outline"}
            size="sm"
            onClick={() => setSource(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {isLoading && (
        <div className="flex justify-center py-16" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading orders</span>
          <div
            className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
        </div>
      )}
      {isError && (
        <Card className="p-4 text-sm text-destructive">
          {(error as Error)?.message ?? "Failed to load orders."}
        </Card>
      )}

      {!isLoading && !isError && (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[120px]">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <Fragment key={row.id}>
                  <TableRow>
                    <TableCell>
                      <OrderStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.order_source}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{customerLabel(row)}</div>
                      {row.portal_customers?.email && (
                        <div className="text-xs text-muted-foreground">
                          {row.portal_customers.email}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="link" className="h-auto p-0 text-xs">
                        <Link to={`/parts/orders/${row.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
