import { describe, expect, it } from "vitest";
import { DenseStatusSet, STATUS_COUNT, STATUS_IDS, statusIndex } from "../../../src/index.ts";

describe("DenseStatusSet (builder unit tests)", () => {
  it("statusIndex is a dense bijection over STATUS_IDS", () => {
    const seen = new Set<number>();
    for (const id of STATUS_IDS) {
      const i = statusIndex(id);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(STATUS_COUNT);
      seen.add(i);
    }
    expect(seen.size).toBe(STATUS_COUNT);
  });

  it("stacksAt reads the same entry as stacks(id); entries are independent", () => {
    const set = new DenseStatusSet();
    STATUS_IDS.forEach((id, n) => set.add(id, n + 1));
    for (const [n, id] of STATUS_IDS.entries()) {
      expect(set.stacks(id)).toBe(n + 1);
      expect(set.stacksAt(statusIndex(id))).toBe(n + 1);
    }
    set.remove("thorns", 100);
    expect(set.has("thorns")).toBe(false);
    expect(set.stacks("leeching")).toBe(statusIndex("leeching") + 1);
  });

  it("non-positive amounts do nothing; removing from an absent entry stays at 0", () => {
    const set = new DenseStatusSet();
    set.add("burning", 0);
    set.add("burning", -3);
    expect(set.has("burning")).toBe(false);
    set.remove("burning", 2);
    expect(set.stacks("burning")).toBe(0);
    set.add("burning", 4);
    set.remove("burning", -1);
    set.remove("burning", 0);
    expect(set.stacks("burning")).toBe(4);
  });

  it("stacks are uncapped integers (50 or 1,000,000 cost the same)", () => {
    const set = new DenseStatusSet();
    set.add("bleeding", 1_000_000);
    set.add("bleeding", 1_000_000);
    expect(set.stacks("bleeding")).toBe(2_000_000);
  });

  it("out-of-range indices read as 0", () => {
    const set = new DenseStatusSet();
    expect(set.stacksAt(-1)).toBe(0);
    expect(set.stacksAt(STATUS_COUNT)).toBe(0);
  });
});
