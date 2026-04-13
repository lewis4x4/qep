import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { User, Building2, Phone, Mail } from "lucide-react";

interface CustomerInfoCardProps {
  customerName: string;
  customerCompany: string;
  customerPhone: string;
  customerEmail: string;
  onChange: (field: "customerName" | "customerCompany" | "customerPhone" | "customerEmail", value: string) => void;
}

export function CustomerInfoCard({
  customerName,
  customerCompany,
  customerPhone,
  customerEmail,
  onChange,
}: CustomerInfoCardProps) {
  return (
    <Card className="p-4 space-y-3">
      <p className="text-sm font-semibold text-foreground">Customer</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative">
          <User className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={customerName}
            onChange={(e) => onChange("customerName", e.target.value)}
            placeholder="Contact name"
            aria-label="Contact name"
            className="pl-9"
          />
        </div>
        <div className="relative">
          <Building2 className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={customerCompany}
            onChange={(e) => onChange("customerCompany", e.target.value)}
            placeholder="Company"
            aria-label="Company"
            className="pl-9"
          />
        </div>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={customerPhone}
            onChange={(e) => onChange("customerPhone", e.target.value)}
            placeholder="Phone"
            aria-label="Phone"
            className="pl-9"
            type="tel"
          />
        </div>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={customerEmail}
            onChange={(e) => onChange("customerEmail", e.target.value)}
            placeholder="Email"
            aria-label="Email"
            className="pl-9"
            type="email"
          />
        </div>
      </div>
    </Card>
  );
}
