import { useMemo } from 'react';
import { focusFromLine, isActive, useFocus, useTrace } from '../focus';
import type { FunctionData } from '../types';

const C_TOKEN =
  /(\/\/.*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*")|\b(int|unsigned|long|char|float|const|struct|void|return|if|else|for|while|switch|case|default|break)\b|\b(0x[0-9a-f]+|\d+(?:\.\d+)?f?)\b|(#\w+.*)/gi;

const KIND = ['comment', 'string', 'keyword', 'const', 'special'] as const;

function highlightC(line: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(C_TOKEN)) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const kind = KIND[m.slice(1).findIndex(Boolean)];
    out.push(
      <span key={m.index} className={`k-${kind}`}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  out.push(line.slice(last));
  return out;
}

/** The original C. Lines that produced instructions in this build get a gutter dot. */
export function SourceView({ source, fn }: { source: string; fn: FunctionData }) {
  const { focus } = useFocus();
  const trace = useTrace();
  const lines = useMemo(() => source.replace(/\n$/, '').split('\n'), [source]);
  const codeLines = useMemo(
    () => new Set(fn.instructions.map((i) => i.line).filter((l): l is number => l !== null)),
    [fn],
  );
  const active = isActive(focus);

  return (
    <pre className="code source">
      {lines.map((text, i) => {
        const n = i + 1;
        const hasCode = codeLines.has(n);
        const lit = focus.lines.has(n);
        return (
          <div
            key={n}
            className={`row${lit ? ' lit' : ''}${active && !lit ? ' dim' : ''}${hasCode ? ' live' : ''}`}
            {...(hasCode ? trace(focusFromLine(fn, n)) : {})}
          >
            <span className="gutter">
              <span className="ln">{n}</span>
              <span className={hasCode ? 'dot' : 'dot none'} />
            </span>
            <span>{highlightC(text)}</span>
          </div>
        );
      })}
    </pre>
  );
}
