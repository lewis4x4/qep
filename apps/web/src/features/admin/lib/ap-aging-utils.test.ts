import { describe, expect, test } from "bun:test";
import { bucketAge, labelAgeBucket, sumApAmounts } from "./ap-aging-utils";

describe("ap-aging-utils", () => {
  test("buckets ages", () => {
    expect(bucketAge(0)).toBe("current");
    expect(bucketAge(45)).toBe("31_60");
    expect(bucketAge(75)).toBe("61_90");
    expect(bucketAge(100)).toBe("91_120");
    expect(bucketAge(180)).toBe("over_120");
  });

  test("labels buckets", () => {
    expect(labelAgeBucket("over_120")).toBe("Over 120");
  });

  test("sums balances", () => {
    expect(sumApAmounts([{ balance_due: 10 }, { balance_due: 12.5 }])).toBe(22.5);
  });
});
