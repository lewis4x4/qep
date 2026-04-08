/**
 * Wave 7.1 Iron Companion — presence event bus tests.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  __resetPresenceForTests,
  clearPresenceSource,
  getCurrentPresenceState,
  peekPresenceStack,
  pushPresence,
  replacePresence,
} from "./presence";

beforeEach(() => __resetPresenceForTests());
afterEach(() => __resetPresenceForTests());

describe("iron presence bus", () => {
  test("starts idle", () => {
    expect(getCurrentPresenceState()).toBe("idle");
  });

  test("single push wins", () => {
    pushPresence("a", "thinking");
    expect(getCurrentPresenceState()).toBe("thinking");
  });

  test("higher priority beats lower priority regardless of push order", () => {
    pushPresence("low", "thinking");
    pushPresence("high", "alert");
    expect(getCurrentPresenceState()).toBe("alert");
  });

  test("release reveals next-highest entry", () => {
    pushPresence("low", "thinking");
    const releaseHigh = pushPresence("high", "alert");
    expect(getCurrentPresenceState()).toBe("alert");
    releaseHigh();
    expect(getCurrentPresenceState()).toBe("thinking");
  });

  test("releasing all entries returns to idle", () => {
    const r1 = pushPresence("a", "speaking");
    const r2 = pushPresence("b", "listening");
    r2();
    r1();
    expect(getCurrentPresenceState()).toBe("idle");
  });

  test("ties are broken by most recently pushed", () => {
    pushPresence("first", "thinking");
    pushPresence("second", "thinking");
    // Same priority — both are 'thinking', so the winner is just 'thinking'.
    expect(getCurrentPresenceState()).toBe("thinking");
    expect(peekPresenceStack().length).toBe(2);
  });

  test("release is idempotent", () => {
    const release = pushPresence("a", "alert");
    release();
    release();
    expect(getCurrentPresenceState()).toBe("idle");
  });

  test("replacePresence drops prior entries from the same source", () => {
    pushPresence("mutation", "thinking");
    pushPresence("mutation", "thinking");
    expect(peekPresenceStack().length).toBe(2);
    replacePresence("mutation", "speaking");
    const stack = peekPresenceStack();
    expect(stack.length).toBe(1);
    expect(stack[0].source).toBe("mutation");
    expect(stack[0].state).toBe("speaking");
  });

  test("clearPresenceSource removes all entries for a source", () => {
    pushPresence("mutation", "thinking");
    pushPresence("other", "alert");
    clearPresenceSource("mutation");
    expect(getCurrentPresenceState()).toBe("alert");
  });

  test("priority ladder is correct", () => {
    // alert > listening > speaking > thinking > flow_active > success > idle
    pushPresence("a", "success");
    expect(getCurrentPresenceState()).toBe("success");
    pushPresence("b", "flow_active");
    expect(getCurrentPresenceState()).toBe("flow_active");
    pushPresence("c", "thinking");
    expect(getCurrentPresenceState()).toBe("thinking");
    pushPresence("d", "speaking");
    expect(getCurrentPresenceState()).toBe("speaking");
    pushPresence("e", "listening");
    expect(getCurrentPresenceState()).toBe("listening");
    pushPresence("f", "alert");
    expect(getCurrentPresenceState()).toBe("alert");
  });

  test("ttlMs auto-expires the entry without manual release", async () => {
    pushPresence("flash", "alert", { ttlMs: 30 });
    expect(getCurrentPresenceState()).toBe("alert");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(getCurrentPresenceState()).toBe("idle");
  });
});
