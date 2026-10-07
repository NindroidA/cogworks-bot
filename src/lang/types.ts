/**
 * The shape of every language string, derived from the English JSON
 * (`./en`), so the JSON files are the only place a key is declared: a key
 * added there is typed everywhere, and code that reads a missing key fails
 * `tsc`. JSON imports widen every value to `string` or `string[]`.
 */

import type { englishModules } from './en';

export type Language = typeof englishModules;
