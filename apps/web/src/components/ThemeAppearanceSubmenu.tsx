import { Moon, Sun } from "lucide-react";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemePreferenceRadioGroup } from "@/components/ThemePreferenceRadioGroup";
import { useTheme } from "@/hooks/useTheme";

export function ThemeAppearanceSubmenu() {
  const { resolvedDark } = useTheme();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2">
        {resolvedDark ? (
          <Moon className="h-4 w-4" aria-hidden />
        ) : (
          <Sun className="h-4 w-4" aria-hidden />
        )}
        Appearance
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-44">
        <ThemePreferenceRadioGroup />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
