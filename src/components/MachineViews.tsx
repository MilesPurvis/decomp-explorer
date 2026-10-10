import { Fragment, useMemo } from 'react';
import { focusFromAddrs, isActive, useFocus, useTrace } from '../focus';
import type { FunctionData, Instruction } from '../types';

const BYTES_PER_ROW = 16;

/** Hex dump of the function, each byte tinted by the instruction it belongs to. */
export function BytesView({ fn }: { fn: FunctionData }) {
  const { focus } = useFocus();
  const trace = useTrace();
  const rows = useMemo(() => {
    // Addresses come from each byte's own instruction, since the function body can
    // skip alignment padding between blocks.
    const flat = fn.instructions.flatMap((ins, idx) =>
      ins.bytes.split(' ').map((b, off) => ({ b, ins, idx, addr: parseInt(ins.addr, 16) + off })),
    );
    const out: { addr: string; bytes: typeof flat }[] = [];
    for (let i = 0; i < flat.length; i += BYTES_PER_ROW) {
      out.push({ addr: flat[i].addr.toString(16), bytes: flat.slice(i, i + BYTES_PER_ROW) });
    }
    return out;
  }, [fn]);
  const active = isActive(focus);

  return (
    <pre className="code hex">
      {rows.map((row) => (
        <div key={row.addr} className="row">
          <span className="addr">{row.addr}</span>
          <span className="bytes">
            {row.bytes.map(({ b, ins, idx }, i) => {
              const lit = focus.addrs.has(ins.addr);
              return (
                <span
                  key={i}
                  className={`byte ins-${idx % 2}${lit ? ' lit' : ''}${active && !lit ? ' dim' : ''}`}
                  title={ins.text}
                  {...trace(focusFromAddrs(fn, [ins.addr]))}
                >
                  {b}
                </span>
              );
            })}
          </span>
          <span className="ascii">
            {row.bytes.map(({ b }) => {
              const c = parseInt(b, 16);
              return c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.';
            })}
          </span>
        </div>
      ))}
    </pre>
  );
}

const FLOW_ICON: [RegExp, string, string][] = [
  [/CALL/, '↘', 'call'],
  [/TERMINATOR/, '⏎', 'return'],
  [/COMPUTED/, '⇶', 'computed jump (jump table)'],
  [/CONDITIONAL/, '⤵', 'conditional branch'],
  [/JUMP/, '→', 'jump'],
];

function flowIcon(ins: Instruction) {
  const hit = FLOW_ICON.find(([re]) => re.test(ins.flow));
  return hit ? <span className="flow" title={hit[2]}>{hit[1]}</span> : <span className="flow" />;
}

/** Instructions whose addresses start a block that something jumps to. */
export function jumpTargets(fn: FunctionData) {
  const targets = new Set<string>();
  for (const b of fn.blocks) {
    for (const e of b.edges) if (e.kind !== 'fallthrough') targets.add(e.to);
  }
  return targets;
}

function PcodeLine({ op }: { op: string }) {
  const eq = op.indexOf(' = ');
  const lhs = eq >= 0 ? op.slice(0, eq) : null;
  const rest = eq >= 0 ? op.slice(eq + 3) : op;
  const sp = rest.indexOf(' ');
  const opcode = sp >= 0 ? rest.slice(0, sp) : rest;
  return (
    <div className="pcode">
      {lhs && (
        <>
          <span className="p-out">{lhs}</span> ={' '}
        </>
      )}
      <span className="p-op">{opcode}</span>
      {sp >= 0 && <span className="p-in">{rest.slice(sp)}</span>}
    </div>
  );
}

export function DisasmView({
  fn,
  showBytes = true,
  showPcode = false,
}: {
  fn: FunctionData;
  showBytes?: boolean;
  showPcode?: boolean;
}) {
  const { focus } = useFocus();
  const trace = useTrace();
  const targets = useMemo(() => jumpTargets(fn), [fn]);
  const active = isActive(focus);

  return (
    <pre className={`code disasm${showPcode ? ' with-pcode' : ''}`}>
      {fn.instructions.map((ins) => {
        const lit = focus.addrs.has(ins.addr);
        const [mnemonic, ...ops] = ins.text.split(' ');
        return (
          <Fragment key={ins.addr}>
            {targets.has(ins.addr) && <div className="label">LAB_{ins.addr}:</div>}
            <div
              className={`row insn${lit ? ' lit' : ''}${active && !lit ? ' dim' : ''}`}
              {...trace(focusFromAddrs(fn, [ins.addr]))}
            >
              <span className="addr">{ins.addr}</span>
              {showBytes && <span className="raw">{ins.bytes}</span>}
              {flowIcon(ins)}
              <span className="mn">{mnemonic}</span>
              <span className="ops">{ops.join(' ')}</span>
              <span className={`line-badge${ins.line === null ? ' none' : ''}`}>
                {ins.line === null ? '—' : `L${ins.line}`}
              </span>
              {showPcode && (
                <div className="pcode-group">
                  {ins.pcode.map((op, i) => (
                    <PcodeLine key={i} op={op} />
                  ))}
                </div>
              )}
            </div>
          </Fragment>
        );
      })}
    </pre>
  );
}
