import { describe, expect, it } from "vitest";
import { EventType } from "@pinetree/core";
import { buildDailySummary } from "../src/summary";

function d(iso: string): Date {
  return new Date(iso);
}

describe("buildDailySummary", () => {
  it("computes worked and break minutes", () => {
    const events = [
      { createdAt: d("2026-01-01T03:30:00.000Z"), eventType: EventType.SHIFT_START, userName: "A" },
      { createdAt: d("2026-01-01T05:00:00.000Z"), eventType: EventType.BREAK_START, userName: "A" },
      { createdAt: d("2026-01-01T05:30:00.000Z"), eventType: EventType.BREAK_END, userName: "A" },
      { createdAt: d("2026-01-01T07:30:00.000Z"), eventType: EventType.SHIFT_END, userName: "A" },
    ];

    const rows = buildDailySummary(events, "UTC");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalBreakMinutes).toBe(30);
    expect(rows[0]?.totalWorkedMinutes).toBe(210);
    expect(rows[0]?.incomplete).toBe(false);
  });

  it("marks incomplete if missing end", () => {
    const events = [
      { createdAt: d("2026-01-01T03:30:00.000Z"), eventType: EventType.SHIFT_START, userName: "A" },
    ];

    const rows = buildDailySummary(events, "UTC");
    expect(rows[0]?.incomplete).toBe(true);
    expect(rows[0]?.totalWorkedMinutes).toBe(0);
  });
});
