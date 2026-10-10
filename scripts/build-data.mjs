#!/usr/bin/env node
// Compile the examples for every arch/opt combination, run Ghidra headless over the
// stripped binaries, and merge its output with DWARF line info into src/data/decomp.json.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BUILD = join(ROOT, 'build');
const EXAMPLES_DIR = join(ROOT, 'examples');
const OUT = join(ROOT, 'public', 'data', 'decomp.json');

const ARCHES = ['x86_64', 'arm64'];
const OPTS = ['O0', 'O1', 'O2'];
const GHIDRA_HOME = process.env.GHIDRA_HOME ?? '/opt/homebrew/opt/ghidra/libexec';
const JAVA_HOME =
  process.env.GHIDRA_JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

const examples = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'examples.json'), 'utf8'));
const sources = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.c'));

rmSync(BUILD, { recursive: true, force: true });
for (const d of ['obj', 'debug', 'stripped', 'ghidra-out', 'ghidra-proj']) {
  mkdirSync(join(BUILD, d), { recursive: true });
}

const variants = {};
for (const arch of ARCHES) {
  for (const opt of OPTS) {
    const id = `${arch}-${opt}`;
    console.log(`compiling ${id}`);
    const objDir = join(BUILD, 'obj', id);
    mkdirSync(objDir, { recursive: true });
    // Separate objects (rather than one clang call) so the .o files outlive the link
    // and dsymutil can collect their DWARF.
    const objs = sources.map((src) => {
      const obj = join(objDir, basename(src, '.c') + '.o');
      run('clang', ['-arch', arch, `-${opt}`, '-g', '-c', join(EXAMPLES_DIR, src), '-o', obj]);
      return obj;
    });
    const debugBin = join(BUILD, 'debug', id);
    run('clang', ['-arch', arch, ...objs, '-o', debugBin]);
    run('dsymutil', [debugBin]);
    run('strip', ['-o', join(BUILD, 'stripped', id), debugBin]);

    const functions = {};
    for (const line of run('nm', ['-n', debugBin]).split('\n')) {
      const m = line.match(/^([0-9a-f]+) T _(\w+)$/);
      if (m && examples.some((e) => e.id === m[2])) functions[m[2]] = `0x${m[1]}`;
    }
    variants[id] = { arch, opt, functions, lines: parseLineTable(`${debugBin}.dSYM`) };
  }
}

const annotations = Object.fromEntries(
  examples.map(({ id, prototype, types, renames, renamesByVariant }) => [
    id,
    { prototype, types, renames, renamesByVariant },
  ]),
);
const manifestPath = join(BUILD, 'manifest.json');
writeFileSync(
  manifestPath,
  JSON.stringify({
    variants: Object.fromEntries(
      Object.entries(variants).map(([id, v]) => [id, { functions: v.functions }]),
    ),
    annotations,
  }),
);

console.log('running ghidra headless (this takes a minute)');
run(
  join(GHIDRA_HOME, 'support', 'analyzeHeadless'),
  [
    join(BUILD, 'ghidra-proj'), 'decomp-explorer',
    '-import', join(BUILD, 'stripped'),
    '-scriptPath', join(ROOT, 'ghidra'),
    '-postScript', 'ExportDecomp.java', manifestPath, join(BUILD, 'ghidra-out'),
    '-deleteProject',
  ],
  { env: { ...process.env, JAVA_HOME }, stdio: ['ignore', 'pipe', 'inherit'] },
);

const clangVersion = run('clang', ['--version']).split('\n')[0];
const data = { clangVersion, ghidraVersion: null, examples: [], variants: {} };
for (const ex of examples) {
  data.examples.push({
    id: ex.id,
    file: ex.file,
    title: ex.title,
    lesson: ex.lesson,
    source: readFileSync(join(EXAMPLES_DIR, ex.file), 'utf8'),
  });
}
for (const [id, v] of Object.entries(variants)) {
  const g = JSON.parse(readFileSync(join(BUILD, 'ghidra-out', `${id}.json`), 'utf8'));
  data.ghidraVersion = g.ghidraVersion;
  const functions = {};
  for (const ex of examples) {
    const f = g.functions[ex.id];
    if (!f) throw new Error(`${id}: ghidra exported nothing for ${ex.id}`);
    for (const ins of f.instructions) {
      ins.line = lineFor(v.lines, parseInt(ins.addr, 16), ex.file);
    }
    functions[ex.id] = f;
  }
  data.variants[id] = { arch: v.arch, opt: v.opt, languageId: g.languageId, functions };
}

mkdirSync(join(ROOT, 'public', 'data'), { recursive: true });
writeFileSync(OUT, JSON.stringify(data));
console.log(`wrote ${OUT}`);

// Returns [{ addr, line, file, end }] rows from every CU's line program.
function parseLineTable(dsym) {
  const rows = [];
  let files = {};
  for (const line of run('dwarfdump', ['--debug-line', dsym]).split('\n')) {
    if (line.startsWith('debug_line[')) files = {};
    const fileIdx = line.match(/^file_names\[\s*(\d+)\]:/);
    if (fileIdx) files.pending = Number(fileIdx[1]);
    const name = line.match(/^\s+name: "(.+)"$/);
    if (name && files.pending !== undefined) {
      files[files.pending] = basename(name[1]);
      delete files.pending;
    }
    const row = line.match(/^0x([0-9a-f]+)\s+(\d+)\s+\d+\s+(\d+)\s.*?(end_sequence)?\s*$/);
    if (row) {
      rows.push({
        addr: parseInt(row[1], 16),
        line: Number(row[2]),
        file: files[row[3]],
        end: Boolean(row[4]),
      });
    }
  }
  // A sequence's end_sequence row can share an address with the next sequence's
  // first row; the end must sort first or it would erase that row.
  return rows.sort((a, b) => a.addr - b.addr || b.end - a.end);
}

// Source line for an instruction: the last line-table row at or before it, or null
// when the compiler marked it line 0 (code with no single source line).
function lineFor(rows, addr, file) {
  let best = null;
  for (const r of rows) {
    if (r.addr > addr) break;
    best = r.end ? null : r;
  }
  if (!best || best.file !== file || best.line === 0) return null;
  return best.line;
}
