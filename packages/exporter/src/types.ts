import type { EventType } from '@pinetree/core';

export type ExportEvent = {
  createdAt: Date;
  eventType: EventType;
  userName: string;
  text?: string | null;
};

export type DailySummaryRow = {
  date: string; // YYYY-MM-DD local
  userName: string;
  shiftStartTime?: string | undefined;
  shiftEndTime?: string | undefined;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  incomplete: boolean;
};
