import { expect, test } from "bun:test";
import { weightedPipelineValue } from "./pipeline-totals";
test("weights by configured probability rather than stage position", () => {
  expect(weightedPipelineValue([{ amount: 10000, stage_probability: 15 }, { amount: 50000, stage_probability: 70 }])).toBe(36500);
});
test("unknown probability cannot become a fabricated forecast or true zero", () => {
  expect(weightedPipelineValue([{ amount: 10000 }])).toBeNull();
  expect(weightedPipelineValue([{ amount: 10000, stage_probability: 110 }])).toBeNull();
  expect(weightedPipelineValue([])).toBe(0);
});
