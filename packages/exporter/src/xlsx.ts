import ExcelJS from 'exceljs';
import { toISODate, toLocalTimeHHmm } from '@pinetree/core';
import type { ExportEvent } from './types';
import { buildDailySummary } from './summary';

export async function eventsToXlsx(events: ExportEvent[], timezone: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'pinetree';

  const wsEvents = workbook.addWorksheet('Events');
  wsEvents.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'User', key: 'user', width: 24 },
    { header: 'Event type', key: 'eventType', width: 14 },
    { header: 'Time (local)', key: 'time', width: 12 },
    { header: 'Notes/status text', key: 'notes', width: 50 },
  ];

  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const e of sorted) {
    wsEvents.addRow({
      date: toISODate(e.createdAt, timezone),
      user: e.userName,
      eventType: e.eventType,
      time: toLocalTimeHHmm(e.createdAt, timezone),
      notes: e.text ?? '',
    });
  }

  const wsSummary = workbook.addWorksheet('Daily Summary');
  wsSummary.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'User', key: 'user', width: 24 },
    { header: 'Shift start time', key: 'start', width: 16 },
    { header: 'Shift end time', key: 'end', width: 16 },
    { header: 'Total break duration (min)', key: 'breakMin', width: 24 },
    { header: 'Total worked duration (min)', key: 'workedMin', width: 24 },
    { header: 'Incomplete', key: 'incomplete', width: 12 },
  ];

  const summary = buildDailySummary(events, timezone);
  for (const row of summary) {
    wsSummary.addRow({
      date: row.date,
      user: row.userName,
      start: row.shiftStartTime ?? '',
      end: row.shiftEndTime ?? '',
      breakMin: row.totalBreakMinutes,
      workedMin: row.totalWorkedMinutes,
      incomplete: row.incomplete ? 'Yes' : 'No',
    });
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}
