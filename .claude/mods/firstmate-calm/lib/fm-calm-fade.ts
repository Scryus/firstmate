// Firstmate Calm fade-history policy for the Claude Code mod, kept free of the engine.
//
// While Calm is on, every transcript row drawn before the latest genuine user message
// draws grey; the latest message and everything after it draw as Claude Code draws them.
// Rows carry no order in their props, so the tracker below numbers each row id the first
// time it is drawn and keeps one boundary in that numbering. ../hooks/register.ts owns
// the engine glue, and docs/calm.md the captain-facing contract. Everything here is pure
// so tests run it under Node.

/** The id Claude Code gives the optimistic user row drawn before the stored one exists. */
export const OPTIMISTIC_ROW_ID = "placeholder";

/** The prompt origin kinds that are the person's own message rather than a notification. */
const GENUINE_ORIGIN_KINDS: ReadonlySet<string> = new Set(["composer"]);

/** Whether a user row is a message the person sent, as opposed to any notification or relay. */
export function isGenuineUserRow(origin: { readonly kind: string }, requestId: string): boolean {
  return GENUINE_ORIGIN_KINDS.has(origin.kind) && requestId !== OPTIMISTIC_ROW_ID;
}

/** Whether a user row is the notification Claude Code draws when an async Stop hook rewakes the session. */
export function isStopHookFeedbackRow(origin: { readonly kind: string }, text: string): boolean {
  return origin.kind === "task-notification" && /^Stop hook feedback\b/.test(text.trim());
}

/**
 * Whether a submission starts a new conversation phase before its row draws: the person's
 * own Enter while the session is idle. A slash command or skill, or a prompt typed over a
 * running turn, leaves the boundary to the row itself when it draws.
 */
export function submitOpensPhase(
  submission: { readonly text: string; readonly origin: { readonly kind: string }; readonly turnId?: string },
): boolean {
  return (
    GENUINE_ORIGIN_KINDS.has(submission.origin.kind) &&
    submission.turnId === undefined &&
    submission.text.trim() !== "" &&
    !submission.text.trimStart().startsWith("/")
  );
}

/** The longest text one `Markdown` element takes. */
export const MARKDOWN_TEXT_LIMIT = 10000;

/**
 * Row text as one `Markdown` element takes it: at most `MARKDOWN_TEXT_LIMIT` characters,
 * with tab and newline the only control characters. An element that broke either bound
 * would draw the engine's own bright row instead of the grey one.
 */
export function markdownSafeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return cleaned.length <= MARKDOWN_TEXT_LIMIT ? cleaned : `${cleaned.slice(0, MARKDOWN_TEXT_LIMIT - 1)}\u2026`;
}

/** Stored user rows that carry a background task's notice or a system note, not a message the person typed. */
const NOTIFICATION_TEXT = /^<(task-notification|system-reminder)\b/;

/**
 * How many genuine user messages a stored transcript holds, from `$.session.messages()`
 * rows, which carry no origin: a user row with its own text that is neither a tool result
 * carrier nor an operational input. Seeds the restore countdown below.
 */
export function countGenuineUserMessages(
  messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly toolResults?: readonly unknown[];
  }>,
  isOperational: (text: string) => boolean,
): number {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (message.toolResults !== undefined && message.toolResults.length > 0) continue;
    const text = message.text.trim();
    if (text === "" || isOperational(text) || NOTIFICATION_TEXT.test(text)) continue;
    count += 1;
  }
  return count;
}

export type FadeTracker = {
  /** Numbers a row id the first time it is seen; the optimistic row is never numbered. */
  observe: (requestId: string) => void;
  /** Whether a row draws grey now. */
  isOld: (requestId: string) => boolean;
  /** A submission is about to draw its row: every row seen so far is old. Whether the boundary moved. */
  openPhase: () => boolean;
  /**
   * A genuine user row has drawn: it and later rows stay current, earlier rows are old.
   * Ends the restore countdown when it is the last stored message. Whether rows already drawn need a redraw.
   */
  genuineRowDrawn: (requestId: string) => boolean;
  /**
   * Restoring a stored transcript: rows draw in transcript order before the latest genuine
   * message is known, so every row drawn before that message's turn counts as old from its
   * first draw. `genuineCount` is how many genuine user messages the transcript holds.
   */
  beginRestore: (genuineCount: number) => void;
};

/** One tracker per session; a `/clear` or a new session takes a fresh one. */
export function createFadeTracker(): FadeTracker {
  const sequence = new Map<string, number>();
  const counted = new Set<string>();
  let counter = 0;
  let boundary = 0;
  let restoring = 0;

  const seq = (requestId: string): number => {
    let n = sequence.get(requestId);
    if (n === undefined) {
      n = ++counter;
      sequence.set(requestId, n);
    }
    return n;
  };

  return {
    observe(requestId) {
      if (requestId !== OPTIMISTIC_ROW_ID) seq(requestId);
    },
    isOld(requestId) {
      if (requestId === OPTIMISTIC_ROW_ID) return false;
      return restoring > 0 || seq(requestId) <= boundary;
    },
    openPhase() {
      restoring = 0;
      const moved = boundary !== counter;
      boundary = counter;
      return moved;
    },
    genuineRowDrawn(requestId) {
      const mine = seq(requestId);
      if (restoring > 0 && !counted.has(requestId)) {
        counted.add(requestId);
        restoring -= 1;
      }
      const moved = boundary < mine - 1;
      if (moved) boundary = mine - 1;
      return moved && restoring === 0;
    },
    beginRestore(genuineCount) {
      restoring = genuineCount;
    },
  };
}
