#!/usr/bin/env bash
# Portable checks for the Claude Code Calm mod (.claude/mods/firstmate-calm) that need
# no Claude Code binary, so CI enforces them wherever Node runs:
#   - the plugin's declared shape: one hooks module and nothing else, reached from the
#     project's .claude/skills auto-load path through the tracked symlink, so nothing
#     of it can load while CLAUDE_CODE_ENABLE_FUNCTION_HOOKS is off;
#   - the sprite core the Pi extension imports from the mod: the Pi widget's rendering
#     is byte-for-byte the shared frame painted with standard ANSI codes;
#   - the pure presentation policy: home resolution, preference values, operational rows;
#   - the fade-history policy: row order, the boundary, restore seeding, and text limits;
#   - the operational-input classifier's parity with bin/fm-operational-input.sh over
#     envelopes the shell owner itself encodes, its legacy shapes, and near misses.
# The engine-bound behavior runs under tests/fm-calm-claude-mod-plugin.test.sh and the
# real TUI under tests/fm-calm-claude-mod-live-e2e.test.sh.
# shellcheck disable=SC2016 # Backticks are literal historical prompt markup in the corpus.
set -u

# shellcheck source=tests/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MOD="$ROOT/.claude/mods/firstmate-calm"
PI_SHIP="$ROOT/.pi/extensions/lib/fm-calm-working-ship.ts"
PI_SPRITE="$ROOT/.pi/extensions/lib/fm-calm-working-ship-sprite.ts"
OPERATIONAL_INPUT="$ROOT/bin/fm-operational-input.sh"
TMP_ROOT=$(fm_test_tmproot fm-calm-claude-mod)

command -v node >/dev/null 2>&1 || { echo "skip: node not found for the Claude Code Calm mod checks"; exit 0; }

run_node() {  # <script-file>
  node --input-type=module <"$1"
}

test_plugin_shape() {
  local link resolved autoload
  link="$ROOT/.agents/skills/firstmate-calm"
  [ -L "$link" ] || fail "the Calm mod is not linked into .agents/skills, so Claude Code's project skills-dir scan cannot adopt it"
  resolved=$(cd "$link" && pwd -P) || fail "the .agents/skills/firstmate-calm link does not resolve"
  [ "$resolved" = "$(cd "$MOD" && pwd -P)" ] || fail "the .agents/skills/firstmate-calm link resolves to $resolved, not the mod"
  autoload="$ROOT/.claude/skills/firstmate-calm"
  [ -f "$autoload/.claude-plugin/plugin.json" ] || fail "the project's .claude/skills path does not reach the mod's manifest"
  [ -f "$autoload/hooks/hooks.json" ] || fail "the project's .claude/skills path does not reach the mod's hooks module declaration"
  [ -L "$PI_SPRITE" ] || fail "the Pi sprite path is not a symlink to the shared core"
  [ "$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$PI_SPRITE")" = \
    "$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$MOD/lib/fm-calm-working-ship-sprite.ts")" ] \
    || fail "the Pi sprite path does not resolve to the mod's shared core"
  [ ! -e "$MOD/SKILL.md" ] || fail "the mod carries a SKILL.md and would load as a skill on every harness"
  cat >"$TMP_ROOT/shape.mjs" <<JS
import { readFileSync, readdirSync, existsSync } from "node:fs";
const mod = ${MOD@Q};
const manifest = JSON.parse(readFileSync(\`\${mod}/.claude-plugin/plugin.json\`, "utf8"));
if (manifest.name !== "firstmate-calm") throw new Error(\`manifest name \${manifest.name}\`);
for (const key of ["commands", "agents", "skills", "hooks", "mcpServers", "lspServers", "outputStyles"]) {
  if (key in manifest) throw new Error(\`manifest declares \${key}, which would load while the flag is off\`);
}
const hooks = JSON.parse(readFileSync(\`\${mod}/hooks/hooks.json\`, "utf8"));
const keys = Object.keys(hooks).sort();
if (JSON.stringify(keys) !== JSON.stringify(["description", "modules"])) {
  throw new Error(\`hooks.json declares \${keys.join(", ")}: a classic hook would run while the flag is off\`);
}
if (JSON.stringify(hooks.modules) !== JSON.stringify(["./register.ts"])) throw new Error("hooks.json names a different module");
if (!existsSync(\`\${mod}/hooks/register.ts\`)) throw new Error("the hooks module is missing");
const entries = readdirSync(mod).filter((name) => name !== ".claude-plugin").sort();
if (JSON.stringify(entries) !== JSON.stringify(["hooks", "lib", "tests"])) {
  throw new Error(\`the mod folder holds \${entries.join(", ")}: only hooks, lib, and tests may exist\`);
}
console.log("shape-ok");
JS
  out=$(run_node "$TMP_ROOT/shape.mjs" 2>&1) || fail "plugin shape: $out"
  assert_contains "$out" "shape-ok" "plugin shape check did not complete"
  pass "the Calm mod is one hooks module, linked into the project's auto-load path, with no command, skill, agent, or classic hook path that bypasses its exact opt-in"
}

test_shared_sprite_and_pi_rendering() {
  local out
  cat >"$TMP_ROOT/sprite.mjs" <<JS
import { pathToFileURL } from "node:url";
const pi = await import(pathToFileURL(${PI_SHIP@Q}).href);
const core = await import(pathToFileURL(${MOD@Q} + "/lib/fm-calm-working-ship-sprite.ts").href);
const ESC = "\\u001b";
const ANSI = { water: ESC + "[34m", boat: ESC + "[33m" };
const RESET = ESC + "[39m";
const paint = (row) => row.map((run) => (run.color === "plain" ? run.text : ANSI[run.color] + run.text + RESET)).join("");
const cells = (row) => row.map((run) => run.text).join("");
const check = (condition, message) => { if (!condition) throw new Error(message); };
check(pi.CALM_WORKING_SHIP_TICK_MS === core.CALM_WORKING_SHIP_TICK_MS, "Pi re-exports a different tick");
check(pi.CALM_WORKING_SHIP_TICKS_PER_MOVE === core.CALM_WORKING_SHIP_TICKS_PER_MOVE, "Pi re-exports a different move cadence");
let frames = 0;
for (const width of [0, 1, 2, 3, 4, 5, 6, 9, 12, 24, 40, 80, 121]) {
  const animation = pi.createCalmWorkingShipAnimation();
  const sprite = core.createCalmWorkingShipSprite();
  for (let step = 0; step < 41; step += 1) {
    const rendered = animation.render(width);
    const frame = sprite.frame(width);
    const expected = frame.map(paint);
    check(JSON.stringify(rendered) === JSON.stringify(expected), \`Pi rendering diverged from the shared frame at width \${width} step \${step}: \${JSON.stringify(rendered)} vs \${JSON.stringify(expected)}\`);
    check(animation.position() === sprite.position() && animation.direction() === sprite.direction() && animation.waterPhase() === sprite.waterPhase(), \`Pi animation state diverged at width \${width} step \${step}\`);
    if (width === 0) check(frame.length === 0, "zero width painted a row");
    if (width > 0) {
      const water = frame[frame.length - 1];
      check(cells(water).length === width, \`water row is \${cells(water).length} cells at width \${width}\`);
      for (const row of frame) {
        check(cells(row).length <= width, \`a row overflowed width \${width}\`);
        for (const run of row) check(["plain", "water", "boat"].includes(run.color), \`unknown color \${run.color}\`);
      }
      if (width >= 5) {
        check(frame.length === 2, \`width \${width} did not paint two rows\`);
        check(JSON.stringify(frame[0].slice(1)) === JSON.stringify([{ text: "◿│◣", color: "boat" }]), "the sail is not one boat-colored run");
        check(frame[0][0].color === "plain" && /^ +$/.test(frame[0][0].text), "sail padding is not plain spaces");
        const hullAt = frame[1].findIndex((run) => run.text === "╲▁▁▁╱");
        check(hullAt >= 0, "the hull is not one run");
        check(frame[1][hullAt].color === "boat", "the hull is not boat-colored");
        check(frame[1].filter((_run, index) => index !== hullAt).every((run) => run.text.length === 1 && run.color === "water"), "water outside the hull is not one water-colored bar per cell");
      } else if (width >= 3) {
        check(frame.length === 1 && cells(frame[0]).includes("◿│◣"), \`width \${width} lost the sail-only fallback\`);
      } else {
        check(frame.length === 1 && /^[▁▂▃▄]+$/.test(cells(frame[0])), \`width \${width} lost the water-only fallback\`);
      }
    }
    animation.tick();
    sprite.tick();
    frames += 1;
  }
}
// Freeze and resume: restoring the last painted frame discards later ticks on both.
{
  const animation = pi.createCalmWorkingShipAnimation();
  const sprite = core.createCalmWorkingShipSprite();
  animation.render(30); sprite.frame(30);
  for (let step = 0; step < 9; step += 1) { animation.tick(); sprite.tick(); }
  animation.render(30); sprite.frame(30);
  for (let step = 0; step < 6; step += 1) { animation.tick(); sprite.tick(); }
  animation.restoreLastRendered(); sprite.restoreLastRendered();
  check(animation.position() === sprite.position() && animation.waterPhase() === sprite.waterPhase(), "restore diverged");
  check(sprite.waterPhase() === 1 && sprite.position() === 2, \`restore landed at phase \${sprite.waterPhase()} column \${sprite.position()}\`);
  sprite.clampToWidth(6);
  check(sprite.position() === 1 && sprite.direction() === -1, "a hidden clamp did not turn the boat at the new edge");
  sprite.reset();
  check(sprite.position() === 0 && sprite.direction() === 1 && sprite.waterPhase() === 0, "reset did not restore the initial state");
}
console.log("sprite-ok frames=" + frames);
JS
  out=$(run_node "$TMP_ROOT/sprite.mjs" 2>&1) || fail "shared sprite: $out"
  assert_contains "$out" "sprite-ok frames=533" "the sprite parity sweep did not cover every width and step"
  pass "the Pi working ship renders byte-for-byte the shared sprite core's frame painted in standard ANSI, at every width, cadence step, freeze, clamp, and reset"
}

test_presentation_policy() {
  local out
  cat >"$TMP_ROOT/policy.mjs" <<JS
import { pathToFileURL } from "node:url";
const policy = await import(pathToFileURL(${MOD@Q} + "/lib/fm-calm-presentation.ts").href);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const plugin = "/repo/.claude/mods/firstmate-calm";
check(policy.calmPreferencePath({}, plugin) === "/repo/config/calm", "plugin-root fallback");
check(policy.calmPreferencePath({}, "/repo/.claude/skills/firstmate-calm/") === "/repo/config/calm", "trailing slash on the plugin root");
check(policy.calmPreferencePath({}, "/repo/.agents/skills/firstmate-calm") === "/repo/config/calm", ".agents/skills spelling of the plugin root");
check(policy.calmCodeRootFromPluginRoot("C:\\\\fm\\\\.claude\\\\mods\\\\firstmate-calm") === "C:\\\\fm", "Windows separators");
check(policy.calmPreferencePath({ FM_ROOT_OVERRIDE: "/override/root" }, plugin) === "/override/root/config/calm", "FM_ROOT_OVERRIDE");
check(policy.calmPreferencePath({ FM_HOME: "/home/fm", FM_ROOT_OVERRIDE: "/override/root" }, plugin) === "/home/fm/config/calm", "FM_HOME beats FM_ROOT_OVERRIDE");
check(policy.calmPreferencePath({ FM_HOME: "/home/fm", FM_CONFIG_OVERRIDE: "/cfg" }, plugin) === "/cfg/calm", "FM_CONFIG_OVERRIDE beats the home");
check(policy.calmPreferencePath({ FM_HOME: "" }, plugin) === "/repo/config/calm", "an empty FM_HOME reads as unset");
for (const [stored, expected] of [["on\\n", true], ["on", true], [" on \\n", true], ["max\\n", true], ["off\\n", false], ["", false], [undefined, false], ["ON", false], ["maybe", false]]) {
  check(policy.parseCalmPreference(stored) === expected, \`preference \${JSON.stringify(stored)}\`);
}
check(policy.serializeCalmPreference(true) === "on\\n" && policy.serializeCalmPreference(false) === "off\\n", "serialized values");
check(policy.userTextIsOperational("\\u2063FIRSTMATE_OP: v1 watcher: x") && !policy.userTextIsOperational("hello"), "operational recognition");
console.log("policy-ok");
JS
  out=$(run_node "$TMP_ROOT/policy.mjs" 2>&1) || fail "presentation policy: $out"
  assert_contains "$out" "policy-ok" "the policy check did not complete"
  pass "the Calm policy resolves the shared preference exactly as Pi does, reads on, max, and off as Pi does, and recognizes operational user rows"
}

test_fade_policy() {
  local out
  cat >"$TMP_ROOT/fade.mjs" <<JS
import { pathToFileURL } from "node:url";
const fade = await import(pathToFileURL(${MOD@Q} + "/lib/fm-calm-fade.ts").href);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const operational = (text) => text.startsWith("\u2063FIRSTMATE_OP:");

// Row classification: only the person's own stored composer row counts as a message.
check(fade.isGenuineUserRow({ kind: "composer" }, "u1"), "a composer row is genuine");
check(!fade.isGenuineUserRow({ kind: "composer" }, "placeholder"), "the optimistic row is never genuine");
check(!fade.isGenuineUserRow({ kind: "task-notification" }, "u1"), "a notification is not genuine");
check(!fade.isGenuineUserRow({ kind: "peer" }, "u1"), "another session's message is not genuine");
check(fade.isStopHookFeedbackRow({ kind: "task-notification" }, "Stop hook feedback"), "the wake notice");
check(!fade.isStopHookFeedbackRow({ kind: "composer" }, "Stop hook feedback"), "the person's own words are not the notice");
check(!fade.isStopHookFeedbackRow({ kind: "task-notification" }, "Build finished"), "another notification");

// Submissions that open a phase before their row draws.
const submit = (text, extra = {}) => fade.submitOpensPhase({ text, origin: { kind: "composer" }, ...extra });
check(submit("hello"), "an idle Enter opens a phase");
check(!submit("   "), "an empty prompt opens nothing");
check(!submit("/loop 5m x"), "a slash command opens nothing");
check(!submit("hello", { turnId: "t1" }), "a prompt over a running turn opens nothing");
check(!fade.submitOpensPhase({ text: "hi", origin: { kind: "plugin" } }), "a plugin prompt opens nothing");

// The tracker: first-draw order, one boundary.
{
  const t = fade.createFadeTracker();
  for (const id of ["u1", "a1"]) t.observe(id);
  check(!t.isOld("u1") && !t.isOld("a1"), "the first phase is current");
  check(t.openPhase() === true, "the first submission moves the boundary");
  check(t.isOld("u1") && t.isOld("a1"), "earlier rows are old after a submission");
  check(!t.isOld("placeholder"), "the optimistic row is never old");
  t.observe("u2");
  check(!t.isOld("u2"), "the new row is current");
  check(t.genuineRowDrawn("u2") === false, "the row that a submission announced needs no redraw");
  check(t.openPhase() === true && t.isOld("u2"), "the next submission ages the previous message");
  check(t.openPhase() === false, "a repeated submission changes nothing");
}
{
  // A prompt typed over a turn: its row moves the boundary when it draws.
  const t = fade.createFadeTracker();
  for (const id of ["u1", "a1", "a2"]) t.observe(id);
  check(t.genuineRowDrawn("u2") === true, "a row nobody announced moves the boundary");
  check(t.isOld("u1") && t.isOld("a1") && t.isOld("a2") && !t.isOld("u2"), "everything before that row is old");
}
{
  // Restore: rows before the last genuine message are old from their first draw.
  const t = fade.createFadeTracker();
  t.beginRestore(2);
  t.observe("u1");
  check(t.genuineRowDrawn("u1") === false && t.isOld("u1"), "the first stored message is old");
  t.observe("a1");
  check(t.isOld("a1"), "its reply is old");
  t.observe("u2");
  t.genuineRowDrawn("u2");
  check(!t.isOld("u2"), "the last stored message is current");
  t.observe("a2");
  check(!t.isOld("a2") && t.isOld("a1") && t.isOld("u1"), "the last reply is current, earlier rows stay old");
  t.genuineRowDrawn("u2");
  check(!t.isOld("u2"), "drawing the last message twice counts it once");
}
{
  const t = fade.createFadeTracker();
  t.beginRestore(3);
  t.observe("u1");
  t.genuineRowDrawn("u1");
  check(t.isOld("u1"), "counting ahead keeps rows old");
  t.openPhase();
  t.observe("u9");
  check(!t.isOld("u9"), "a real submission ends an overcounted restore");
}

// Counting stored genuine messages.
const rows = [
  { role: "user", text: "first" },
  { role: "assistant", text: "reply" },
  { role: "user", text: "", toolResults: [{}] },
  { role: "user", text: "second" },
  { role: "user", text: "<task-notification>\nStop hook feedback</task-notification>" },
  { role: "user", text: "\u2063FIRSTMATE_OP: v1 watcher: x" },
  { role: "user", text: "<div> is a tag" },
];
check(fade.countGenuineUserMessages(rows, operational) === 3, "counts typed messages only");
check(fade.countGenuineUserMessages([], operational) === 0, "an empty transcript counts zero");

// Text one Markdown element accepts.
check(fade.markdownSafeText("a\u0007b\r\nc\td") === "ab\nc\td", "control characters are dropped, tab and newline kept");
const long = fade.markdownSafeText("x".repeat(20000));
check(long.length === fade.MARKDOWN_TEXT_LIMIT && long.endsWith("\u2026"), "long text is cut to the element limit");
console.log("fade-ok");
JS
  out=$(run_node "$TMP_ROOT/fade.mjs" 2>&1) || fail "fade policy: $out"
  assert_contains "$out" "fade-ok" "the fade policy check did not complete"
  pass "the Calm fade policy orders rows by first draw, moves one boundary on submissions and on unannounced rows, seeds a restore, and never counts operational, notification, or optimistic rows as a message"
}

# The classifier parity corpus: envelopes the shell owner encodes itself, its legacy
# shapes, and near misses. Each case is one file so multi-line bodies stay exact.
canonical_generic_kinds() {
  bash -c '. "$1"; printf "%s\n" "$FM_OPERATIONAL_KINDS"' firstmate "$OPERATIONAL_INPUT"
}

write_parity_corpus() {
  local dir=$1 kind index=0 body generic_kinds
  mkdir -p "$dir"
  generic_kinds=$(canonical_generic_kinds) || fail "could not read generic kinds from the operational-input owner"
  [ -n "$generic_kinds" ] || fail "the operational-input owner exposes no generic kinds"
  for kind in $generic_kinds; do
    for body in 'plain body' $'multi\nline\n\nbody' $'trailing newline\n' $'two trailing newlines\n\n' 'colon: inside: body' 'ünïcödé body ✓' ' '; do
      index=$((index + 1))
      printf '%s' "$body" | "$OPERATIONAL_INPUT" encode "$kind" >"$dir/case-$index.txt" \
        || fail "the owner could not encode kind $kind for the parity corpus"
    done
  done
  for body in 'plain body' $'multi\nline\n\nbody' $'trailing newline\n' $'two trailing newlines\n\n' 'colon: inside: body' 'ünïcödé body ✓' ' '; do
    index=$((index + 1))
    printf '%s' "$body" | "$OPERATIONAL_INPUT" encode from-firstmate >"$dir/case-$index.txt" \
      || fail "the owner could not encode from-firstmate for the parity corpus"
  done
  for body in \
    'Run `bin/fm-session-start.sh` now, exactly once, before executing any other instructions.' \
    'Run `bin/fm-session-start.sh` now, exactly once, before executing any other instructions. ' \
    $'FIRSTMATE WATCHER WAKE: signal: x\n\nRun bin/fm-wake-drain.sh first and handle the queued wake. Watcher continuity is extension-owned.' \
    $'FIRSTMATE WATCHER WAKE: \n\nRun bin/fm-wake-drain.sh first and handle the queued wake. Watcher continuity is extension-owned.' \
    $'TURN WOULD END BLIND - supervision is off. The watcher cycle is missing, failed, or unhealthy. Follow the harness recovery instruction below before ending the turn.\n\nrecover' \
    $'TURN WOULD END BLIND - supervision is off. The watcher cycle is missing, failed, or unhealthy. Follow the harness recovery instruction below before ending the turn.\n\n' \
    $'\xE2\x81\xA3Supervisor escalate (' \
    $'\xE2\x81\xA3Supervisor escalate (needs you)' \
    $'\xE2\x81\xA3FIRSTMATE_OP: untyped legacy' \
    $'\xE2\x81\xA3FIRSTMATE_OP: ' \
    $'\xE2\x81\xA3FIRSTMATE_OP: v1 watcher:' \
    $'\xE2\x81\xA3FIRSTMATE_OP: v1 watcher: ' \
    $'\xE2\x81\xA3FIRSTMATE_OP: v1 bogus: body' \
    $'\xE2\x81\xA3FIRSTMATE_OP: v2 watcher: body' \
    $'\xE2\x81\xA3FIRSTMATE_OP: v1 watcher: : x' \
    $'\xE2\x81\xA3FIRSTMATE_OP:v1 watcher: body' \
    $'[fm-from-firstmate]\xE2\x81\xA3' \
    $'[fm-from-firstmate]\xE2\x81\xA3x' \
    '[fm-from-firstmate] no separator' \
    "'"$'\xE2\x81\xA3'"FIRSTMATE_OP: v1 watcher: quoted'" \
    'FIRSTMATE_OP: v1 watcher: ascii only' \
    $'text before \xE2\x81\xA3FIRSTMATE_OP: v1 watcher: body' \
    $'\xE2\x81\xA3' \
    $'\xE2\x81\xA3unrelated' \
    'hello there' \
    '' \
    $'\n' \
    'signal: /tmp/x.status changed'
  do
    index=$((index + 1))
    printf '%s' "$body" >"$dir/case-$index.txt"
  done
  printf '%s\n' "$index"
}

test_classifier_parity_with_shell_owner() {
  local corpus count out shell_verdict port_verdict mismatches=0 compared=0 index file generic_kinds kind
  corpus="$TMP_ROOT/corpus"
  count=$(write_parity_corpus "$corpus")
  cat >"$TMP_ROOT/classify.mjs" <<JS
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
const port = await import(pathToFileURL(${MOD@Q} + "/lib/fm-operational-input.ts").href);
const corpus = ${corpus@Q};
const count = ${count};
const lines = [];
for (let index = 1; index <= count; index += 1) {
  const text = readFileSync(\`\${corpus}/case-\${index}.txt\`, "utf8");
  lines.push(\`\${index}\\t\${port.classifyFirstmateOperationalText(text) ?? "none"}\`);
}
writeFileSync(\`\${corpus}/port-verdicts.tsv\`, lines.join("\\n") + "\\n");
console.log("classified " + count);
JS
  out=$(run_node "$TMP_ROOT/classify.mjs" 2>&1) || fail "classifier port: $out"
  assert_contains "$out" "classified $count" "the port did not classify the whole corpus"
  index=1
  while [ "$index" -le "$count" ]; do
    file="$corpus/case-$index.txt"
    if shell_verdict=$("$OPERATIONAL_INPUT" classify <"$file" 2>/dev/null); then
      :
    else
      shell_verdict=none
    fi
    port_verdict=$(awk -F '\t' -v i="$index" '$1 == i { print $2 }' "$corpus/port-verdicts.tsv")
    compared=$((compared + 1))
    if [ "$shell_verdict" != "$port_verdict" ]; then
      mismatches=$((mismatches + 1))
      printf 'parity mismatch on case %s: shell=%s port=%s text=%s\n' "$index" "$shell_verdict" "$port_verdict" "$(od -c "$file" | head -3 | tr '\n' ' ')" >&2
    fi
    index=$((index + 1))
  done
  [ "$compared" -eq "$count" ] || fail "compared $compared of $count parity cases"
  [ "$mismatches" -eq 0 ] || fail "the TypeScript classifier diverged from bin/fm-operational-input.sh on $mismatches of $count cases"
  # The corpus must exercise every current kind and the legacy shapes, or parity is vacuous.
  generic_kinds=$(canonical_generic_kinds) || fail "could not reread generic kinds from the operational-input owner"
  [ -n "$generic_kinds" ] || fail "the operational-input owner exposes no generic kinds"
  for kind in $generic_kinds from-firstmate legacy-operational; do
    grep -q "	$kind\$" "$corpus/port-verdicts.tsv" || fail "the parity corpus never produced the $kind verdict"
  done
  grep -q '	none$' "$corpus/port-verdicts.tsv" || fail "the parity corpus never produced a non-operational verdict"
  pass "the mod's operational-input classifier agrees with bin/fm-operational-input.sh on all $count corpus cases: every current kind the owner encodes, every legacy shape, and every near miss"
}

test_plugin_shape
test_shared_sprite_and_pi_rendering
test_presentation_policy
test_fade_policy
test_classifier_parity_with_shell_owner
