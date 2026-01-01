import { toISODate, toLocalTimeHHmm } from "@pinetree/core";
import type { ExportEvent } from "./types";

function csvEscape(value: string | number | boolean | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[\n\r,"]/u.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function eventsToCsv(events: ExportEvent[], timezone: string): Buffer {
  const header = ["Date", "User", "Event type", "Time (local)", "Notes/status text"];

  const lines: string[] = [header.map(csvEscape).join(",")];

  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const e of sorted) {
    const row = [
      toISODate(e.createdAt, timezone),
      e.userName,
      e.eventType,
      toLocalTimeHHmm(e.createdAt, timezone),
      e.text ?? "",
    ];
    lines.push(row.map(csvEscape).join(","));
  }

  return Buffer.from(lines.join("\n"), "utf8");
}
