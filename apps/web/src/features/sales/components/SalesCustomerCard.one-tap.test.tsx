import { describe, expect, test } from "bun:test";
import { getOneTapLogFailureToast } from "./SalesCustomerCard";

describe("SalesCustomerCard one-tap logging", () => {
  test("returns operator-safe feedback content for call/email logging failures", () => {
    expect(getOneTapLogFailureToast("call")).toEqual({
      title: "Call log not saved",
      description: "Call will continue, but activity logging failed.",
      variant: "destructive",
    });
    expect(getOneTapLogFailureToast("email")).toEqual({
      title: "Email log not saved",
      description: "Email will continue, but activity logging failed.",
      variant: "destructive",
    });
  });
});
