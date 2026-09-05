/**
 * Fold the src/ module graph into one CommonJS file.
 *
 * Node's single-executable support takes exactly one script and it must be
 * CommonJS, while this project is ESM across nineteen files. Every general
 * answer to that - esbuild, rollup, webpack - is an npm dependency, and the
 * zero-dependency property is one of the few things here that a reviewer can
 * verify at a glance rather than take on trust. So this is the specific answer
 * instead: a bundler that handles the subset of ESM this codebase actually
 * uses, and refuses anything outside it rather than guessing.
 *
 * What it supports, because that is what src/ contains:
 *
 *   import x from 'node:fs'            default import, builtins only
 *   import { a, b as c } from './x.js' named imports, with renaming
 *   import * as ns from './x.js'       namespace import
 *   export function|class|const|let    named exports
 *   import.meta.url                    rewritten to a __filename-derived URL
 *
 * What it refuses, loudly: default exports, dynamic import(), top-level await,
 * cyclic dependencies, and relative default imports. Each of those needs real
 * machinery to do correctly, and a bundler that silently half-does them would
 * produce an executable that fails somewhere far from the cause.
 *
 *   node scripts/bundle.mjs [out.cjs]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'src/main.js';

/** @param {string} p a path relative to ROOT, forward slashes */
function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

/** Turn a specifier resolved from `fromKey` into a ROOT-relative key. */
function resolveKey(fromKey, spec) {
  const dir = path.posix.dirname(fromKey);
  return path.posix.normalize(path.posix.join(dir, spec));
}

const isBuiltin = (spec) => spec.startsWith('node:');
const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../');

/**
 * One module's import statements, with the source they should be replaced by.
 *
 * Only lines beginning at column 0 are considered. That is not laziness: the
 * codebase is full of JSDoc `@param {import('./x.js').T}` annotations inside
 * indented comment blocks, and a transform that matched those would rewrite
 * documentation into broken code.
 */
function transform(key, source) {
  /** @type {string[]} */
  const deps = [];
  /** @type {string[]} */
  const exported = [];

  const lines = source.split('\n');
  /** @type {string[]} */
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // --- imports ---------------------------------------------------------
    if (/^import\s/.test(line)) {
      // Join continuation lines until the statement's closing quote, so a
      // multi-line named import is handled rather than mangled.
      while (!/from\s+['"][^'"]+['"]\s*;?\s*$/.test(line) && !/^import\s+['"]/.test(line) && i + 1 < lines.length) {
        i += 1;
        line += ' ' + lines[i].trim();
      }

      const m = line.match(/^import\s+(.*?)\s*from\s*['"]([^'"]+)['"]/);
      if (!m) {
        // A bare side-effect import: `import './x.js'`.
        const bare = line.match(/^import\s*['"]([^'"]+)['"]/);
        if (!bare) throw new Error(`${key}: cannot parse import: ${line.trim()}`);
        const spec = bare[1];
        if (isRelative(spec)) {
          const dep = resolveKey(key, spec);
          deps.push(dep);
          out.push(`__mods[${JSON.stringify(dep)}];`);
        } else {
          out.push(`require(${JSON.stringify(spec)});`);
        }
        continue;
      }

      const [, clause, spec] = m;
      let rhs;
      if (isBuiltin(spec)) {
        rhs = `require(${JSON.stringify(spec)})`;
      } else if (isRelative(spec)) {
        const dep = resolveKey(key, spec);
        deps.push(dep);
        rhs = `__mods[${JSON.stringify(dep)}]`;
      } else {
        throw new Error(`${key}: bare specifier "${spec}" is not a builtin and this project has no dependencies`);
      }

      const namespace = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      const named = clause.match(/^\{([\s\S]*)\}$/);

      if (namespace) {
        out.push(`const ${namespace[1]} = ${rhs};`);
      } else if (named) {
        // `{ a, b as c }` -> `{ a, b: c }`, which is the destructuring form.
        const bindings = named[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const as = s.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
            return as ? `${as[1]}: ${as[2]}` : s;
          });
        out.push(`const { ${bindings.join(', ')} } = ${rhs};`);
      } else if (/^[A-Za-z_$][\w$]*$/.test(clause)) {
        if (!isBuiltin(spec)) {
          throw new Error(`${key}: default import from "${spec}"; this bundler only supports default imports of builtins`);
        }
        out.push(`const ${clause} = ${rhs};`);
      } else {
        throw new Error(`${key}: unsupported import clause: ${clause}`);
      }
      continue;
    }

    // --- exports ---------------------------------------------------------
    if (/^export\s+default\b/.test(line)) {
      throw new Error(`${key}: export default is not supported; use a named export`);
    }

    let m = line.match(/^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) {
      exported.push(m[2]);
      out.push(line.replace(/^export\s+/, ''));
      continue;
    }

    m = line.match(/^export\s+class\s+([A-Za-z_$][\w$]*)/);
    if (m) {
      exported.push(m[1]);
      out.push(line.replace(/^export\s+/, ''));
      continue;
    }

    m = line.match(/^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/);
    if (m) {
      exported.push(m[2]);
      out.push(line.replace(/^export\s+/, ''));
      continue;
    }

    m = line.match(/^export\s*\{([^}]*)\}/);
    if (m) {
      for (const part of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        const as = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
        exported.push(as ? as[2] : part);
      }
      continue; // the binding already exists in scope; the statement goes away
    }

    if (/^export\s/.test(line)) {
      throw new Error(`${key}: unsupported export form: ${line.trim()}`);
    }

    out.push(line);
  }

  let body = out.join('\n');

  // --- things the whole file must not contain -----------------------------
  //
  // Checked against a comment-stripped copy. Every module here carries JSDoc
  // types of the form `@param {import('../llm/client.js').LLMClient}`, and a
  // check run over the raw text rejects all of them as dynamic imports. The
  // stripping is crude - it will also eat the tail of a line containing "//"
  // inside a string - but nothing is emitted from this copy, so the only cost
  // of being crude is missing a violation, never inventing one.
  const withoutComments = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  if (/\bimport\s*\(/.test(withoutComments)) {
    throw new Error(`${key}: dynamic import() is not supported`);
  }
  if (/^await\s/m.test(withoutComments)) {
    throw new Error(`${key}: top-level await is not supported by a CommonJS bundle`);
  }

  // import.meta.url has no CommonJS equivalent; __filename is the nearest
  // honest one, and the helper never throws so a module that computes a path at
  // load time cannot take the whole executable down with it.
  body = body.replace(/import\.meta\.url/g, '__hd_meta_url');

  return { body, deps, exported };
}

// --- walk the graph ---------------------------------------------------------

/** @type {Map<string, {body: string, deps: string[], exported: string[]}>} */
const modules = new Map();

function load(key) {
  if (modules.has(key)) return;
  const source = read(key);
  const mod = transform(key, source);
  modules.set(key, mod);
  for (const dep of mod.deps) load(dep);
}

load(ENTRY);

// --- order them, refusing cycles --------------------------------------------

/** @type {string[]} */
const order = [];
const state = new Map(); // key -> 'visiting' | 'done'

function visit(key, stack) {
  const s = state.get(key);
  if (s === 'done') return;
  if (s === 'visiting') {
    throw new Error(`import cycle: ${[...stack, key].join(' -> ')}`);
  }
  state.set(key, 'visiting');
  for (const dep of modules.get(key).deps) visit(dep, [...stack, key]);
  state.set(key, 'done');
  order.push(key);
}

visit(ENTRY, []);

// --- emit --------------------------------------------------------------------

const preamble = `/* Generated by scripts/bundle.mjs from ${ENTRY} - do not edit.
 *
 * The src/ tree folded into one CommonJS file, because Node's single-executable
 * support takes one CommonJS script and this project is ESM. Read the sources,
 * not this. Regenerate with: npm run build:exe
 */
'use strict';

const __mods = {};

const __hd_meta_url = (() => {
  try {
    return require('node:url').pathToFileURL(__filename).href;
  } catch {
    return 'file:///';
  }
})();
`;

const chunks = [preamble];

for (const key of order) {
  const mod = modules.get(key);
  const exportsObject = mod.exported.length
    ? `  return { ${mod.exported.join(', ')} };`
    : '  return {};';
  chunks.push(
    `\n// ${'-'.repeat(70)}\n// ${key}\n// ${'-'.repeat(70)}\n` +
    `__mods[${JSON.stringify(key)}] = (function () {\n` +
    mod.body.replace(/^/gm, '  ').replace(/^\s+$/gm, '') +
    `\n${exportsObject}\n})();\n`,
  );
}

const outPath = process.argv[2] ?? path.join(ROOT, 'dist', 'historical-director.cjs');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, chunks.join(''), 'utf8');

const bytes = fs.statSync(outPath).size;
console.log(`bundled ${order.length} modules into ${path.relative(ROOT, outPath)} (${(bytes / 1024).toFixed(0)} KB)`);
console.log(`order: ${order.join(' -> ')}`);
