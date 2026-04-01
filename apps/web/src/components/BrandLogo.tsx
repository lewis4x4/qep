import brandLogoUrl from "@/assets/quality-equipment-parts-logo.png";
import { cn } from "@/lib/utils";

export const BRAND_NAME = "Quality Equipment & Parts";

type BrandLogoProps = {
  className?: string;
  /** Use when the same screen region already exposes BRAND_NAME visibly. */
  decorative?: boolean;
};

export function BrandLogo({ className, decorative }: BrandLogoProps) {
  return (
    <img
      src={brandLogoUrl}
      alt={decorative ? "" : BRAND_NAME}
      className={cn("object-contain object-left", className)}
    />
  );
}
