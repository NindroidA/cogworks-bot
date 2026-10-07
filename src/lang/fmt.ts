/**
 * Named placeholders for lang strings (NindroidA/cogworks-bot#41, step A6).
 *
 * A lang string marks each value it takes with a name in braces:
 * `"Tag **{tag}** added to {channel}."`, filled with
 * `fmt(tl.add.success, { tag, channel: `<#${id}>` })`. Names let a translation
 * reorder the values, and the call site says what each one is.
 *
 * `tests/unit/lang/keys.test.ts` checks every `fmt(lang.x.y, { ... })` call:
 * the object's keys must be exactly the string's placeholders.
 */

/** The values for a lang string's `{name}` placeholders. */
export type FmtParams = Readonly<Record<string, string | number>>;

/**
 * Fills every `{name}` placeholder that `params` has a value for; any other
 * `{x}` stays as written, so a string that shows `{user}` to explain an admin
 * template's syntax is safe. Values go in as written: a `$` in one is never read
 * as a `String.replace` pattern, and a value that itself contains `{x}` isn't
 * filled again.
 *
 * Keep this separate from the admin-authored template engines (announcement,
 * XP level-up and onboarding welcome messages), which have their own syntax.
 */
export function fmt(template: string, params: FmtParams): string {
  return template.replace(/\{([A-Za-z_]\w*)\}/g, (match, name: string) => {
    // typeof, not `in`: an inherited key such as `constructor` must not fill a placeholder.
    const value: unknown = params[name];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : match;
  });
}
