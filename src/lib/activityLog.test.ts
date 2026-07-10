import { beforeEach, describe, expect, test } from "bun:test";

import {
  MAX_EVENTS,
  clearActivity,
  filterActivity,
  getActivity,
  logActivity,
  subscribeActivity,
} from "./activityLog";

beforeEach(() => clearActivity());

describe("logActivity", () => {
  test("records events newest first", () => {
    logActivity("git", "Committed 3 files");
    logActivity("terminal", "Shell exited (code 0)");
    const list = getActivity();
    expect(list.length).toBe(2);
    expect(list[0].message).toBe("Shell exited (code 0)");
    expect(list[0].kind).toBe("terminal");
    expect(list[1].kind).toBe("git");
  });

  test("ignores blank messages", () => {
    logActivity("info", "   ");
    expect(getActivity()).toEqual([]);
  });

  test("collapses rapid identical duplicates", () => {
    logActivity("info", "Saving…");
    logActivity("info", "Saving…");
    logActivity("info", "Saving…");
    expect(getActivity().length).toBe(1);
  });

  test("same message with different kind is kept", () => {
    logActivity("info", "Build finished");
    logActivity("success", "Build finished");
    expect(getActivity().length).toBe(2);
  });

  test("caps the log at MAX_EVENTS", () => {
    for (let i = 0; i < MAX_EVENTS + 25; i++) {
      logActivity("info", `event ${i}`);
    }
    const list = getActivity();
    expect(list.length).toBe(MAX_EVENTS);
    expect(list[0].message).toBe(`event ${MAX_EVENTS + 24}`);
  });

  test("notifies subscribers and snapshot identity is stable between writes", () => {
    let calls = 0;
    const unsub = subscribeActivity(() => calls++);
    logActivity("app", "Started");
    expect(calls).toBe(1);
    const a = getActivity();
    const b = getActivity();
    expect(a).toBe(b); // same identity until the next mutation
    logActivity("app", "Changed");
    expect(getActivity()).not.toBe(a);
    unsub();
    logActivity("app", "After unsub");
    expect(calls).toBe(2);
  });
});

describe("filterActivity", () => {
  test("filters by query (case-insensitive) and kind set", () => {
    logActivity("git", "Committed: fix flux capacitor");
    logActivity("terminal", "Terminal bell");
    logActivity("error", "Commit failed: nothing staged");
    const list = getActivity();

    expect(filterActivity(list, "commit", null).length).toBe(2);
    expect(filterActivity(list, "COMMIT", new Set(["git"])).length).toBe(1);
    expect(filterActivity(list, "", new Set(["terminal"]))[0].message).toBe("Terminal bell");
    expect(filterActivity(list, "zzz", null)).toEqual([]);
  });
});
