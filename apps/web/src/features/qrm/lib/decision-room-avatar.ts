/**
 * Decision Room — archetype portrait lookup.
 *
 * Ghost seats represent a *role*, not a specific person. We render an
 * archetype portrait behind the dashed ghost ring so the room feels like
 * a real conference table instead of a lineup of question marks. Each
 * image is a stylized stand-in — not a real contact — so we only use it
 * when the seat is a pure-archetype ghost.
 */
import type { SeatArchetype } from "./decision-room-archetype";

export const ARCHETYPE_AVATAR: Record<SeatArchetype, string> = {
  champion: "/avatars/archetypes/champion.png",
  economic_buyer: "/avatars/archetypes/economic-buyer.png",
  operations: "/avatars/archetypes/operations.png",
  procurement: "/avatars/archetypes/procurement.png",
  operator: "/avatars/archetypes/operator.png",
  maintenance: "/avatars/archetypes/maintenance.png",
  executive_sponsor: "/avatars/archetypes/executive-sponsor.png",
};
