import { z } from "zod";
import { EventType, type ParsedEvent, type PayloadContext } from "./types";

const Normalized = z
  .string()
  .transform((s) => s.trim())
  .transform((s) => s.replace(/\s+/g, " "))
  .transform((s) => s.toLowerCase());

function normalize(input: string): string {
  return Normalized.parse(input);
}

const freeTextSynonyms: Array<{ eventType: EventType; words: string[] }> = [
  { eventType: EventType.SHIFT_START, words: ["start", "started", "login", "clock in", "in"] },
  { eventType: EventType.BREAK_START, words: ["break", "break start", "tea", "lunch", "pause"] },
  { eventType: EventType.BREAK_END, words: ["break end", "back", "resume"] },
  { eventType: EventType.SHIFT_END, words: ["end", "ended", "logout", "clock out", "out"] },
];

const buttonMap: Record<string, ParsedEvent> = {
  "🟢 start shift": { eventType: EventType.SHIFT_START },
  "☕ break start": { eventType: EventType.BREAK_START },
  "✅ break end": { eventType: EventType.BREAK_END },
  "🔴 end shift": { eventType: EventType.SHIFT_END },
  "📝 status update": { eventType: EventType.STATUS },
};

export type ParseResult =
  | ({ kind: "event" } & ParsedEvent)
  | { kind: "menu" }
  | { kind: "status_pending" }
  | { kind: "none" };

export function parseEvent(messageText: string | undefined | null, ctx: PayloadContext): ParseResult {
  const raw = (messageText ?? "").trim();
  if (!raw) return { kind: "none" };

  // Handle slash commands first so we can preserve any user-provided text.
  if (raw.startsWith("/")) {
    const [cmdRaw, ...restRaw] = raw.split(/\s+/);
    const cmd = normalize(cmdRaw ?? "");
    const tail = restRaw.join(" ").trim();

    switch (cmd) {
      case "/start":
        return { kind: "event", eventType: EventType.SHIFT_START };
      case "/break_start":
        return { kind: "event", eventType: EventType.BREAK_START };
      case "/break_end":
        return { kind: "event", eventType: EventType.BREAK_END };
      case "/end":
        return { kind: "event", eventType: EventType.SHIFT_END };
      case "/status":
        if (tail) return { kind: "event", eventType: EventType.STATUS, text: tail };
        return { kind: "status_pending" };
      default:
        return { kind: "none" };
    }
  }

  const normalized = normalize(raw);

  if (normalized === "menu") {
    return { kind: "menu" };
  }

  // Button replies are just message text; match against known button labels.
  const button = buttonMap[normalized];
  if (button) {
    if (button.eventType === EventType.STATUS) return { kind: "status_pending" };
    return { kind: "event", ...button };
  }

  // Free text synonym mapping (simple contains check)
  if (ctx.source === "free_text" || ctx.source === "unknown") {
    for (const mapping of freeTextSynonyms) {
      for (const word of mapping.words) {
        if (normalized === word || normalized.includes(word)) {
          return { kind: "event", eventType: mapping.eventType };
        }
      }
    }
  }

  return { kind: "none" };
}
