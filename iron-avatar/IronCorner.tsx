// apps/web/src/lib/iron/IronCorner.tsx
// Draggable bottom-right wrapper that positions IronAvatar on the screen.
// Persists position to localStorage. Snaps to nearest corner on release.
// Z-index: 9998 (Flare drawer is 9999 so bug reports always win).

import { motion, useDragControls, useMotionValue } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { IronAvatar, type IronState } from './avatar/IronAvatar';

interface IronCornerProps {
  state: IronState;
  onClick: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

type Corner = 'br' | 'bl' | 'tr' | 'tl';

interface StoredPosition {
  corner: Corner;
  offsetX: number;
  offsetY: number;
}

const STORAGE_KEY = 'iron:avatar:position';
const PADDING = 20;

function loadPosition(): StoredPosition {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { corner: 'br', offsetX: PADDING, offsetY: PADDING };
}

function savePosition(pos: StoredPosition) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {}
}

function computeCorner(x: number, y: number): Corner {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const right = x > w / 2;
  const bottom = y > h / 2;
  if (bottom && right) return 'br';
  if (bottom && !right) return 'bl';
  if (!bottom && right) return 'tr';
  return 'tl';
}

function cornerStyle(corner: Corner): React.CSSProperties {
  const style: React.CSSProperties = { position: 'fixed', zIndex: 9998 };
  switch (corner) {
    case 'br':
      style.right = PADDING;
      style.bottom = `calc(${PADDING}px + env(safe-area-inset-bottom, 0px))`;
      break;
    case 'bl':
      style.left = PADDING;
      style.bottom = `calc(${PADDING}px + env(safe-area-inset-bottom, 0px))`;
      break;
    case 'tr':
      style.right = PADDING;
      style.top = `calc(${PADDING}px + env(safe-area-inset-top, 0px))`;
      break;
    case 'tl':
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
  const [corner, setCorner] = useState<Corner>(() => loadPosition().corner);
  const dragControls = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const draggedRef = useRef(false);

  // Reset motion values when corner changes (snap)
  useEffect(() => {
    x.set(0);
    y.set(0);
  }, [corner, x, y]);

  function handleDragEnd(_e: MouseEvent | TouchEvent | PointerEvent, info: { point: { x: number; y: number } }) {
    draggedRef.current = true;
    const newCorner = computeCorner(info.point.x, info.point.y);
    setCorner(newCorner);
    savePosition({ corner: newCorner, offsetX: PADDING, offsetY: PADDING });
    // Suppress the click that follows a drag
    setTimeout(() => { draggedRef.current = false; }, 50);
  }

  function handleClick() {
    if (draggedRef.current) return;
    onClick();
  }

  function handleDoubleClick() {
    onToggleCollapsed?.();
  }

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
      whileDrag={{ scale: 1.1, cursor: 'grabbing' }}
    >
      <IronAvatar
        state={state}
        collapsed={collapsed}
        size={72}
      />
    </motion.div>
  );
}
