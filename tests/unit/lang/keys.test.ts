/**
 * Language key check (NindroidA/cogworks-bot#41, step A3).
 *
 * Parses every `.ts` file under `src/` with the TypeScript parser (syntax only,
 * no type checker, so it takes well under a second and gives the same answer on
 * every run) and works out which English keys the code reads. It follows:
 *   - `lang.a.b.c` chains on a named `lang` import (or `lang as X`) and on a
 *     default import of `lang/en/<file>.json`, through `?.`, `!`, `as` and
 *     `satisfies` casts, parentheses and `x['literal']`;
 *   - local aliases: `const tl = lang.ticket`, aliases of aliases
 *     (`const tc = tl.close`) and destructuring (`const { close } = tl`);
 *   - parameters typed `typeof lang.x.y`, whose reads count like an alias's;
 *   - block scope and shadowing (a callback's own `tl` hides an outer alias).
 * Whatever it can't follow counts as reading every key under it, so it can miss
 * a dead key but never flags a live one: a lang object passed to a function,
 * spread, stored or returned, and `x[expr]` with a computed key (`tl.levels[level]`
 * reads all of `status.levels`). An object passed to a function call is fine
 * when some parameter is typed `typeof` that same path, since its reads count.
 *
 * It fails on:
 *   1. a read of a key that `src/lang/en/*.json` doesn't have;
 *   2. a key nothing reads, unless `deadKeys.allowlist.json` lists it (the dead
 *      keys when this test landed, deleted or wired up in later steps); an entry
 *      that is read again or no longer exists fails too, so the list only shrinks;
 *   3. placeholder mismatches: `fmt(key, { ... })` whose object keys aren't
 *      exactly the template's `{name}` placeholders, or whose template has a
 *      numbered `{0}` (fmt fills only named ones; for `fmt(cond ? a : b, ...)`
 *      both strings are checked, and an object with a spread or computed key is
 *      skipped), and any `key.replace('{x}', ...)` on a lang string, which
 *      should be an fmt call;
 *   4. a string in `src/lang/en` with a numbered `{0}`, which nothing fills.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { lang } from '../../../src/lang';
import allowlist from './deadKeys.allowlist.json';

type Path = readonly string[];
/** What a name in scope holds: a fixed lang path, an expression (plus destructured props) or a `typeof` type. */
type Binding = { path: Path } | { expr: ts.Expression; props: string[] } | { type: ts.EntityName } | null;
type Wrapper = ts.ParenthesizedExpression | ts.AsExpression | ts.NonNullExpression | ts.SatisfiesExpression;

/** Keys whose `{user}`-style text documents an admin template's syntax and is shown as written. */
const LITERAL_PLACEHOLDERS = new Map([['xp.config.currentLevelUpMessage', ['{user}', '{level}']]]);

const ROOT = process.cwd();
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const get = (path: Path): unknown =>
  path.reduce<unknown>((v, k) => (isObj(v) && Object.hasOwn(v, k) ? v[k] : undefined), lang);
const leafKeys = (v: unknown, prefix: Path): string[] =>
  isObj(v) ? Object.entries(v).flatMap(([k, c]) => leafKeys(c, [...prefix, k])) : [prefix.join('.')];
const isWrapper = (n: ts.Node): n is Wrapper =>
  ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n);
const where = (node: ts.Node) => {
  const sf = node.getSourceFile();
  return `${relative(ROOT, sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
};

const used = new Set<string>();
const missing: string[] = [];
const placeholderErrors: string[] = [];
let fmtCallsChecked = 0;
const markAll = (path: Path) => {
  for (const key of leafKeys(get(path), path)) used.add(key);
};

const scopes = new Map<ts.Node, Map<string, Binding>>();
const bind = (scope: ts.Node, name: string, binding: Binding) => {
  if (!scopes.has(scope)) scopes.set(scope, new Map());
  scopes.get(scope)!.set(name, binding);
};

/** Records every declaration, so a non-lang one shadows an outer alias of the same name. */
function collectBindings(node: ts.Node): void {
  if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === 'lang') {
    bind(node.getSourceFile(), node.name.text, { path: [] });
  } else if (ts.isImportClause(node) && node.name && ts.isStringLiteral(node.parent.moduleSpecifier)) {
    const file = /\/lang\/en\/(\w+)\.json$/.exec(node.parent.moduleSpecifier.text)?.[1];
    if (file) bind(node.getSourceFile(), node.name.text, { path: [file] });
  } else if (ts.isVariableDeclaration(node)) {
    const statement = node.parent.parent; // the block, loop or file a const/let belongs to
    const scope = ts.isVariableStatement(statement) ? statement.parent : statement;
    const bindName = (name: ts.BindingName, props: string[]): void => {
      if (ts.isIdentifier(name)) bind(scope, name.text, node.initializer ? { expr: node.initializer, props } : null);
      else
        for (const el of name.elements) {
          if (ts.isOmittedExpression(el)) continue;
          const key = el.propertyName ?? el.name;
          const prop = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
          if (ts.isObjectBindingPattern(name) && prop && !el.dotDotDotToken) bindName(el.name, [...props, prop]);
          else if (ts.isIdentifier(el.name)) bind(scope, el.name.text, null);
        }
    };
    bindName(node.name, []);
  } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
    bind(node.parent, node.name.text, node.type && ts.isTypeQueryNode(node.type) ? { type: node.type.exprName } : null);
  }
  ts.forEachChild(node, collectBindings);
}

/** One property step from `base`; records a read of a key the JSON doesn't have. */
const step =
  (node: ts.Node) =>
  (base: Path | null, key: string): Path | null => {
    if (!base || !isObj(get(base))) return null; // not lang, or a string/array (`.length`, `.replace()`)
    if (get([...base, key]) !== undefined) return [...base, key];
    missing.push(`${where(node)} reads ${[...base, key].join('.')}`);
    return null;
  };

const bindingPaths = new Map<Binding, Path | null>();
function resolveBinding(binding: Binding): Path | null {
  if (!binding || 'path' in binding) return binding?.path ?? null;
  if (!bindingPaths.has(binding)) {
    bindingPaths.set(binding, null); // guards a self-referencing declaration
    const node = 'type' in binding ? binding.type : binding.expr;
    const base = resolve(node);
    bindingPaths.set(binding, 'props' in binding ? binding.props.reduce(step(node), base) : base);
  }
  return bindingPaths.get(binding)!;
}

const resolved = new Map<ts.Node, Path | null>();
/** The lang path an expression evaluates to, or null when it isn't a lang value. */
function resolve(node: ts.Node): Path | null {
  if (resolved.has(node)) return resolved.get(node)!;
  let path: Path | null = null;
  if (isWrapper(node)) path = resolve(node.expression);
  else if (ts.isIdentifier(node)) {
    let n: ts.Node | undefined = node.parent;
    while (n && scopes.get(n)?.get(node.text) === undefined) n = n.parent;
    path = n ? resolveBinding(scopes.get(n)!.get(node.text)!) : null;
  } else if (ts.isQualifiedName(node)) path = step(node)(resolve(node.left), node.right.text);
  else if (ts.isPropertyAccessExpression(node)) path = step(node)(resolve(node.expression), node.name.text);
  else if (ts.isElementAccessExpression(node)) {
    const base = resolve(node.expression);
    if (ts.isStringLiteralLike(node.argumentExpression)) path = step(node)(base, node.argumentExpression.text);
    else if (base && isObj(get(base))) markAll(base); // computed key: any child may be read
  }
  resolved.set(node, path);
  return path;
}

/** Paths some parameter is typed as (`typeof lang.x.y`). */
const typedParams = new Set<string>();

/** A lang object read here leaves the analysis unless the chain goes on, it seeds an alias, or a typed parameter takes it. */
function escapes(node: ts.Node, path: Path): boolean {
  let n = node;
  while (isWrapper(n.parent)) n = n.parent;
  const p = n.parent;
  if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n) return false;
  if (ts.isVariableDeclaration(p) && p.initializer === n) return false;
  return !(ts.isCallExpression(p) && p.expression !== n && typedParams.has(path.join('.')));
}

function isReference(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return true;
  const p = node.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node };
  return ts.isIdentifier(node) && (p.name !== node || ts.isShorthandPropertyAssignment(p)) && p.propertyName !== node;
}

const placeholdersOf = (path: Path, template: string): string[] =>
  (template.match(/\{\w+\}/g) ?? []).filter(p => !LITERAL_PLACEHOLDERS.get(path.join('.'))?.includes(p));
/** The strings an expression can be: both branches of `cond ? a : b`, else itself. */
const branches = (node: ts.Expression): ts.Expression[] => {
  while (isWrapper(node)) node = node.expression;
  return ts.isConditionalExpression(node) ? [...branches(node.whenTrue), ...branches(node.whenFalse)] : [node];
};
/** The keys of an object literal, or null when a spread or computed key hides some. */
function literalKeys(node: ts.Expression | undefined): string[] | null {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  const keys: string[] = [];
  for (const prop of node.properties) {
    const name = ts.isShorthandPropertyAssignment(prop) || ts.isPropertyAssignment(prop) ? prop.name : undefined;
    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))) return null;
    keys.push(name.text);
  }
  return keys;
}
const isReplace = (n: ts.Node): n is ts.CallExpression & { expression: ts.PropertyAccessExpression } =>
  ts.isCallExpression(n) &&
  ts.isPropertyAccessExpression(n.expression) &&
  /^replace(All)?$/.test(n.expression.name.text);

function checkPlaceholders(call: ts.CallExpression): void {
  if (ts.isIdentifier(call.expression) && call.expression.text === 'fmt') {
    const [first, params] = call.arguments;
    const keys = literalKeys(params);
    if (!first || !keys) return;
    for (const branch of branches(first)) {
      const path = resolve(branch);
      const template = path && get(path);
      if (typeof template !== 'string') continue;
      fmtCallsChecked++;
      const found = [...new Set(placeholdersOf(path, template))].map(p => p.slice(1, -1)).sort();
      const given = [...keys].sort();
      const numbered = found.filter(name => /^\d+$/.test(name));
      if (numbered.length > 0)
        placeholderErrors.push(`${where(call)} fmt(${path.join('.')}) can't fill numbered {${numbered}}: name them`);
      else if (found.join() !== given.join())
        placeholderErrors.push(`${where(call)} fmt(${path.join('.')}) gets {${given}}, template has {${found}}`);
    }
  } else if (isReplace(call) && call.arguments[0]?.getText().includes('{')) {
    // A `.replace('{x}', v)` on a lang string (directly or after other replaces) fills a placeholder by hand.
    let base: ts.Expression = call.expression.expression;
    while (isReplace(base)) base = base.expression.expression;
    const path = resolve(base);
    if (path && typeof get(path) === 'string')
      placeholderErrors.push(`${where(call)} fills ${path.join('.')} with .${call.expression.name.text}(): use fmt()`);
  }
}

function visit(node: ts.Node): void {
  if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
  if (ts.isCallExpression(node)) checkPlaceholders(node);
  const path = isReference(node) ? resolve(node) : null;
  if (path && !isObj(get(path))) used.add(path.join('.'));
  else if (path && escapes(node, path)) markAll(path);
  ts.forEachChild(node, visit);
}

const files = readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
  .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .sort()
  .map(f => join(ROOT, 'src', f))
  .map(file => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true));
for (const sf of files) collectBindings(sf);
for (const names of scopes.values())
  for (const binding of names.values()) {
    const path = binding && 'type' in binding ? resolveBinding(binding) : null;
    if (path) typedParams.add(path.join('.'));
  }
for (const sf of files) visit(sf);

const allKeys = leafKeys(lang, []);
const dead = allKeys.filter(key => !used.has(key));

describe('language keys read in src/', () => {
  test('the scan finds the lang reads', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(used.size).toBeGreaterThan(allKeys.length / 2);
    expect(fmtCallsChecked).toBeGreaterThan(50);
  });

  test('every key the code reads exists in src/lang/en', () => {
    expect(missing).toEqual([]);
  });

  test('no key is dead unless deadKeys.allowlist.json lists it', () => {
    const allowed = new Set<string>(allowlist);
    const live = new Set(allKeys);
    expect({
      // Read these keys, or delete them from the JSON.
      deadNotAllowlisted: dead.filter(key => !allowed.has(key)),
      // Read again, or gone from the JSON: drop them from the allowlist, which only shrinks.
      allowlistedButLiveOrGone: allowlist.filter(key => used.has(key) || !live.has(key)),
    }).toEqual({ deadNotAllowlisted: [], allowlistedButLiveOrGone: [] });
  });

  test('fmt params match the placeholders, and no .replace() fills one', () => {
    expect(placeholderErrors).toEqual([]);
  });

  test('no string uses a numbered {0} placeholder', () => {
    expect(allKeys.filter(key => /\{\d+\}/.test(String(get(key.split('.')))))).toEqual([]);
  });
});
