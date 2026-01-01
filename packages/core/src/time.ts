import { DateTime } from 'luxon';

export function toZonedDateTime(input: number | Date, timezone: string): DateTime {
  const millis = typeof input === 'number' ? input : input.getTime();
  return DateTime.fromMillis(millis, { zone: 'utc' }).setZone(timezone);
}

export function toISODate(input: number | Date, timezone: string): string {
  return toZonedDateTime(input, timezone).toISODate() ?? '';
}

export function toLocalTimeHHmm(input: number | Date, timezone: string): string {
  return toZonedDateTime(input, timezone).toFormat('HH:mm');
}
