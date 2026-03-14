export enum EventType {
  SHIFT_START = 'SHIFT_START',
  BREAK_START = 'BREAK_START',
  BREAK_END = 'BREAK_END',
  SHIFT_END = 'SHIFT_END',
  STATUS = 'STATUS',
  SUPPLY_REQUEST = 'SUPPLY_REQUEST',
  CONCERN = 'CONCERN',
  CREW_OFF = 'CREW_OFF',
}

export type ParsedEvent =
  | { eventType: EventType.SHIFT_START }
  | { eventType: EventType.BREAK_START }
  | { eventType: EventType.BREAK_END }
  | { eventType: EventType.SHIFT_END }
  | { eventType: EventType.STATUS; text?: string }
  | { eventType: EventType.SUPPLY_REQUEST }
  | { eventType: EventType.CONCERN; text?: string }
  | { eventType: EventType.CREW_OFF; text?: string };

export type PayloadContext = {
  timezone: string;
  source: 'button' | 'command' | 'free_text' | 'unknown';
};
