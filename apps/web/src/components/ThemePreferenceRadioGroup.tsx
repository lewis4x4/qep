import { Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/useTheme";
import type { ThemePreference } from "@/lib/theme-store";

export function ThemePreferenceRadioGroup() {
  const { preference, setPreference } = useTheme();

  return (
    <DropdownMenuRadioGroup
      value={preference}
      onValueChange={(v) => setPreference(v as ThemePreference)}
    >
      <DropdownMenuRadioItem value="light" className="gap-2">
        <Sun className="h-4 w-4 shrink-0" aria-hidden />
        Light
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark" className="gap-2">
        <Moon className="h-4 w-4 shrink-0" aria-hidden />
        Dark
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system" className="gap-2">
        <Monitor className="h-4 w-4 shrink-0" aria-hidden />
        System
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}
