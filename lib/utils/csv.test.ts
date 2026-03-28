import { describe, expect, it } from "vitest";

import { escapeCSV } from "./csv";

describe("escapeCSV", () => {
  it("passes plain string through unchanged", () => {
    expect(escapeCSV("hello world")).toBe("hello world");
  });

  it("quotes string containing commas", () => {
    expect(escapeCSV("hello, world")).toBe('"hello, world"');
  });

  it("escapes and quotes string containing double quotes", () => {
    expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes string containing newlines", () => {
    expect(escapeCSV("line1\nline2")).toBe('"line1\nline2"');
  });

  it("passes empty string through unchanged", () => {
    expect(escapeCSV("")).toBe("");
  });
});
