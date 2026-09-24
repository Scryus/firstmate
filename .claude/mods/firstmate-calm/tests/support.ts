// Shared fixtures for the firstmate-calm plugin test suites under `claude plugin test`.
//
// Each test mocks the world beneath the plugin noun by noun: the environment that
// names the Firstmate home, an in-memory file system for the per-home preference, the
// engine's own draw for every component the mod passes through, and a journal of every
// call the mod makes on `$` (blits, toasts, redraws, the command it registers).
import type { On, SessionMessage } from "claude-code";
import { mock, type MockClock } from "claude-code/testing";

export const HOME = "/fm/home";
export const PREFERENCE = `${HOME}/config/calm`;

export type Journal = {
  /** Every `$.command.register` name, in order. */
  commands: string[];
  /** Every `$.ui.toast` text, in order. */
  toasts: string[];
  /** Every `$.ui.invalidate` event, in order. */
  invalidations: string[];
  /** Every `$.ui.blit`, as `{ requestId, key, columns, rows, cells }`. */
  blits: { requestId: string; key: string; columns?: number; rows?: number; cells: string }[];
  /** Which components reached the engine's own drawing, in order. */
  stock: string[];
  /** Preference reads that reached the mocked filesystem. */
  fsReads: string[];
  /** Number of transcript reads that reached the mocked session. */
  sessionMessageReads: number;
  /** Number of `/config` listings that reached the mocked menu. */
  configLists: number;
};

export type World = {
  clock: MockClock;
  files: Map<string, string>;
  journal: Journal;
  /** Set to deny every `$.ui.blit` from now on, as an unmounted site does. */
  denyBlits: (reason: string | undefined) => void;
  /** Set to reject every `$.fs.write` from now on. */
  failWrites: (reason: string | undefined) => void;
};

export type WorldOptions = {
  /** The stored preference text; absent means no file. */
  preference?: string;
  /** Extra environment beside FM_HOME; pass `{}` with `home: undefined` to unset FM_HOME. */
  env?: Record<string, string>;
  /** Function-hooks opt-in value; omitted options default to the active value `1`. */
  functionHooks?: string | undefined;
  /** The Firstmate home FM_HOME names; undefined leaves FM_HOME unset. */
  home?: string | undefined;
  /** What `$.session.messages()` answers. */
  messages?: readonly {
    role: "user" | "assistant";
    text: string;
    toolUses: readonly unknown[];
    toolResults?: readonly unknown[];
  }[];
  /** The `theme` row's value as `$.config.list()` reports it; omitted means `dark`. */
  theme?: unknown;
};

/** The engine's own drawing, as the bottom of every `ui.render` chain. */
export const STOCK_TEXT = "STOCK-DRAWING";

export function world(on: On, options: WorldOptions = {}): World {
  const home = "home" in options ? options.home : HOME;
  const functionHooks = "functionHooks" in options ? options.functionHooks : "1";
  mock.env(on, {
    ...(home === undefined ? {} : { FM_HOME: home }),
    ...(options.env ?? {}),
    ...(functionHooks === undefined ? {} : { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: functionHooks }),
  });
  const clock = mock.clock(on);
  const files = new Map<string, string>();
  if (options.preference !== undefined) files.set(PREFERENCE, options.preference);
  const journal: Journal = {
    commands: [],
    toasts: [],
    invalidations: [],
    blits: [],
    stock: [],
    fsReads: [],
    sessionMessageReads: 0,
    configLists: 0,
  };
  let theme: unknown = "theme" in options ? options.theme : "dark";
  let blitDenial: string | undefined;
  let writeFailure: string | undefined;

  on("fs.read", async (_$, e) => {
    journal.fsReads.push(e.path);
    return files.has(e.path) ? { value: files.get(e.path)! } : { deny: `ENOENT: ${e.path}` };
  });
  on("fs.write", async (_$, e) => {
    if (writeFailure !== undefined) return { deny: writeFailure };
    files.set(e.path, e.text);
    return { value: undefined };
  });
  on("command.register", async (_$, e) => {
    journal.commands.push(e.name);
    return { value: { command: e.name } };
  });
  on("ui.toast", async (_$, e) => {
    journal.toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.invalidate", async (_$, e) => {
    journal.invalidations.push(e.event);
    return { value: undefined };
  });
  on("ui.blit", async (_$, e) => {
    journal.blits.push({ requestId: e.requestId, key: e.key, columns: e.columns, rows: e.rows, cells: e.cells });
    return { value: blitDenial === undefined ? {} : { deny: blitDenial } };
  });
  on("session.messages", async () => {
    journal.sessionMessageReads += 1;
    return { value: [...(options.messages ?? [])] as SessionMessage[] };
  });
  on("session.start", async (_$, e) => ({ cwd: e.cwd }));
  on("prompt.submit", async (_$, e) => ({ text: e.text }));
  on("session.end", async (_$, e) => ({ sessionId: e.sessionId }));
  on("config.list", async () => {
    journal.configLists += 1;
    return {
      value: [
        {
          key: "theme",
          label: "Theme",
          kind: "choice",
          value: theme as never,
          options: ["auto", "dark", "light", "light-daltonized", "dark-daltonized", "light-ansi", "dark-ansi"],
          provider: { plugin: "engine", tier: "core" },
          isLocked: false,
        },
      ],
    };
  });
  // The menu writes the row: the value lands for later listings and the hook above sees it.
  on("config.set", async (_$, e) => {
    if (e.key === "theme") theme = e.value;
    return { value: e.value };
  });
  on("ui.render", async (_$, e) => {
    journal.stock.push(e.component);
    return { type: "Text", props: {}, children: [STOCK_TEXT] };
  });

  return {
    clock,
    files,
    journal,
    denyBlits: (reason) => {
      blitDenial = reason;
    },
    failWrites: (reason) => {
      writeFailure = reason;
    },
  };
}

export const VIEWPORT = { columns: 40, rows: 24 } as const;

export function spinner(requestId = "agent-main", viewport: { columns: number; rows: number } = VIEWPORT) {
  return {
    surface: "terminal" as const,
    component: "Spinner" as const,
    requestId,
    viewport,
    props: { word: "Sauteing", message: null, mode: "requesting" as const },
  };
}

/** A Spinner drawing before any surface has measured: no viewport at all. */
export function toolUse(requestId = "tool-1") {
  return {
    surface: "terminal" as const,
    component: "ToolUse" as const,
    requestId,
    viewport: VIEWPORT,
    props: { tool_use_id: requestId, tool: "Bash", input: { command: "ls" }, isRunning: false, isErrored: false, isInterrupted: false },
  };
}

export function toolResult(requestId = "tool-1") {
  return {
    surface: "terminal" as const,
    component: "ToolResult" as const,
    requestId,
    viewport: VIEWPORT,
    props: { tool_use_id: requestId, tool: "Bash", output: { stdout: "x", stderr: "" }, isErrored: false },
  };
}

export function toolGroup(requestId = "group-1", isExpanded = false) {
  return {
    surface: "terminal" as const,
    component: "ToolGroup" as const,
    requestId,
    viewport: VIEWPORT,
    props: { calls: [], isActive: false, isExpanded },
  };
}

export function userMessage(
  text: string,
  requestId = "user-1",
  origin: { kind: "composer" | "task-notification" } = { kind: "composer" },
) {
  return {
    surface: "terminal" as const,
    component: "UserMessage" as const,
    requestId,
    viewport: VIEWPORT,
    props: { text, origin },
  };
}

/** A submission as the composer raises it: idle session, the person's own Enter. */
export function submission(text: string, extra: { turnId?: string } = {}) {
  return { text, wait: false, origin: { kind: "composer" as const }, ...extra };
}

export function assistantMessage(text: string, requestId = "assistant-1") {
  return {
    surface: "terminal" as const,
    component: "AssistantMessage" as const,
    requestId,
    viewport: VIEWPORT,
    props: { text, isFirstOfReply: true },
  };
}

export function calmCommand() {
  return {
    command: "calm",
    args: "",
    origin: { kind: "composer" as const },
    presentation: { layout: "main" as const, isFullscreen: false, columns: 80 },
  };
}

/** Whether a drawing is the mod's zero-height box. */
export function isHidden(tree: unknown): boolean {
  return JSON.stringify(tree).includes('"display":"none"');
}

/** Whether a drawing is the mod's grey replacement: the engine's Markdown drawn dim. */
export function isGrey(tree: unknown): boolean {
  const drawn = JSON.stringify(tree);
  return drawn.includes('"dimColor":true') && drawn.includes("Markdown");
}

/** Whether a drawing is the engine's own. */
export function isStock(tree: unknown): boolean {
  return JSON.stringify(tree).includes(STOCK_TEXT);
}

/** The exact current operational envelope for one kind, as bin/fm-operational-input.sh encodes it. */
export function operational(kind: string, body: string): string {
  return `\u2063FIRSTMATE_OP: v1 ${kind}: ${body}`;
}

/** The established from-firstmate routing carrier. */
export function fromFirstmate(body: string): string {
  return `[fm-from-firstmate]\u2063${body}`;
}
