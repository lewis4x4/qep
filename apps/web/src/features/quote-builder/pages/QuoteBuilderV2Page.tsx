import { useQuoteBuilderV2Orchestrator } from "../hooks/useQuoteBuilderV2Orchestrator";

export function QuoteBuilderV2Page() {
  const content = useQuoteBuilderV2Orchestrator();

  return (
    <>
      <h1 className="sr-only">Quote Builder</h1>
      {content}
    </>
  );
}
