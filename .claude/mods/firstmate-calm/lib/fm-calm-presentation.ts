// Firstmate Calm presentation policy for the Claude Code mod, kept free of the engine.
//
// This module owns the decisions ../hooks/register.ts applies through `$`: where the
// shared per-home Calm preference lives and how its value reads, and which transcript
// rows Calm hides. User prompts and all assistant text, including mid-turn working
// notes, stay visible; tool rows, tool groups, and canonically classified operational
// user rows hide. docs/calm.md owns the exact
// captain-facing contract and docs/configuration.md
// the persisted preference schema. Everything here is pure so tests run it under Node.
import { classifyFirstmateOperationalText } from "./fm-operational-input.ts";

/** The environment variables that select the effective Firstmate home, as the mod reads them. */
export type CalmHomeEnvironment = {
  readonly FM_HOME?: string | undefined;
  readonly FM_ROOT_OVERRIDE?: string | undefined;
  readonly FM_CONFIG_OVERRIDE?: string | undefined;
};

/** The parent of a path, with either separator; a bare name resolves to itself. */
function parentDirectory(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut > 0 ? trimmed.slice(0, cut) : trimmed;
}

/**
 * The tracked Firstmate code root the mod belongs to: three levels above the plugin
 * folder, whether Claude Code names it through `.claude/skills/<name>`,
 * `.agents/skills/<name>`, or its physical `.claude/mods/<name>` home, which all sit
 * at that same depth.
 */
export function calmCodeRootFromPluginRoot(pluginRoot: string): string {
  return parentDirectory(parentDirectory(parentDirectory(pluginRoot)));
}

/**
 * The per-home `config/calm` path, resolved exactly as the Pi extension resolves it:
 * `FM_HOME`, then `FM_ROOT_OVERRIDE`, then the tracked code root, with
 * `FM_CONFIG_OVERRIDE` naming the config directory outright when present.
 */
export function calmPreferencePath(env: CalmHomeEnvironment, pluginRoot: string): string {
  const configDirectory =
    env.FM_CONFIG_OVERRIDE ||
    `${env.FM_HOME || env.FM_ROOT_OVERRIDE || calmCodeRootFromPluginRoot(pluginRoot)}/config`;
  return `${configDirectory}/calm`;
}

/**
 * Whether a stored preference reads as Calm on. `max` is the legacy value of a removed
 * third level whose behavior is now ordinary Calm; absent or unrecognized reads as off.
 */
export function parseCalmPreference(stored: string | undefined): boolean {
  if (stored === undefined) return false;
  const value = stored.trim();
  return value === "on" || value === "max";
}

/** The exact file content the Pi extension writes for the same choice. */
export function serializeCalmPreference(active: boolean): string {
  return active ? "on\n" : "off\n";
}

/** Whether a user row's text is a canonically classified Firstmate operational input. */
export function userTextIsOperational(text: string): boolean {
  return classifyFirstmateOperationalText(text) !== undefined;
}
