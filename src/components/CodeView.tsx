import { useMemo } from 'react';
import { focusFromAddrs, isActive, useFocus } from '../focus';
import type { CLine, Decomp, FunctionData } from '../types';

const INDENT = '  ';

/** Drop Ghidra's leading/trailing blank lines and collapse runs of blanks. */
function tidy(lines: CLine[]) {
  const blank = (l: CLine) => l.tokens.every((t) => !t.t.trim());
  const out: CLine[] = [];
  for (const l of lines) {
    if (blank(l) && (out.length === 0 || blank(out[out.length - 1]))) continue;
    out.push(l);
  }
  while (out.length && blank(out[out.length - 1])) out.pop();
  return out;
}

/** Decompiled C from Ghidra. Hover a token for its exact instructions, or a line for all of them. */
export function CodeView({ decomp, fn }: { decomp: Decomp; fn: FunctionData }) {
  const { focus, hover, pin } = useFocus();
  const lines = useMemo(() => tidy(decomp.lines ?? []), [decomp]);
  if (decomp.error) return <div className="empty">Ghidra failed: {decomp.error}</div>;

  const active = isActive(focus);
  // Hover is resolved from the event target so moving between tokens on one line
  // doesn't flicker through "no focus".
  const focusAt = (target: EventTarget, line: CLine) => {
    const el = (target as HTMLElement).closest<HTMLElement>('[data-tok]');
    const tok = el ? line.tokens[Number(el.dataset.tok)] : undefined;
    const addrs = tok?.a ?? line.tokens.flatMap((t) => t.a ?? []);
    return addrs.length ? focusFromAddrs(fn, addrs) : null;
  };

  return (
    <pre className="code decomp">
      {lines.map((line, i) => {
        const lineLit = line.tokens.some((t) => t.a?.some((a) => focus.addrs.has(a)));
        return (
          <div
            key={i}
            className={`row${lineLit ? ' lit' : ''}${active && !lineLit ? ' dim' : ''}`}
            onMouseOver={(e) => hover(focusAt(e.target, line))}
            onMouseLeave={() => hover(null)}
            onClick={(e) => {
              e.stopPropagation();
              const f = focusAt(e.target, line);
              if (f) pin(f);
            }}
          >
            <span>{INDENT.repeat(line.indent)}</span>
            {line.tokens.map((t, j) => (
              <span
                key={j}
                data-tok={j}
                className={`k-${t.k}${t.a?.some((a) => focus.addrs.has(a)) ? ' tok-lit' : ''}`}
              >
                {t.t}
              </span>
            ))}
          </div>
        );
      })}
    </pre>
  );
}
