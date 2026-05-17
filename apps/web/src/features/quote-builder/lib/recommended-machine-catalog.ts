import { buildCatalogQueryCandidates } from "./catalog-query-candidates";
import {
  normalizeMachineMatchLabel,
  type CatalogEntryMatch,
} from "./quote-builder-page-helpers";

export async function findRecommendedCatalogMatch(
  machine: string,
  searchCatalog: (query: string) => Promise<CatalogEntryMatch[]>,
): Promise<CatalogEntryMatch | undefined> {
  const candidateQueries = buildCatalogQueryCandidates(machine);
  const expectedMachine = normalizeMachineMatchLabel(machine);
  for (const query of candidateQueries) {
    const matches = await searchCatalog(query);
    const exactMatch = matches.find((match) =>
      normalizeMachineMatchLabel(`${match.make} ${match.model}`) === expectedMachine);
    if (exactMatch || matches.length > 0) {
      return exactMatch ?? matches[0];
    }
  }
  return undefined;
}
