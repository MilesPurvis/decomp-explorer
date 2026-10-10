// Shape of public/data/decomp.json, as written by scripts/build-data.mjs.

export type Arch = 'x86_64' | 'arm64';
export type Opt = 'O0' | 'O1' | 'O2';

export type TokenKind =
  | 'keyword'
  | 'comment'
  | 'type'
  | 'function'
  | 'variable'
  | 'const'
  | 'parameter'
  | 'global'
  | 'default'
  | 'error'
  | 'special';

export interface Token {
  t: string;
  k: TokenKind;
  /** Instruction addresses this token was decompiled from. */
  a?: string[];
}

export interface CLine {
  indent: number;
  tokens: Token[];
}

export interface Decomp {
  signature?: string;
  lines?: CLine[];
  error?: string;
}

export interface Instruction {
  addr: string;
  bytes: string;
  mnemonic: string;
  text: string;
  flow: string;
  pcode: string[];
  /** Source line from DWARF, or null for compiler-generated code. */
  line: number | null;
}

export type EdgeKind = 'fallthrough' | 'conditional' | 'jump' | 'computed';

export interface Block {
  start: string;
  end: string;
  edges: { to: string; kind: EdgeKind }[];
}

export interface FunctionData {
  ghidraName: string;
  entry: string;
  instructions: Instruction[];
  blocks: Block[];
  raw: Decomp;
  annotated: Decomp;
  analystSteps: string[];
}

export interface Variant {
  arch: Arch;
  opt: Opt;
  languageId: string;
  functions: Record<string, FunctionData>;
}

export interface Example {
  id: string;
  file: string;
  title: string;
  lesson: string;
  source: string;
}

export interface DecompData {
  clangVersion: string;
  ghidraVersion: string;
  examples: Example[];
  variants: Record<string, Variant>;
}

export type Stage = 'bytes' | 'disasm' | 'lift' | 'cfg' | 'decompile' | 'annotate';
