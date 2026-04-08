/**
 * Wave 7 Iron Companion — draggable corner wrapper for IronAvatar.
 *
 * Snaps to the nearest of four screen corners on release. Persists the
 * chosen corner to localStorage AND mirrors it to iron_settings.avatar_corner
 * (best-effort fire-and-forget) so it follows the user across devices. Honors
 * env(safe-area-inset-*) for mobile. Double-click toggles collapsed/expanded.
 *
 * Z-index 9998 — Flare drawer at 9999 always wins.
 */
import { motion, useDragControls, useMotionValue } from "framer-motion";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { supabase } from "@/lib/supabase";

import { IronAvatar } from "./IronAvatar";
import type { IronAvatarState } from "./types";

interface IronCornerProps {
  state: IronAvatarState;
  onClick: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

type Corner = "br" | "bl" | "tr" | "tl";

interface StoredPosition {
  corner: Corner;
}

const STORAGE_KEY = "iron:avatar:position";
const PADDING = 20;

function loadCornerFromStorage(): Corner {
  if (typeof window === "undefined") return "br";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return "br";
    const parsed = JSON.parse(raw) as StoredPosition;
    if (parsed?.corner === "br" || parsed?.corner === "bl" || parsed?.corner === "tr" || parsed?.corner === "tl") {
      return parsed.corner;
    }
    return "br";
  } catch {
    return "br";
  }
}

function saveCornerToStorage(corner: Corner): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ corner } satisfies StoredPosition));
  } catch {
    /* noop */
  }
}

/**
 * Mirror corner to iron_settings.avatar_corner so it follows the user
 * across devices. Best-effort: failures are swallowed because the local
 * persistence is the source of truth and the column may not exist on
 * legacy environments.
 */
async function mirrorCornerToProfile(corner: Corner): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    const cornerColumnValue = ({
      br: "bottom-right",
      bl: "bottom-left",
      tr: "top-right",
      tl: "top-left",
    } as const)[corner];
    await supabase
      .from("iron_settings")
      .update({ avatar_corner: cornerColumnValue })
      .eq("user_id", userId);
  } catch (err) {
    console.debug("[IronCorner] mirror failed (non-fatal):", err);
  }
}

function computeCorner(x: number, y: number): Corner {
  if (typeof window === "undefined") return "br";
  const w = window.innerWidth;
  const h = window.innerHeight;
  const right = x > w / 2;
  const bottom = y > h / 2;
  if (bottom && right) return "br";
  if (bottom && !right) return "bl";
  if (!bottom && right) return "tr";
  return "tl";
}

function cornerStyle(corner: Corner): CSSProperties {
  const style: CSSProperties = { position: "fixed", zIndex: 9998, touchAction: "none" };
  switch (corner) {
    case "br":
      style.right = PADDING;
      style.bottom = `calc(${PADDING}px + env(safe-area-inset-bottom, 0px))`;
      break;
    case "bl":
      style.left = PADDING;
      style.bottom = `calc(${PADDING}px + env(safe-area-inset-bottom, 0px))`;
      break;
    case "tr":
      style.right = PADDING;
      style.top = `calc(${PADDING}px + env(safe-area-inset-top, 0px))`;
      break;
    case "tl":
      style.left = PADDING;
      style.top = `calc(${PADDING}px + env(safe-area-inset-top, 0px))`;
      break;
  }
  return style;
}

export function IronCorner({
  state,
  onClick,
  collapsed = false,
  onToggleCollapsed,
}: IronCornerProps) {
  const [corner, setCorner] = useState<Corner>(() => loadCornerFromStorage());
  const dragControls = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const draggedRef = useRef(false);

  // Reset motion values when corner changes (snap)
  useEffect(() => {
    x.set(0);
    y.set(0);
  }, [corner, x, y]);

  // First-mount: hydrate from iron_settings.avatar_corner so a fresh
  // device picks up the user's preferred corner from the server. Local
  // storage wins for subsequent renders (and is updated by every drag).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data: userResult } = await supabase.auth.getUser();
        const userId = userResult.user?.id;
        if (!userId) return;
        const { data } = await supabase
          .from("iron_settings")
          .select("avatar_corner")
          .eq("user_id", userId)
          .maybeSingle();
        if (cancelled) return;
        const remote = (data as { avatar_corner?: string } | null)?.avatar_corner;
        const remoteCorner = ({
          "bottom-right": "br",
          "bottom-left": "bl",
          "top-right": "tr",
          "top-left": "tl",
        } as const)[remote ?? ""];
        if (remoteCorner) {
          setCorner(remoteCorner);
          saveCornerToStorage(remoteCorner);
        }
      } catch (err) {
        console.debug("[IronCorner] hydrate failed (non-fatal):", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally empty deps — first mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragEnd = useCallback(
    (_e: MouseEvent | TouchEvent | PointerEvent, info: { point: { x: number; y: number } }) => {
      draggedRef.current = true;
      const newCorner = computeCorner(info.point.x, info.point.y);
      setCorner(newCorner);
      saveCornerToStorage(newCorner);
      void mirrorCornerToProfile(newCorner);
      // Suppress the click that follows a drag
      setTimeout(() => {
        draggedRef.current = false;
      }, 50);
    },
    [],
  );

  const handleClick = useCallback(() => {
    if (draggedRef.current) return;
    onClick();
  }, [onClick]);

  const handleDoubleClick = useCallback(() => {
    onToggleCollapsed?.();
  }, [onToggleCollapsed]);

  return (
    <motion.div
      style={{ ...cornerStyle(corner), x, y }}
      drag
      dragControls={dragControls}
      dragMomentum={false}
      dragElastic={0.2}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      whileDrag={{ scale: 1.1, cursor: "grabbing" }}
    >
      <IronAvatar state={state} collapsed={collapsed} size={72} />
    </motion.div>
  );
}
