import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, FileText, ListChecks, Sparkles, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

type AssistantResponseVariant =
  | "chat"
  | "iron_compact"
  | "sidecar"
  | "exec_briefing";

type AssistantResponseBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "key_values"; pairs: Array<{ key: string; value: string }> }
  | { type: "callout"; tone: "warning" | "evidence" | "action" | "info"; text: string };

const VARIANT_STYLES: Record<
  AssistantResponseVariant,
  {
    root: string;
    heading1: string;
    heading2: string;
    heading3: string;
    paragraph: string;
    listItem: string;
    keyValue: string;
    keyLabel: string;
    keyValueText: string;
    callout: string;
    tableWrapper: string;
    tableHeader: string;
    tableCell: string;
  }
> = {
  chat: {
    root: "space-y-3 text-[13px] leading-7",
    heading1: "text-xl font-semibold tracking-tight text-foreground",
    heading2: "text-[11px] font-semibold uppercase tracking-[0.22em] text-qep-orange",
    heading3: "text-sm font-semibold text-foreground",
    paragraph: "text-[13px] leading-7 text-foreground/95",
    listItem: "text-[13px] leading-7 text-foreground/95",
    keyValue: "rounded-2xl border border-border/70 bg-muted/[0.35] px-3 py-2.5",
    keyLabel: "text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground",
    keyValueText: "mt-1 text-[13px] leading-6 text-foreground",
    callout: "rounded-2xl border border-qep-orange/20 bg-qep-orange/[0.06] px-4 py-3",
    tableWrapper: "overflow-x-auto rounded-2xl border border-border/70 bg-card/60",
    tableHeader: "bg-white/[0.04] text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground",
    tableCell: "px-3 py-2 text-[12px] leading-6 text-foreground align-top",
  },
  iron_compact: {
    root: "space-y-2.5 text-[12px] leading-6",
    heading1: "text-base font-semibold tracking-tight text-white",
    heading2: "text-[10px] font-semibold uppercase tracking-[0.2em] text-qep-orange",
    heading3: "text-[12px] font-semibold text-slate-100",
    paragraph: "text-[12px] leading-6 text-slate-100",
    listItem: "text-[12px] leading-6 text-slate-100",
    keyValue: "rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2",
    keyLabel: "text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500",
    keyValueText: "mt-1 text-[12px] leading-5 text-slate-100",
    callout: "rounded-xl border border-qep-orange/20 bg-qep-orange/[0.08] px-3 py-2.5",
    tableWrapper: "overflow-x-auto rounded-xl border border-white/8 bg-white/[0.03]",
    tableHeader: "bg-white/[0.04] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400",
    tableCell: "px-3 py-2 text-[11px] leading-5 text-slate-100 align-top",
  },
  sidecar: {
    root: "space-y-3.5 text-[13px] leading-7",
    heading1: "text-xl font-semibold tracking-tight text-white",
    heading2: "text-[10px] font-semibold uppercase tracking-[0.22em] text-qep-orange",
    heading3: "text-sm font-semibold text-slate-100",
    paragraph: "text-[13px] leading-7 text-slate-100/95",
    listItem: "text-[13px] leading-7 text-slate-100/95",
    keyValue: "rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-3",
    keyLabel: "text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500",
    keyValueText: "mt-1 text-[13px] leading-6 text-slate-100",
    callout: "rounded-2xl border border-qep-orange/20 bg-qep-orange/[0.08] px-4 py-3",
    tableWrapper: "overflow-x-auto rounded-2xl border border-white/8 bg-white/[0.03]",
    tableHeader: "bg-white/[0.04] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400",
    tableCell: "px-3 py-2 text-[12px] leading-6 text-slate-100 align-top",
  },
  exec_briefing: {
    root: "space-y-4 text-[14px] leading-7",
    heading1: "text-2xl font-semibold tracking-tight text-white",
    heading2: "text-[11px] font-semibold uppercase tracking-[0.24em] text-qep-orange",
    heading3: "text-base font-semibold text-white",
    paragraph: "text-[14px] leading-7 text-slate-100",
    listItem: "text-[14px] leading-7 text-slate-100",
    keyValue: "rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3",
    keyLabel: "text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500",
    keyValueText: "mt-1 text-[14px] leading-6 text-white",
    callout: "rounded-2xl border border-qep-orange/25 bg-qep-orange/[0.08] px-4 py-3.5",
    tableWrapper: "overflow-x-auto rounded-2xl border border-white/8 bg-white/[0.03]",
    tableHeader: "bg-white/[0.04] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400",
    tableCell: "px-3 py-2 text-[12px] leading-6 text-white align-top",
  },
};

function parseAssistantResponse(content: string): AssistantResponseBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: AssistantResponseBlock[] = [];
  let index = 0;

  const isBlank = (line: string) => line.trim().length === 0;
  const isBullet = (line: string) => /^(\-|\*|•)\s+/.test(line.trim());
  const isOrdered = (line: string) => /^\d+\.\s+/.test(line.trim());
  const isKeyValue = (line: string) => /^[A-Za-z][A-Za-z0-9 /()%&+\-]{1,80}:\s+.+$/.test(line.trim());
  const isTableDivider = (line: string) => /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(line);
  const isTableRow = (line: string) => line.includes("|");

  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const trimmed = line.trim();

    if (/^###\s+/.test(trimmed)) {
      blocks.push({ type: "heading", level: 3, text: trimmed.replace(/^###\s+/, "") });
      index += 1;
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      blocks.push({ type: "heading", level: 2, text: trimmed.replace(/^##\s+/, "") });
      index += 1;
      continue;
    }
    if (/^#\s+/.test(trimmed)) {
      blocks.push({ type: "heading", level: 1, text: trimmed.replace(/^#\s+/, "") });
      index += 1;
      continue;
    }

    if (
      /^(warning|risk|critical|evidence|note|action|recommended action|watch list)\b[:\-]/i.test(trimmed)
    ) {
      const tone = /^warning|^risk|^critical/i.test(trimmed)
        ? "warning"
        : /^evidence/i.test(trimmed)
        ? "evidence"
        : /^action|^recommended action/i.test(trimmed)
        ? "action"
        : "info";
      blocks.push({ type: "callout", tone, text: trimmed });
      index += 1;
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = line
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && isTableRow(lines[index]) && !isBlank(lines[index])) {
        rows.push(
          lines[index]
            .split("|")
            .map((cell) => cell.trim())
            .filter(Boolean),
        );
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    if (isBullet(line) || isOrdered(line)) {
      const ordered = isOrdered(line);
      const items: string[] = [];
      while (
        index < lines.length &&
        !isBlank(lines[index]) &&
        ((ordered && isOrdered(lines[index])) || (!ordered && isBullet(lines[index])))
      ) {
        items.push(lines[index].trim().replace(ordered ? /^\d+\.\s+/ : /^(\-|\*|•)\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (isKeyValue(line)) {
      const pairs: Array<{ key: string; value: string }> = [];
      while (index < lines.length && !isBlank(lines[index]) && isKeyValue(lines[index])) {
        const [key, ...rest] = lines[index].split(":");
        pairs.push({
          key: key.trim(),
          value: rest.join(":").trim(),
        });
        index += 1;
      }
      blocks.push({ type: "key_values", pairs });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      !isBlank(lines[index]) &&
      !/^#{1,3}\s+/.test(lines[index].trim()) &&
      !isBullet(lines[index]) &&
      !isOrdered(lines[index]) &&
      !isKeyValue(lines[index]) &&
      !(/^(warning|risk|critical|evidence|note|action|recommended action|watch list)\b[:\-]/i.test(lines[index].trim())) &&
      !(isTableRow(lines[index]) && index + 1 < lines.length && isTableDivider(lines[index + 1]))
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const tokens = text.split(pattern).filter(Boolean);

  return tokens.map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) {
      return (
        <strong key={`${token}-${index}`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <code
          key={`${token}-${index}`}
          className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[0.92em] text-qep-orange"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={`${token}-${index}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-qep-orange underline decoration-qep-orange/40 underline-offset-4 hover:text-qep-orange-hover"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <span key={`${token}-${index}`}>{token}</span>;
  });
}

function CalloutIcon({ tone }: { tone: "warning" | "evidence" | "action" | "info" }) {
  if (tone === "warning") return <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />;
  if (tone === "action") return <ListChecks className="mt-0.5 h-4 w-4 text-qep-orange" />;
  if (tone === "evidence") return <FileText className="mt-0.5 h-4 w-4 text-blue-300" />;
  return <Sparkles className="mt-0.5 h-4 w-4 text-slate-300" />;
}

export function AssistantResponseRenderer({
  content,
  variant = "chat",
}: {
  content: string;
  variant?: AssistantResponseVariant;
}) {
  const blocks = parseAssistantResponse(content);
  const styles = VARIANT_STYLES[variant];

  return (
    <div className={styles.root}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const className =
            block.level === 1 ? styles.heading1 : block.level === 2 ? styles.heading2 : styles.heading3;
          const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
          return <Tag key={`block-${index}`} className={className}>{renderInline(block.text)}</Tag>;
        }

        if (block.type === "paragraph") {
          return (
            <p key={`block-${index}`} className={styles.paragraph}>
              {renderInline(block.text)}
            </p>
          );
        }

        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={`block-${index}`}
              className={cn(
                "space-y-2 pl-5",
                block.ordered ? "list-decimal" : "list-disc",
              )}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`item-${itemIndex}`} className={styles.listItem}>
                  {renderInline(item)}
                </li>
              ))}
            </ListTag>
          );
        }

        if (block.type === "key_values") {
          return (
            <div key={`block-${index}`} className="grid gap-2 sm:grid-cols-2">
              {block.pairs.map((pair, pairIndex) => (
                <div key={`pair-${pairIndex}`} className={styles.keyValue}>
                  <p className={styles.keyLabel}>{pair.key}</p>
                  <div className={styles.keyValueText}>{renderInline(pair.value)}</div>
                </div>
              ))}
            </div>
          );
        }

        if (block.type === "callout") {
          return (
            <div key={`block-${index}`} className={styles.callout}>
              <div className="flex items-start gap-3">
                <CalloutIcon tone={block.tone} />
                <div className={styles.paragraph}>{renderInline(block.text)}</div>
              </div>
            </div>
          );
        }

        if (block.type === "table") {
          return (
            <div key={`block-${index}`} className={styles.tableWrapper}>
              <table className="min-w-full border-collapse">
                <thead className={styles.tableHeader}>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={`header-${headerIndex}`} className="px-3 py-2 text-left">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`} className="border-t border-white/6">
                      {row.map((cell, cellIndex) => (
                        <td key={`cell-${cellIndex}`} className={styles.tableCell}>
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
