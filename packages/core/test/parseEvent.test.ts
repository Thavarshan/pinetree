import { describe, expect, it } from "vitest";
import { parseEvent } from "../src/parseEvent";
import { EventType } from "../src/types";

describe("parseEvent", () => {
  it("parses button labels", () => {
    const r = parseEvent("🟢 Start shift", { timezone: "Asia/Colombo", source: "button" });
    expect(r).toEqual({ kind: "event", eventType: EventType.SHIFT_START });
  });

  it("parses slash commands", () => {
    const r = parseEvent("/break_start", { timezone: "Asia/Colombo", source: "command" });
    expect(r).toEqual({ kind: "event", eventType: EventType.BREAK_START });
  });

  it("parses /status with text", () => {
    const r = parseEvent("/status Working on export", {
      timezone: "Asia/Colombo",
      source: "command",
    });
    expect(r).toEqual({ kind: "event", eventType: EventType.STATUS, text: "Working on export" });
  });

  it("returns status_pending for /status without text", () => {
    const r = parseEvent("/status", { timezone: "Asia/Colombo", source: "command" });
    expect(r).toEqual({ kind: "status_pending" });
  });

  it("maps free text synonyms", () => {
    const r = parseEvent("Started", { timezone: "Asia/Colombo", source: "free_text" });
    expect(r).toEqual({ kind: "event", eventType: EventType.SHIFT_START });
  });

  it("handles menu", () => {
    const r = parseEvent("menu", { timezone: "Asia/Colombo", source: "unknown" });
    expect(r).toEqual({ kind: "menu" });
  });
});
