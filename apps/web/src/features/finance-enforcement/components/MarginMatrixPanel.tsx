import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableCaption,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import { useMarginMatrix } from "../hooks/use-finance-enforcement";
import { AsyncSection } from "./AsyncSection";
import type {
  MarginMatrixSummaryRow, MarginLineClass, MarginSegment,
} from "../lib/finance-enforcement-api";

interface MarginMatrixPanelProps {
  workspaceId: string;
}

const LINE_CLASSES: readonly MarginLineClass[] = ["parts", "service", "equipment"];
const SEGMENTS: readonly MarginSegment[] = ["customer", "warranty", "internal", "sublet"];

const LINE_CLASS_LABEL: Record<MarginLineClass, string> = {
  parts: "Parts",
  service: "Service",
  equipment: "Equipment",
};

const SEGMENT_LABEL: Record<MarginSegment, string> = {
  customer: "Customer",
  warranty: "Warranty",
  internal: "Internal",
  sublet: "Sublet",
};

/** Format an integer cent value as USD, e.g. 1234500 → "$12,345.00". */
function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type MarginBasis = "net_margin_cents" | "gross_margin_cents";

/** Index the flat rollup rows by (line_class, segment) for O(1) cell lookup. */
function indexRows(
  rows: MarginMatrixSummaryRow[],
): Map<string, MarginMatrixSummaryRow> {
  const map = new Map<string, MarginMatrixSummaryRow>();
  for (const row of rows) {
    map.set(`${row.line_class}:${row.segment}`, row);
  }
  return map;
}

function MarginGrid({
  rows,
  basis,
}: {
  rows: MarginMatrixSummaryRow[];
  basis: MarginBasis;
}) {
  const index = indexRows(rows);
  const basisLabel = basis === "net_margin_cents" ? "net" : "gross";

  return (
    <Table>
      <TableCaption className="text-left text-[11px] leading-relaxed">
        Locked margin formulas — Equipment = Sale − NBV · Parts = Sale − Cost ·
        Service = Labor Sale − Tech Cost. Net margin applies shop burden below GM;
        gross margin is pre-burden. Values are {basisLabel} margin.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-32">Line class</TableHead>
          {SEGMENTS.map((segment) => (
            <TableHead key={segment} className="text-right">
              {SEGMENT_LABEL[segment]}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {LINE_CLASSES.map((lineClass) => (
          <TableRow key={lineClass}>
            <TableCell className="font-medium">{LINE_CLASS_LABEL[lineClass]}</TableCell>
            {SEGMENTS.map((segment) => {
              const cell = index.get(`${lineClass}:${segment}`);
              if (!cell) {
                return (
                  <TableCell
                    key={segment}
                    className="text-right text-muted-foreground"
                  >
                    —
                  </TableCell>
                );
              }
              const other =
                basis === "net_margin_cents"
                  ? { label: "Gross", cents: cell.gross_margin_cents }
                  : { label: "Net", cents: cell.net_margin_cents };
              return (
                <TableCell key={segment} className="text-right tabular-nums">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>{formatCents(cell[basis])}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span>
                        {other.label}: {formatCents(other.cents)}
                        {typeof cell.entry_count === "number"
                          ? ` · ${cell.entry_count} entr${cell.entry_count === 1 ? "y" : "ies"}`
                          : null}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Margin matrix rollup — [Parts|Service|Equipment] × [Customer|Warranty|Internal|Sublet].
 * Cells show net margin (hover for gross); a second tab surfaces gross margin.
 */
export function MarginMatrixPanel({ workspaceId }: MarginMatrixPanelProps) {
  const query = useMarginMatrix(workspaceId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Margin matrix</CardTitle>
        <CardDescription>
          Line-class × segment margin rollup for the workspace, in dollars.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AsyncSection
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          data={query.data}
          loadingLabel="Loading margin matrix…"
          emptyLabel="No margin entries tagged yet."
        >
          {(rows) => (
            <TooltipProvider delayDuration={150}>
              <Tabs defaultValue="net">
                <TabsList>
                  <TabsTrigger value="net">Net margin</TabsTrigger>
                  <TabsTrigger value="gross">Gross margin</TabsTrigger>
                </TabsList>
                <TabsContent value="net">
                  <MarginGrid rows={rows} basis="net_margin_cents" />
                </TabsContent>
                <TabsContent value="gross">
                  <MarginGrid rows={rows} basis="gross_margin_cents" />
                </TabsContent>
              </Tabs>
            </TooltipProvider>
          )}
        </AsyncSection>
      </CardContent>
    </Card>
  );
}
