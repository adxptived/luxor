import { describe, expect, test } from "bun:test";

import {
  csvField,
  exportName,
  formatRange,
  nextSort,
  pageCount,
  toCsv,
  toJson,
} from "./dbHelpers";

describe("nextSort", () => {
  test("cycles none → asc → desc → none on the same column", () => {
    let s = nextSort(null, "name");
    expect(s).toEqual({ column: "name", desc: false });
    s = nextSort(s, "name");
    expect(s).toEqual({ column: "name", desc: true });
    s = nextSort(s, "name");
    expect(s).toBeNull();
  });

  test("switching columns starts at ascending", () => {
    expect(nextSort({ column: "a", desc: true }, "b")).toEqual({ column: "b", desc: false });
  });
});

describe("pageCount", () => {
  test("rounds up and never goes below 1", () => {
    expect(pageCount(0, 200)).toBe(1);
    expect(pageCount(200, 200)).toBe(1);
    expect(pageCount(201, 200)).toBe(2);
    expect(pageCount(1024, 200)).toBe(6);
  });
});

describe("formatRange", () => {
  test("formats a 1-based clamped range", () => {
    expect(formatRange(0, 200, 1024)).toBe("1\u2013200 of 1,024");
    expect(formatRange(5, 200, 1024)).toBe("1,001\u20131,024 of 1,024");
  });
  test("handles an empty table", () => {
    expect(formatRange(0, 200, 0)).toBe("0 of 0");
  });
});

describe("csvField", () => {
  test("quotes fields with comma, quote or newline", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsv", () => {
  test("renders header + rows with CRLF", () => {
    const csv = toCsv(["id", "name"], [["1", "a,b"], ["2", "c"]]);
    expect(csv).toBe('id,name\r\n1,"a,b"\r\n2,c');
  });
  test("header only when no rows", () => {
    expect(toCsv(["id"], [])).toBe("id");
  });
});

describe("toJson", () => {
  test("maps rows to objects keyed by column", () => {
    const json = JSON.parse(toJson(["id", "name"], [["1", "x"]]));
    expect(json).toEqual([{ id: "1", name: "x" }]);
  });
});

describe("exportName", () => {
  test("sanitises to a safe stem", () => {
    expect(exportName("my table!")).toBe("my_table");
    expect(exportName("users")).toBe("users");
    expect(exportName("///")).toBe("export");
  });
});
