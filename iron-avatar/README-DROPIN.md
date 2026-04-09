# Iron Avatar — Drop-In Integration Guide

All 5 PNGs + React components are ready for Wave 7 Iron Companion.

## What's in this folder

| File | Destination in QEP repo |
|---|---|
| `iron-idle.png` | `apps/web/src/assets/iron/iron-idle.png` |
| `iron-thinking.png` | `apps/web/src/assets/iron/iron-thinking.png` |
| `iron-speaking.png` | `apps/web/src/assets/iron/iron-speaking.png` |
| `iron-listening.png` | `apps/web/src/assets/iron/iron-listening.png` |
| `iron-alert.png` | `apps/web/src/assets/iron/iron-alert.png` |
| `IronAvatar.tsx` | `apps/web/src/lib/iron/avatar/IronAvatar.tsx` |
| `IronCorner.tsx` | `apps/web/src/lib/iron/IronCorner.tsx` |

## Terminal commands to install

From `/Users/brianlewis/client-projects/qep`:

```bash
# Install dependency (if not already present)
bun add framer-motion

# Create destination folders
mkdir -p apps/web/src/assets/iron
mkdir -p apps/web/src/lib/iron/avatar

# Copy from the workspace folder (adjust path if your Cowork folder is elsewhere)
cp <path-to-iron-avatar>/iron-*.png apps/web/src/assets/iron/
cp <path-to-iron-avatar>/IronAvatar.tsx apps/web/src/lib/iron/avatar/
cp <path-to-iron-avatar>/IronCorner.tsx apps/web/src/lib/iron/
```

## Wire into App shell

In `apps/web/src/App.tsx`, inside the auth-gated tree:

```tsx
import { IronCorner } from '@/lib/iron/IronCorner';
import { useIronStore } from '@/lib/iron/store'; // built in Wave 7 §3

function AppShell({ children }: { children: React.ReactNode }) {
  const state = useIronStore((s) => s.avatarState);
  const openBar = useIronStore((s) => s.openBar);
  const collapsed = useIronStore((s) => s.collapsed);
  const toggleCollapsed = useIronStore((s) => s.toggleCollapsed);

  return (
    <>
      {children}
      <IronCorner
        state={state}
        onClick={openBar}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
    </>
  );
}
```

## Component props

### `<IronAvatar />`

| Prop | Type | Default | Purpose |
|---|---|---|---|
| `state` | `'idle' \| 'thinking' \| 'speaking' \| 'listening' \| 'alert' \| 'flow_active'` | required | Which PNG to show + which accent effects |
| `size` | `number` | `72` | Pixel size (square) |
| `collapsed` | `boolean` | `false` | Render as 24px chip |
| `onClick` | `() => void` | — | Click handler |
| `ariaLabel` | `string` | state-derived | a11y label |
| `className` | `string` | `''` | Extra Tailwind/CSS classes |

### `<IronCorner />`

Draggable fixed-position wrapper. Persists corner choice to `localStorage` (`iron:avatar:position`). Snaps to nearest corner on release. Double-click to collapse. Respects `env(safe-area-inset-*)` for mobile safe areas.

## Animation behavior

| State | Loop | Overlay |
|---|---|---|
| `idle` | 4s breathe scale | — |
| `thinking` | — | amber glow ring |
| `speaking` | — | amber glow ring (stronger) |
| `listening` | — | blue pulse ring expanding |
| `alert` | 1.2s bob + red-dot pulse | red dot top-right with glow |
| `flow_active` | — | amber glow ring |

Respects `prefers-reduced-motion`: disables breathe, bob, pulse, and scale-on-hover when set.

## Z-index discipline

- Iron avatar: `9998`
- Iron bar overlay: `9997` (mounts behind avatar, avatar stays clickable)
- Iron flow overlay: `9996`
- Flare drawer: `9999` (always wins — bug reports must never be blocked by Iron)

## Testing the avatar in isolation

Add to Storybook:

```tsx
// apps/web/src/lib/iron/avatar/IronAvatar.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { IronAvatar } from './IronAvatar';

const meta: Meta<typeof IronAvatar> = { component: IronAvatar };
export default meta;

export const Idle: StoryObj = { args: { state: 'idle' } };
export const Thinking: StoryObj = { args: { state: 'thinking' } };
export const Speaking: StoryObj = { args: { state: 'speaking' } };
export const Listening: StoryObj = { args: { state: 'listening' } };
export const Alert: StoryObj = { args: { state: 'alert' } };
export const Collapsed: StoryObj = { args: { state: 'idle', collapsed: true } };
```

## Notes on the PNGs

- All 5 PNGs are 1024×1024 with transparent background.
- File sizes are 1.3–1.5 MB each — acceptable for initial ship, but compress before production:
  ```bash
  brew install pngquant
  pngquant --force --skip-if-larger --quality=80-95 apps/web/src/assets/iron/*.png --ext .png
  ```
  Expect ~70% size reduction with no visible quality loss.
- Vite will automatically fingerprint + hash these on build.
- Consider generating WebP versions for ~30% additional savings:
  ```bash
  for f in apps/web/src/assets/iron/*.png; do
    cwebp -q 90 "$f" -o "${f%.png}.webp"
  done
  ```
  Then use `<picture>` with `<source type="image/webp">` in IronAvatar if you want the extra savings.

## Next steps after avatar is wired

Per Wave 7 build spec v2:
1. Build `useIronStore` (Zustand) for avatarState + drawerOpen + activeRun
2. Build IronShell (mount point, hotkey)
3. Build IronBar (command palette)
4. Build FlowEngine
5. Ship first flow (`startRental`) end-to-end

The avatar is a standalone deliverable — it renders correctly right now with a mocked `state` prop even before the rest of Wave 7 exists. Good for early demos.
