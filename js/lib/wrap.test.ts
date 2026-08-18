import { describe, expect, it } from "vitest";
import { wrapLines } from "./wrap";

describe("wrapLines", () => {
  it("keeps short text on one line", () => {
    expect(wrapLines("weinig grind", 30)).toEqual(["weinig grind"]);
  });

  it("breaks between words at the budget", () => {
    expect(wrapLines("een twee drie vier", 9)).toEqual(["een twee", "drie vier"]);
  });

  it("never breaks inside a word", () => {
    expect(wrapLines("zandhoudend klei", 6)).toEqual(["zandhoudend", "klei"]);
  });

  it("collapses whitespace runs", () => {
    expect(wrapLines("  gray   ZMGO ", 30)).toEqual(["gray ZMGO"]);
  });

  it("returns no lines for empty text", () => {
    expect(wrapLines("", 30)).toEqual([]);
  });
});
