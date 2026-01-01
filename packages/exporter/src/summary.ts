import { EventType, toISODate, toLocalTimeHHmm } from "@pinetree/core";
import type { DailySummaryRow, ExportEvent } from "./types";

type BreakInterval = { start: Date; end: Date };

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

function clampInterval(interval: BreakInterval, min: Date, max: Date): BreakInterval | null {
  const start = interval.start < min ? min : interval.start;
  const end = interval.end > max ? max : interval.end;
  if (end <= start) return null;
  return { start, end };
}

export function buildDailySummary(events: ExportEvent[], timezone: string): DailySummaryRow[] {
  // Group by local date + user.
  const groups = new Map<string, ExportEvent[]>();

  for (const e of events) {
    const date = toISODate(e.createdAt, timezone);
    const key = `${date}::${e.userName}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const rows: DailySummaryRow[] = [];

  for (const [key, list] of groups) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const parts = key.split("::");
    const date = parts[0] ?? "";
    const userName = parts[1] ?? "";

    const shiftStart = list.find((e) => e.eventType === EventType.SHIFT_START);
    const shiftEnd = [...list].reverse().find((e) => e.eventType === EventType.SHIFT_END);

    const incomplete = !shiftStart || !shiftEnd;

    const breakIntervals: BreakInterval[] = [];
    let openBreak: Date | null = null;

    for (const e of list) {
      if (e.eventType === EventType.BREAK_START) {
        openBreak = e.createdAt;
      } else if (e.eventType === EventType.BREAK_END) {
        if (openBreak) {
          breakIntervals.push({ start: openBreak, end: e.createdAt });
          openBreak = null;
        }
      }
    }

    const shiftStartDate = shiftStart?.createdAt;
    const shiftEndDate = shiftEnd?.createdAt;

    let totalBreakMinutes = 0;
    if (shiftStartDate && shiftEndDate) {
      for (const interval of breakIntervals) {
        const clamped = clampInterval(interval, shiftStartDate, shiftEndDate);
        if (!clamped) continue;
        totalBreakMinutes += minutesBetween(clamped.start, clamped.end);
      }
    }

    let totalWorkedMinutes = 0;
    if (shiftStartDate && shiftEndDate) {
      totalWorkedMinutes = minutesBetween(shiftStartDate, shiftEndDate) - totalBreakMinutes;
      totalWorkedMinutes = Math.max(0, totalWorkedMinutes);
    }

    rows.push({
      date,
      userName,
      shiftStartTime: shiftStartDate ? toLocalTimeHHmm(shiftStartDate, timezone) : undefined,
      shiftEndTime: shiftEndDate ? toLocalTimeHHmm(shiftEndDate, timezone) : undefined,
      totalBreakMinutes,
      totalWorkedMinutes,
      incomplete,
    });
  }

  rows.sort((a, b) => {
    // YYYY-MM-DD sorts correctly as a string.
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.userName.localeCompare(b.userName);
  });

  return rows;
}
