/**
 * Pure routing helpers for the GraphExplorer. Lives in its own file so unit
 * tests can import it without dragging in the supabase client.
 */

import type { QrmSearchItem } from "../lib/types";

/**
 * Map a search result to the canonical detail route. Exported for unit
 * testing — the routing contract is the thing that must not break as new
 * entity types are added.
 */
export function hrefForGraphResult(item: QrmSearchItem): string {
  switch (item.type) {
    case "contact":
      return `/qrm/contacts/${item.id}`;
    case "company":
      return `/qrm/companies/${item.id}`;
    case "deal":
      return `/qrm/deals/${item.id}`;
    case "equipment":
      return `/qrm/inventory-pressure?equipment=${item.id}`;
    case "rental":
      return `/qrm/rentals?request=${item.id}`;
  }
}
