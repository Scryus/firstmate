// Firstmate Calm for Claude Code: the hooks module of the `firstmate-calm` mod.
//
// A Claude Code "mod" is a plugin whose behavior lives in one hooks module. Claude Code
// may load this module through its rollout flag or `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`,
// but every handler requires that environment variable to equal `1`, so rollout-only
// loading remains a complete no-op.
// The plugin carries no command, skill, agent, or classic hook of its own; the `/calm`
// command below exists only once this module has registered it. docs/calm.md owns the
// captain-facing contract and docs/calm-mode-feasibility.md the version-scoped evidence.
//
// This file is the only place the engine interface `$` is touched: every visibility
// decision lives in ../lib/fm-calm-presentation.ts, so the policy is testable under Node
// and the engine glue under `claude plugin test`. Nothing here rewrites a message: `ui.render` changes
// drawings and leaves the stored transcript, model context, and session storage alone.
//
// Fade-history (../lib/fm-calm-fade.ts): while Calm is on, user and assistant rows before
// the latest genuine user message draw grey through `Markdown` with `dimColor`, and the
// notice Claude Code draws when an async Stop hook rewakes the session hides. The
// boundary moves in `prompt.submit`, before the new row draws; a restored transcript is
// seeded from the stored message count so its first painted frame is already correct.
//
// Presentation while Calm is on, sharing Pi Calm's goals where the mods API allows:
// the stock working row (`Spinner`) is never hooked and draws exactly as Claude Code
// draws it; `ToolUse`, `ToolResult`, and `ToolGroup` rows
// draw as zero-height boxes; a `UserMessage` whose text the canonical operational-input
// classifier recognizes draws as zero height. Assistant text is never hooked, so every
// working note and reply stays visible. Calm off returns every drawing to the engine.
// A toggle invalidates every hooked drawing, so rows already on screen redraw.
//
// Loading is lazy and cached within a session: a resumed transcript or a hot reload can
// draw restored rows before `session.start`, so every hook awaits that session's load of
// the per-home preference rather than trusting a stale "off".
// Each `session.start` reloads the preference for the new session.
import type { EngineInterface, Register, RenderElement, RenderInput } from "claude-code";
import {
  countGenuineUserMessages,
  createFadeTracker,
  isGenuineUserRow,
  isStopHookFeedbackRow,
  markdownSafeText,
  OPTIMISTIC_ROW_ID,
  submitOpensPhase,
} from "../lib/fm-calm-fade.ts";
import {
  calmPreferencePath,
  parseCalmPreference,
  serializeCalmPreference,
  userTextIsOperational,
} from "../lib/fm-calm-presentation.ts";

/** The slash command the mod serves, the same name as Pi's `/calm`. */
const CALM_COMMAND = "calm";

// One module environment holds one Calm state; a hot reload starts a fresh one, the
// same as a new Pi extension lifetime.
let calm = false;
let preferencePath: string | undefined;
let activation: Promise<boolean> | undefined;
let loading: Promise<void> | undefined;
// Which rows are before the latest genuine user message; see ../lib/fm-calm-fade.ts.
let fade = createFadeTracker();

function isActivated($: EngineInterface): Promise<boolean> {
  if (activation === undefined) {
    activation = $.env.get("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS").then(
      (value) => value === "1",
      () => false,
    );
  }
  return activation;
}

async function readPreference($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path);
  } catch {
    return undefined;
  }
}

async function load($: EngineInterface): Promise<void> {
  preferencePath = calmPreferencePath(
    {
      FM_HOME: await $.env.get("FM_HOME"),
      FM_ROOT_OVERRIDE: await $.env.get("FM_ROOT_OVERRIDE"),
      FM_CONFIG_OVERRIDE: await $.env.get("FM_CONFIG_OVERRIDE"),
    },
    $.plugin.root,
  );
  calm = parseCalmPreference(await readPreference($, preferencePath));
  // A restored transcript draws its rows in order before the latest message is known, so
  // count the stored genuine messages first and every row before the last one draws grey
  // from its first draw.
  try {
    fade.beginRestore(countGenuineUserMessages(await $.session.messages(), userTextIsOperational));
  } catch {
    // A transcript that cannot be read leaves the rows to the submit and draw hooks.
  }
  $.ui.invalidate("ui.render");
}

function ensureLoaded($: EngineInterface): Promise<void> {
  if (loading === undefined) loading = load($);
  return loading;
}

async function resetSession($: EngineInterface): Promise<void> {
  if (loading !== undefined) await loading.catch(() => undefined);
  calm = false;
  fade = createFadeTracker();
  preferencePath = undefined;
  loading = undefined;
  await ensureLoaded($);
}

/** A zero-height drawing: the row contributes nothing to the transcript's layout. */
function hiddenRow($: EngineInterface, e: RenderInput): RenderElement {
  const { Box } = $.ui.resolve(e);
  return Box({ display: "none" });
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    if (!(await isActivated($))) return next(e);
    await resetSession($);
    await $.command.register({
      name: CALM_COMMAND,
      description: "Toggle Firstmate's Calm transcript presentation.",
    });
    return next(e);
  });

  on("command.run", { command: CALM_COMMAND }, async ($, e, next) => {
    if (!(await isActivated($))) return next(e);
    await ensureLoaded($);
    const active = !calm;
    // Persist before changing live presentation, so a failed write leaves the current
    // choice unchanged rather than claiming persistence.
    try {
      await $.fs.write(preferencePath ?? "", serializeCalmPreference(active));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      $.ui.toast(`Calm unchanged: could not save ${preferencePath ?? "the preference"} (${reason})`);
      return {};
    }
    calm = active;
    $.ui.invalidate("ui.render");
    $.ui.toast(active ? "Calm on" : "Calm off");
    // No `text`: the toggle leaves no output row in the transcript, as on Pi.
    return {};
  });

  on("ui.render", { component: "ToolUse" }, async ($, e, next) => {
    if (!(await isActivated($))) return next(e);
    await ensureLoaded($);
    return calm ? hiddenRow($, e) : next(e);
  });
  on("ui.render", { component: "ToolResult" }, async ($, e, next) => {
    if (!(await isActivated($))) return next(e);
    await ensureLoaded($);
    return calm ? hiddenRow($, e) : next(e);
  });
  on("ui.render", { component: "ToolGroup" }, async ($, e, next) => {
    if (!(await isActivated($))) return next(e);
    await ensureLoaded($);
    return calm ? hiddenRow($, e) : next(e);
  });

  // The optimistic user row and the stored one are both hooked here: the person's own
  // Enter opens the new phase before either draws, so nothing draws bright and is then
  // greyed. A prompt typed over a running turn, or a slash command, opens it when its row draws.
  on("prompt.submit", async ($, e, next) => {
    if (!(await isActivated($))) return next(e);
    await ensureLoaded($);
    if (submitOpensPhase(e) && fade.openPhase() && calm) $.ui.invalidate("ui.render");
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    if (!(await isActivated($))) return next(e);
    if (e.reason === "clear") fade = createFadeTracker();
    return next(e);
  });

  on("ui.render", { component: "UserMessage" }, async ($, e, next) => {
    if (!(await isActivated($))) return next(e);
    await ensureLoaded($);
    const { origin, text } = e.props;
    // Operational rows and the Stop hook wake notice never count as a message the person
    // sent, and hide before their first draw while Calm is on.
    if (userTextIsOperational(text)) return calm ? hiddenRow($, e) : next(e);
    if (isStopHookFeedbackRow(origin, text)) return calm ? hiddenRow($, e) : next(e);
    if (e.requestId === OPTIMISTIC_ROW_ID) return next(e);
    fade.observe(e.requestId);
    if (isGenuineUserRow(origin, e.requestId) && fade.genuineRowDrawn(e.requestId) && calm) {
      $.ui.invalidate("ui.render");
    }
    if (!calm || !fade.isOld(e.requestId)) return next(e);
    const { Box, Text, Markdown } = $.ui.resolve(e);
    return Box({
      flexDirection: "row",
      marginTop: 1,
      children: [
        Text({ dimColor: true, children: "> " }),
        Box({ flexGrow: 1, flexShrink: 1, children: [Markdown({ text: markdownSafeText(text), dimColor: true })] }),
      ],
    });
  });

  on("ui.render", { component: "AssistantMessage" }, async ($, e, next) => {
    if (!(await isActivated($))) return next(e);
    await ensureLoaded($);
    fade.observe(e.requestId);
    if (!calm || !fade.isOld(e.requestId)) return next(e);
    const { Box, Text, Markdown } = $.ui.resolve(e);
    return Box({
      flexDirection: "row",
      marginTop: e.props.isFirstOfReply ? 1 : 0,
      children: [
        Text({ dimColor: true, children: e.props.isFirstOfReply ? "\u23fa " : "  " }),
        Box({ flexGrow: 1, flexShrink: 1, children: [Markdown({ text: markdownSafeText(e.props.text), dimColor: true })] }),
      ],
    });
  });
};
