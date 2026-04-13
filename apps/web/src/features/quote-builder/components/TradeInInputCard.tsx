import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowDownUp } from "lucide-react";

interface TradeInInputCardProps {
  tradeAllowance: number;
  onChange: (value: number) => void;
}

export function TradeInInputCard({ tradeAllowance, onChange }: TradeInInputCardProps) {
  const [description, setDescription] = useState("");

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ArrowDownUp className="h-4 w-4 text-qep-orange" />
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Trade-In</p>
      </div>
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Equipment description (e.g. 2019 CAT 320)"
        className="text-sm"
      />
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <Input
          type="number"
          min={0}
          step={500}
          value={tradeAllowance || ""}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          placeholder="Estimated value"
          className="pl-7 text-sm"
        />
      </div>
      {tradeAllowance > 0 && (
        <p className="text-xs text-emerald-400">
          Trade credit: -${tradeAllowance.toLocaleString()}
        </p>
      )}
    </Card>
  );
}
