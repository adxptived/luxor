import { afterEach, expect, test } from "bun:test";

import { clearLogs, getLogs, latestStartup, logsAsText, pushLog, subscribeLogs } from "./logBuffer";

afterEach(() => clearLogs());

test("pushLog records lines newest-last with ids", () => {
  pushLog("first");
  pushLog("second");
  const logs = getLogs();
  expect(logs.map((l) => l.text)).toEqual(["first", "second"]);
  expect(logs[1].id).toBeGreaterThan(logs[0].id);
});

test("ring buffer caps the number of retained lines", () => {
  for (let i = 0; i < 800; i++) pushLog(`line-${i}`);
  const logs = getLogs();
  expect(logs.length).toBe(600);
  // Oldest dropped, newest kept.
  expect(logs[0].text).toBe("line-200");
  expect(logs[logs.length - 1].text).toBe("line-799");
});

test("logsAsText joins entries with timestamps", () => {
  pushLog("hello");
  const text = logsAsText();
  expect(text).toContain("hello");
  expect(text).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
});

test("clearLogs empties the buffer", () => {
  pushLog("x");
  clearLogs();
  expect(getLogs()).toEqual([]);
});

test("subscribeLogs notifies on push and unsubscribes", () => {
  let hits = 0;
  const off = subscribeLogs(() => hits++);
  pushLog("a");
  pushLog("b");
  expect(hits).toBe(2);
  off();
  pushLog("c");
  expect(hits).toBe(2);
});

test("latestStartup parses the most recent STARTUP line", () => {
  pushLog("STARTUP firstPaint=100ms jsReady=200ms");
  pushLog("ERROR something");
  pushLog("STARTUP firstPaint=120ms jsReady=210ms appReady=320ms");
  expect(latestStartup()).toEqual({
    firstPaint: "120ms",
    jsReady: "210ms",
    appReady: "320ms",
  });
});

test("latestStartup returns null with no startup line", () => {
  pushLog("ERROR only");
  expect(latestStartup()).toBeNull();
});
