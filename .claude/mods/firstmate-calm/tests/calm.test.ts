// firstmate-calm under `claude plugin test`: the Calm toggle, its persisted per-home
// preference, and the transcript rows Calm hides and restores.
import { describe, expect, test, type Engine } from "claude-code/testing";
import {
  assistantMessage,
  calmCommand,
  fromFirstmate,
  HOME,
  isGrey,
  isHidden,
  isStock,
  operational,
  PREFERENCE,
  spinner,
  submission,
  toolGroup,
  toolResult,
  toolUse,
  userMessage,
  world,
} from "./support.ts";

const sessionStart = { cwd: "/work", surface: "terminal" as const, isInteractive: true };

describe("activation", () => {
  async function expectInert($: Engine, on: Parameters<typeof world>[0], functionHooks: string | undefined) {
    const { clock, journal } = world(on, {
      functionHooks,
      preference: "on\n",
      messages: [{ role: "assistant", text: "Working", toolUses: [{ name: "Bash" }] }],
    });
    await $.session.start(sessionStart);
    const drawings = await Promise.all([
      $.ui.render(spinner()),
      $.ui.render(toolUse()),
      $.ui.render(toolResult()),
      $.ui.render(toolGroup()),
      $.ui.render(userMessage(operational("watcher", "signal: x"))),
      $.ui.render(assistantMessage("Working")),
    ]);
    expect(drawings.every(isStock)).toBe(true);
    await clock.advance(220 * 8);
    expect(journal.commands).toHaveLength(0);
    expect(journal.blits).toHaveLength(0);
    expect(journal.invalidations).toHaveLength(0);
    expect(journal.toasts).toHaveLength(0);
    expect(journal.fsReads).toHaveLength(0);
    expect(journal.sessionMessageReads).toBe(0);
    expect(journal.configLists).toBe(0);
  }

  test("is fully inert when the function-hooks opt-in is absent", async ($, on) => {
    await expectInert($, on, undefined);
  });

  test("is fully inert when the function-hooks opt-in is not exactly one", async ($, on) => {
    await expectInert($, on, "true");
  });

  test("registers /calm at session start and stays a pass-through while off", async ($, on) => {
    const { clock, journal } = world(on);
    await $.session.start(sessionStart);
    expect(journal.commands).toEqual(["calm"]);
    expect(isStock(await $.ui.render(spinner()))).toBe(true);
    expect(isStock(await $.ui.render(toolUse()))).toBe(true);
    expect(isStock(await $.ui.render(toolResult()))).toBe(true);
    expect(isStock(await $.ui.render(toolGroup()))).toBe(true);
    expect(isStock(await $.ui.render(userMessage(operational("watcher", "signal: x"))))).toBe(true);
    expect(isStock(await $.ui.render(assistantMessage("hello")))).toBe(true);
    await clock.advance(220 * 8);
    expect(journal.blits).toHaveLength(0);
    expect(journal.toasts).toHaveLength(0);
  });

  test("reads a persisted on before session start, so restored rows never draw with a stale off", async ($, on) => {
    world(on, { preference: "on\n" });
    expect(isHidden(await $.ui.render(toolUse()))).toBe(true);
    expect(isHidden(await $.ui.render(toolGroup()))).toBe(true);
  });

  test("reads the legacy max value as on", async ($, on) => {
    world(on, { preference: "max\n" });
    expect(isHidden(await $.ui.render(toolResult()))).toBe(true);
  });

  test("reads an unrecognized value as off", async ($, on) => {
    world(on, { preference: "maybe\n" });
    expect(isStock(await $.ui.render(toolUse()))).toBe(true);
  });
});

describe("/calm", () => {
  test("toggles on: persists on, toasts, redraws every hooked drawing, and leaves no output row", async ($, on) => {
    const { files, journal } = world(on);
    await $.session.start(sessionStart);
    expect(isStock(await $.ui.render(toolUse()))).toBe(true);
    const answer = await $.command.run(calmCommand());
    expect(answer.text).toBeUndefined();
    expect(files.get(PREFERENCE)).toBe("on\n");
    expect(journal.toasts).toEqual(["Calm on"]);
    expect(journal.invalidations).toContain("ui.render");
    expect(isHidden(await $.ui.render(toolUse()))).toBe(true);
    expect(isHidden(await $.ui.render(toolResult()))).toBe(true);
    expect(isHidden(await $.ui.render(toolGroup("g", true)))).toBe(true);
  });

  test("leaves the stock working row untouched while Calm is on", async ($, on) => {
    const { clock, journal } = world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    expect(isHidden(await $.ui.render(toolUse()))).toBe(true);
    expect(isStock(await $.ui.render(spinner()))).toBe(true);
    await clock.advance(220 * 8);
    expect(journal.blits).toHaveLength(0);
  });

  test("toggles off: persists off and restores the engine's drawings", async ($, on) => {
    const { files, journal } = world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    expect(isHidden(await $.ui.render(toolUse()))).toBe(true);
    await $.command.run(calmCommand());
    expect(files.get(PREFERENCE)).toBe("off\n");
    expect(journal.toasts).toEqual(["Calm off"]);
    expect(isStock(await $.ui.render(toolUse()))).toBe(true);
    expect(isStock(await $.ui.render(spinner()))).toBe(true);
  });

  test("keeps the current choice when the preference cannot be written", async ($, on) => {
    const { files, journal, failWrites } = world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    const redrawsBefore = journal.invalidations.length;
    failWrites("EACCES: read-only");
    await $.command.run(calmCommand());
    expect(files.get(PREFERENCE)).toBe("on\n");
    expect(isHidden(await $.ui.render(toolUse()))).toBe(true);
    expect(journal.toasts).toHaveLength(1);
    expect(journal.toasts[0]).toContain("Calm unchanged");
    expect(journal.toasts[0]).toContain(PREFERENCE);
    expect(journal.invalidations).toHaveLength(redrawsBefore);
  });

  test("writes under FM_CONFIG_OVERRIDE when that override names the config directory", async ($, on) => {
    const { files } = world(on, { env: { FM_CONFIG_OVERRIDE: "/elsewhere/cfg" } });
    await $.command.run(calmCommand());
    expect(files.get("/elsewhere/cfg/calm")).toBe("on\n");
    expect(files.has(PREFERENCE)).toBe(false);
  });

  test("falls back to FM_ROOT_OVERRIDE, then the tracked code root above the plugin, when FM_HOME is unset", async ($, on) => {
    const { files } = world(on, { home: undefined, env: { FM_ROOT_OVERRIDE: "/root/override" } });
    await $.command.run(calmCommand());
    expect(files.get("/root/override/config/calm")).toBe("on\n");
  });

  test("derives the home from the plugin folder when nothing names it", async ($, on) => {
    const { files } = world(on, { home: undefined });
    await $.command.run(calmCommand());
    const [path] = [...files.keys()];
    expect(path).toBeDefined();
    expect(path!).toEndWith("/config/calm");
    expect(path!.startsWith(HOME)).toBe(false);
    // Three levels above the plugin folder: the tracked code root, above `.claude/`.
    expect(path!).not.toContain("firstmate-calm/");
    expect(path!).not.toContain("/.claude/");
    expect(path!).not.toContain("/mods/");
  });
});

describe("operational user rows", () => {
  const hiddenTexts = [
    operational("session-start", "Run bin/fm-session-start.sh"),
    operational("watcher", "signal: /tmp/x.status changed"),
    operational("turn-end-guard", "supervision is off"),
    operational("away-supervisor", "escalate"),
    operational("launch-brief", "# Task"),
    operational("branch-outcome", "note"),
    operational("watcher", "multi\nline\n\nbody"),
    fromFirstmate("please look at the report"),
    // An unknown kind under the current prefix is the untyped legacy envelope.
    "\u2063FIRSTMATE_OP: unknown shape",
    "Run `bin/fm-session-start.sh` now, exactly once, before executing any other instructions.",
    "FIRSTMATE WATCHER WAKE: signal: x\n\nRun bin/fm-wake-drain.sh first and handle the queued wake. Watcher continuity is extension-owned.",
    "\u2063Supervisor escalate (needs you)",
    // A current prefix with no readable kind or body is the untyped legacy envelope.
    operational("watcher", "").replace(/ $/, ""),
  ];
  const visibleTexts = [
    "hello there",
    "'\u2063FIRSTMATE_OP: v1 watcher: quoted'",
    "FIRSTMATE_OP: v1 watcher: ascii only",
    "look: \u2063FIRSTMATE_OP: v1 watcher: text before the marker",
    "[fm-from-firstmate]\u2063",
    "\u2063FIRSTMATE_OP: ",
    "FIRSTMATE WATCHER WAKE: \n\nRun bin/fm-wake-drain.sh first and handle the queued wake. Watcher continuity is extension-owned.",
  ];

  test("hides every canonically classified operational input while on", async ($, on) => {
    world(on, { preference: "on\n" });
    for (const text of hiddenTexts) {
      expect(isHidden(await $.ui.render(userMessage(text))), JSON.stringify(text)).toBe(true);
    }
  });

  test("keeps every near miss and genuine prompt visible while on", async ($, on) => {
    world(on, { preference: "on\n" });
    for (const text of visibleTexts) {
      expect(isStock(await $.ui.render(userMessage(text))), JSON.stringify(text)).toBe(true);
    }
  });

  test("leaves every user row to the engine while off", async ($, on) => {
    world(on);
    for (const text of [...hiddenTexts, ...visibleTexts]) {
      expect(isStock(await $.ui.render(userMessage(text))), JSON.stringify(text)).toBe(true);
    }
  });
});

describe("assistant text", () => {
  test("keeps every mid-turn working note and reply visible while on", async ($, on) => {
    world(on, {
      preference: "on\n",
      messages: [
        { role: "user", text: "go", toolUses: [] },
        { role: "assistant", text: "Checking.", toolUses: [{}] },
        { role: "assistant", text: "Narration before a tool row", toolUses: [] },
        { role: "assistant", text: "", toolUses: [{}] },
        { role: "assistant", text: "The final answer", toolUses: [] },
      ],
    });
    await $.session.start(sessionStart);
    await $.ui.render(userMessage("go", "u0"));
    expect(isStock(await $.ui.render(assistantMessage("Checking.")))).toBe(true);
    expect(isStock(await $.ui.render(assistantMessage("Narration before a tool row")))).toBe(true);
    expect(isStock(await $.ui.render(assistantMessage("The final answer")))).toBe(true);
    expect(isHidden(await $.ui.render(toolUse()))).toBe(true);
  });
});

describe("fade history", () => {
  const stopHookNotice = "Stop hook feedback";

  test("draws every row as the engine does while Calm is off", async ($, on) => {
    world(on);
    await $.session.start(sessionStart);
    await $.ui.render(userMessage("first", "u1"));
    await $.ui.render(assistantMessage("reply", "a1"));
    await $.prompt.submit(submission("second"));
    expect(isStock(await $.ui.render(userMessage("second", "u2")))).toBe(true);
    expect(isStock(await $.ui.render(userMessage("first", "u1")))).toBe(true);
    expect(isStock(await $.ui.render(assistantMessage("reply", "a1")))).toBe(true);
  });

  test("keeps the first conversation phase current until a later message is sent", async ($, on) => {
    const { journal } = world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    expect(isStock(await $.ui.render(userMessage("first", "u1")))).toBe(true);
    expect(isStock(await $.ui.render(assistantMessage("reply", "a1")))).toBe(true);
    expect(journal.invalidations.filter((event) => event === "ui.render")).toHaveLength(1);
  });

  test("greys every earlier row from the submission, before the new row draws", async ($, on) => {
    const { journal } = world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    await $.ui.render(userMessage("first", "u1"));
    await $.ui.render(assistantMessage("reply", "a1"));
    const redraws = journal.invalidations.length;
    await $.prompt.submit(submission("second"));
    // The redraw is requested by the submission itself, ahead of the new row's first draw.
    expect(journal.invalidations.length).toBe(redraws + 1);
    expect(isGrey(await $.ui.render(userMessage("first", "u1")))).toBe(true);
    expect(isGrey(await $.ui.render(assistantMessage("reply", "a1")))).toBe(true);
    // The optimistic row and the stored row are current, and drawing them asks for nothing more.
    expect(isStock(await $.ui.render(userMessage("second", "placeholder")))).toBe(true);
    expect(isStock(await $.ui.render(userMessage("second", "u2")))).toBe(true);
    expect(isStock(await $.ui.render(assistantMessage("answer", "a2")))).toBe(true);
    expect(journal.invalidations.length).toBe(redraws + 1);
  });

  test("moves the boundary again on each later message", async ($, on) => {
    world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    await $.ui.render(userMessage("first", "u1"));
    await $.prompt.submit(submission("second"));
    await $.ui.render(userMessage("second", "u2"));
    await $.ui.render(assistantMessage("answer", "a2"));
    await $.prompt.submit(submission("third"));
    await $.ui.render(userMessage("third", "u3"));
    expect(isGrey(await $.ui.render(userMessage("second", "u2")))).toBe(true);
    expect(isGrey(await $.ui.render(assistantMessage("answer", "a2")))).toBe(true);
    expect(isStock(await $.ui.render(userMessage("third", "u3")))).toBe(true);
  });

  test("never numbers the optimistic row, which every prompt reuses", async ($, on) => {
    world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    await $.prompt.submit(submission("first"));
    expect(isStock(await $.ui.render(userMessage("first", "placeholder")))).toBe(true);
    await $.ui.render(userMessage("first", "u1"));
    await $.prompt.submit(submission("second"));
    expect(isStock(await $.ui.render(userMessage("second", "placeholder")))).toBe(true);
  });

  test("moves the boundary when the row draws for a prompt typed over a turn or a slash command", async ($, on) => {
    const { journal } = world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    await $.ui.render(userMessage("first", "u1"));
    await $.ui.render(assistantMessage("reply", "a1"));
    const redraws = journal.invalidations.length;
    await $.prompt.submit(submission("queued", { turnId: "t1" }));
    await $.prompt.submit(submission("/loop 5m check"));
    expect(journal.invalidations.length).toBe(redraws);
    expect(isStock(await $.ui.render(assistantMessage("reply", "a1")))).toBe(true);
    await $.ui.render(assistantMessage("late reply", "a1b"));
    expect(isStock(await $.ui.render(userMessage("queued", "u2")))).toBe(true);
    expect(journal.invalidations.length).toBe(redraws + 1);
    expect(isGrey(await $.ui.render(assistantMessage("late reply", "a1b")))).toBe(true);
  });

  test("never lets an operational row or a notification move the boundary", async ($, on) => {
    const { journal } = world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    await $.ui.render(userMessage("first", "u1"));
    await $.ui.render(assistantMessage("reply", "a1"));
    const redraws = journal.invalidations.length;
    expect(isHidden(await $.ui.render(userMessage(operational("watcher", "signal: x"), "op1")))).toBe(true);
    expect(isStock(await $.ui.render(userMessage("build finished", "n1", { kind: "task-notification" })))).toBe(true);
    expect(isStock(await $.ui.render(assistantMessage("reply", "a1")))).toBe(true);
    expect(journal.invalidations.length).toBe(redraws);
  });

  test("hides the Stop hook wake notice before it ever draws while on, and only then", async ($, on) => {
    world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    expect(isHidden(await $.ui.render(userMessage(stopHookNotice, "stop1", { kind: "task-notification" })))).toBe(true);
    // A genuine prompt with the same words is the person's own message.
    expect(isStock(await $.ui.render(userMessage(stopHookNotice, "u1")))).toBe(true);
    await $.command.run(calmCommand());
    expect(isStock(await $.ui.render(userMessage(stopHookNotice, "stop1", { kind: "task-notification" })))).toBe(true);
  });

  test("restores a transcript with every row before the last message grey from its first draw", async ($, on) => {
    const { journal } = world(on, {
      preference: "on\n",
      messages: [
        { role: "user", text: "first", toolUses: [] },
        { role: "assistant", text: "one", toolUses: [{}] },
        { role: "user", text: "", toolUses: [], toolResults: [{}] },
        { role: "user", text: "second", toolUses: [] },
        { role: "assistant", text: "two", toolUses: [] },
        { role: "user", text: "<task-notification>\nStop hook feedback</task-notification>", toolUses: [] },
        { role: "user", text: operational("watcher", "signal: x"), toolUses: [] },
        { role: "user", text: "third", toolUses: [] },
        { role: "assistant", text: "three", toolUses: [] },
      ],
    });
    // Rows draw in transcript order before session.start on a restore.
    expect(isGrey(await $.ui.render(userMessage("first", "u1")))).toBe(true);
    expect(isGrey(await $.ui.render(assistantMessage("one", "a1")))).toBe(true);
    expect(isGrey(await $.ui.render(userMessage("second", "u2")))).toBe(true);
    expect(isGrey(await $.ui.render(assistantMessage("two", "a2")))).toBe(true);
    expect(isHidden(await $.ui.render(userMessage(stopHookNotice, "stop1", { kind: "task-notification" })))).toBe(true);
    expect(isStock(await $.ui.render(userMessage("third", "u3")))).toBe(true);
    expect(isStock(await $.ui.render(assistantMessage("three", "a3")))).toBe(true);
    // A later redraw of the earlier rows agrees with their first draw.
    expect(isGrey(await $.ui.render(assistantMessage("two", "a2")))).toBe(true);
    expect(isStock(await $.ui.render(assistantMessage("three", "a3")))).toBe(true);
    expect(journal.sessionMessageReads).toBe(1);
  });

  test("ends a restore countdown that overcounts as soon as the person sends a message", async ($, on) => {
    world(on, {
      preference: "on\n",
      messages: [
        { role: "user", text: "one", toolUses: [] },
        { role: "user", text: "two", toolUses: [] },
      ],
    });
    expect(isGrey(await $.ui.render(userMessage("one", "u1")))).toBe(true);
    await $.prompt.submit(submission("next"));
    expect(isStock(await $.ui.render(userMessage("next", "u9")))).toBe(true);
  });

  test("starts a fresh conversation after /clear", async ($, on) => {
    world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    await $.ui.render(userMessage("first", "u1"));
    await $.prompt.submit(submission("second"));
    await $.ui.render(userMessage("second", "u2"));
    await $.session.end({ reason: "clear", sessionId: "s1" });
    expect(isStock(await $.ui.render(userMessage("again", "u3")))).toBe(true);
    expect(isStock(await $.ui.render(assistantMessage("fresh", "a3")))).toBe(true);
  });

  test("leaves the optimistic row and long or control-character text drawable", async ($, on) => {
    world(on, { preference: "on\n" });
    await $.session.start(sessionStart);
    await $.ui.render(userMessage("first", "u1"));
    await $.prompt.submit(submission("second"));
    const long = `${"x".repeat(12000)}\u0007`;
    expect(isGrey(await $.ui.render(assistantMessage(long, "a1")))).toBe(false);
    await $.ui.render(assistantMessage("seen", "a5"));
  });
});
