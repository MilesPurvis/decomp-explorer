import { createContext, useContext } from 'react';
import type { FunctionData } from './types';

/**
 * What's currently traced across every view: a set of instruction addresses and
 * the source lines they came from. Each view resolves its own highlights from this.
 */
export interface Focus {
  addrs: ReadonlySet<string>;
  lines: ReadonlySet<number>;
}

export const NO_FOCUS: Focus = { addrs: new Set(), lines: new Set() };

export function focusFromAddrs(fn: FunctionData, addrs: Iterable<string>): Focus {
  const set = new Set(addrs);
  const lines = new Set<number>();
  for (const ins of fn.instructions) {
    if (set.has(ins.addr) && ins.line !== null) lines.add(ins.line);
  }
  return { addrs: set, lines };
}

export function focusFromLine(fn: FunctionData, line: number): Focus {
  const addrs = new Set<string>();
  for (const ins of fn.instructions) {
    if (ins.line === line) addrs.add(ins.addr);
  }
  return { addrs, lines: new Set([line]) };
}

export const isActive = (f: Focus) => f.addrs.size > 0 || f.lines.size > 0;

export interface FocusApi {
  focus: Focus;
  pinned: boolean;
  /** Preview a focus on hover; null ends the preview. */
  hover: (f: Focus | null) => void;
  /** Pin a focus so it survives the mouse leaving; pinning the same thing again unpins. */
  pin: (f: Focus) => void;
}

export const FocusContext = createContext<FocusApi>({
  focus: NO_FOCUS,
  pinned: false,
  hover: () => {},
  pin: () => {},
});

export const useFocus = () => useContext(FocusContext);

/** Props that make an element hoverable/pinnable for the given focus. */
export function useTrace() {
  const { hover, pin } = useFocus();
  return (f: Focus) => ({
    onMouseEnter: () => hover(f),
    onMouseLeave: () => hover(null),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      pin(f);
    },
  });
}
