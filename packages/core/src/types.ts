export enum EventType {
  SHIFT_START = "SHIFT_START",
  BREAK_START = "BREAK_START",
  BREAK_END = "BREAK_END",
  SHIFT_END = "SHIFT_END",
  STATUS = "STATUS",
}

export type ParsedEvent =
  | { eventType: EventType.SHIFT_START }
  | { eventType: EventType.BREAK_START }
  | { eventType: EventType.BREAK_END }
  | { eventType: EventType.SHIFT_END }
  | { eventType: EventType.STATUS; text?: string };

export type ViberUser = {
  viberUserId: string;
  name: string;
  avatarUrl?: string;
};

export type ViberChat = {
  viberChatId: string;
  name?: string;
};

export type PayloadContext = {
  timezone: string;
  source: "button" | "command" | "free_text" | "unknown";
};
