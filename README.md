# Decomp Explorer

Step through what a decompiler does to a compiled function: bytes → disassembly →
P-code → control-flow graph → decompiled C → analyst-annotated C. Every view is
linked, so hovering a line traces it through the others and back to the source.

All machine code and decompiler output is real: the examples are compiled with clang
for x86-64 and ARM64 at `-O0`/`-O1`/`-O2`, stripped, and run through Ghidra headless.

**Live:** https://milespurvis.github.io/decomp-explorer/

## Run

```sh
npm install
npm run dev
```

`public/data/decomp.json` is checked in, so the app runs without Ghidra.

## Regenerate the data

Requires Xcode command-line tools and Ghidra (`brew install ghidra`, which pulls in
OpenJDK 21).

```sh
npm run data
```

`scripts/build-data.mjs` does the following:

1. Compiles each `examples/*.c` to a per-file `.o` with `-g` and links them into one
   binary per arch/opt.
2. Runs `dsymutil` to get the DWARF line table. That's where the `L#` badges come from;
   Ghidra never sees it.
3. Strips the binary and runs `analyzeHeadless` with `ghidra/ExportDecomp.java`, which
   exports instructions, raw P-code, basic blocks and decompiled C. It then applies each
   example's annotations (prototype, struct types, local renames) and decompiles again.

Override paths with `GHIDRA_HOME` / `GHIDRA_JAVA_HOME` if Ghidra isn't at the
Homebrew location.

## Add an example

1. Add `examples/<name>.c` with a non-static function `<name>`, and call it from
   `examples/main.c`.
2. Add an entry to `examples/examples.json` with `id`, `file`, `title`, `lesson` and
   `prototype`, plus `types` for any structs.
3. Run `npm run data` and check the output. Ghidra's generated local names (`iVar1`,
   `local_18`, …) vary per build, so add `renamesByVariant` after you've seen them.

## Deploy

Every push to `main` builds the app and deploys it to GitHub Pages
(`.github/workflows/pages.yml`). CI uses the checked-in data and doesn't run Ghidra.

## License

MIT
