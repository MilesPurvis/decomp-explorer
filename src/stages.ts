import type { Arch, FunctionData, Stage } from './types';

export interface StageInfo {
  id: Stage;
  step: string;
  title: string;
  /** What was thrown away or invented at this point. */
  lost?: string[];
  body: (ctx: { arch: Arch; fn: FunctionData }) => string;
}

export const STAGES: StageInfo[] = [
  {
    id: 'bytes',
    step: 'Bytes',
    title: 'What the decompiler actually gets',
    lost: ['source', 'names', 'types', 'comments', 'line numbers'],
    body: ({ arch, fn }) =>
      `This binary is stripped, so the decompiler gets machine code and nothing else. Even the function's name is gone, so Ghidra calls it \`${fn.ghidraName}\`. ` +
      (arch === 'x86_64'
        ? 'x86-64 instructions vary in length from 1 to 15 bytes, so you can only find where one ends by decoding from a known starting point.'
        : 'ARM64 instructions are always exactly 4 bytes, so finding where each one starts is trivial.'),
  },
  {
    id: 'disasm',
    step: 'Disassemble',
    title: 'Bytes → instructions',
    body: () =>
      'The disassembler decodes each instruction from the CPU’s instruction-set spec. This step loses nothing: every instruction maps to exactly one set of bytes. Jump targets get made-up labels like `LAB_…`. The `L#` badges come from debug info kept on the side for this explorer, and Ghidra never sees them.',
  },
  {
    id: 'lift',
    step: 'Lift',
    title: 'Instructions → P-code',
    body: ({ arch }) =>
      `Each instruction is translated into P-code, Ghidra’s architecture-neutral intermediate language with a few dozen operations (COPY, INT_ADD, LOAD, CBRANCH, …). One instruction can expand into many operations: ${arch === 'arm64' ? 'an ARM64 `cmp` computes all four condition flags' : 'even an x86 `xor edx,edx` (just “set to zero”) computes five flags'}, and most of them are never used. From here on, nothing depends on which CPU the code came from. Switch the architecture to see the same operations.`,
  },
  {
    id: 'cfg',
    step: 'Control flow',
    title: 'Find blocks and edges',
    body: () =>
      'Branches split the code into basic blocks: straight runs with one way in and one way out. Edges show where control can go next. An edge pointing back up is a loop. A block with a fan of exits is a jump table. Recovering `if`/`while`/`switch` means matching patterns in this graph.',
  },
  {
    id: 'decompile',
    step: 'Decompile',
    title: 'Rebuild C',
    lost: ['names → invented', 'types → guessed'],
    body: () =>
      'Data-flow analysis turns registers and stack slots into variables, removes the flag computations nothing reads, and guesses types from how values are used: something that gets dereferenced is a pointer, something compared as signed is an `int`. Structuring then maps the graph onto `if`/`while`/`switch`. Names are generated: `param_1` is the first argument, `iVar2` is an int in a register, and `local_18` is a stack slot 0x18 bytes below the frame.',
  },
  {
    id: 'annotate',
    step: 'Annotate',
    title: 'Add back what was lost',
    body: () =>
      'The decompiler can’t recover meaning, so a person adds it. Here a script does what an analyst would: rename the function, apply a signature, define the struct, and name the locals. Ghidra then re-derives everything else, including field accesses, casts and types. In a real binary, this step is most of the work.',
  },
];
