import { useCallback, useEffect, useMemo, useState } from 'react';
import { CfgView } from './components/CfgView';
import { CodeView } from './components/CodeView';
import { BytesView, DisasmView } from './components/MachineViews';
import { Prose } from './components/Prose';
import { SourceView } from './components/SourceView';
import { FocusContext, NO_FOCUS, type Focus } from './focus';
import { STAGES } from './stages';
import type { Arch, DecompData, FunctionData, Opt, Stage } from './types';

const ARCHES: [Arch, string][] = [
  ['x86_64', 'x86-64'],
  ['arm64', 'ARM64'],
];
const OPTS: Opt[] = ['O0', 'O1', 'O2'];

interface Selection {
  example: string;
  arch: Arch;
  opt: Opt;
  stage: Stage;
}

function readHash(data: DecompData): Selection {
  const [example, arch, opt, stage] = location.hash.replace(/^#\/?/, '').split('/');
  return {
    example: data.examples.some((e) => e.id === example) ? example : data.examples[0].id,
    arch: ARCHES.some(([a]) => a === arch) ? (arch as Arch) : 'x86_64',
    opt: OPTS.includes(opt as Opt) ? (opt as Opt) : 'O0',
    stage: STAGES.some((s) => s.id === stage) ? (stage as Stage) : 'bytes',
  };
}

const focusKey = (f: Focus) => [...f.addrs].sort().join(',') + '|' + [...f.lines].join(',');

export default function App() {
  const [data, setData] = useState<DecompData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/decomp.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData, (e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="boot">
        Couldn’t load <code>public/data/decomp.json</code> ({error}). Generate it with{' '}
        <code>npm run data</code>.
      </div>
    );
  }
  if (!data) return <div className="boot">Loading…</div>;
  return <Explorer data={data} />;
}

function Explorer({ data }: { data: DecompData }) {
  const [sel, setSel] = useState(() => readHash(data));
  const [hovered, setHovered] = useState<Focus | null>(null);
  const [pinned, setPinned] = useState<Focus | null>(null);
  const [blind, setBlind] = useState(false);

  const update = (patch: Partial<Selection>) => {
    setSel((s) => ({ ...s, ...patch }));
    // Addresses differ per binary, so a trace can't carry across examples or builds.
    if (!('stage' in patch && Object.keys(patch).length === 1)) setPinned(null);
    setHovered(null);
  };

  useEffect(() => {
    history.replaceState(null, '', `#/${sel.example}/${sel.arch}/${sel.opt}/${sel.stage}`);
  }, [sel]);

  useEffect(() => {
    const onHash = () => {
      setSel(readHash(data));
      setPinned(null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [data]);

  const stageIdx = STAGES.findIndex((s) => s.id === sel.stage);
  const stage = STAGES[stageIdx];
  const example = data.examples.find((e) => e.id === sel.example)!;
  const variant = data.variants[`${sel.arch}-${sel.opt}`];
  const fn = variant.functions[sel.example];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'Escape') setPinned(null);
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      const next = STAGES[stageIdx + step];
      if (step && next) setSel((s) => ({ ...s, stage: next.id }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stageIdx]);

  const pin = useCallback(
    (f: Focus) => setPinned((p) => (p && focusKey(p) === focusKey(f) ? null : f)),
    [],
  );
  const focusApi = useMemo(
    () => ({ focus: hovered ?? pinned ?? NO_FOCUS, pinned: !!pinned, hover: setHovered, pin }),
    [hovered, pinned, pin],
  );

  const pcodeCount = fn.instructions.reduce((n, i) => n + i.pcode.length, 0);
  const byteCount = fn.instructions.reduce((n, i) => n + i.bytes.split(' ').length, 0);

  return (
    <FocusContext.Provider value={focusApi}>
      <div className="app" onClick={() => setPinned(null)}>
        <header className="top">
          <div className="brand">
            <h1>Decomp Explorer</h1>
            <p>
              Real Ghidra {data.ghidraVersion} output for stripped binaries built with{' '}
              {data.clangVersion.replace(/ \(.*\)/, '')}
            </p>
          </div>
          <div className="controls" onClick={(e) => e.stopPropagation()}>
            <Segmented
              label="Arch"
              value={sel.arch}
              options={ARCHES}
              onChange={(arch) => update({ arch })}
            />
            <Segmented
              label="Opt"
              value={sel.opt}
              options={OPTS.map((o) => [o, `-${o}`])}
              onChange={(opt) => update({ opt })}
            />
          </div>
        </header>

        <nav className="examples" onClick={(e) => e.stopPropagation()}>
          {data.examples.map((ex) => (
            <button
              key={ex.id}
              className={ex.id === sel.example ? 'on' : ''}
              onClick={() => update({ example: ex.id })}
            >
              <span className="ex-title">{ex.title}</span>
              <code>{ex.id}()</code>
            </button>
          ))}
        </nav>

        <p className="lesson">
          <Prose text={example.lesson} />
        </p>

        <ol className="stepper" onClick={(e) => e.stopPropagation()}>
          {STAGES.map((s, i) => (
            <li key={s.id} className={i === stageIdx ? 'on' : i < stageIdx ? 'done' : ''}>
              <button onClick={() => update({ stage: s.id })}>
                <span className="num">{i + 1}</span>
                {s.step}
              </button>
            </li>
          ))}
        </ol>

        <section className="explainer">
          <div>
            <h2>{stage.title}</h2>
            <p>
              <Prose text={stage.body({ arch: sel.arch, fn })} />
            </p>
            {stage.lost && (
              <div className="lost">
                {stage.lost.map((l) => (
                  <span key={l}>{l}</span>
                ))}
              </div>
            )}
          </div>
          <dl className="stats">
            <div>
              <dt>bytes</dt>
              <dd>{byteCount}</dd>
            </div>
            <div>
              <dt>instructions</dt>
              <dd>{fn.instructions.length}</dd>
            </div>
            <div>
              <dt>p-code ops</dt>
              <dd>{pcodeCount}</dd>
            </div>
            <div>
              <dt>blocks</dt>
              <dd>{fn.blocks.length}</dd>
            </div>
          </dl>
        </section>

        <p className="hint">
          Hover any line to trace it across views. Click to pin, Esc to clear, ←/→ to step.
          {focusApi.pinned && <strong> Pinned.</strong>}
        </p>

        <main className={`panes stage-${sel.stage}`}>
          <Pane
            title="Your source"
            sub={example.file}
            note="The decompiler never sees this. Dots mark lines that produced instructions in this build."
            action={
              <button className="link" onClick={(e) => (e.stopPropagation(), setBlind(!blind))}>
                {blind ? 'Reveal' : 'Hide'}
              </button>
            }
          >
            {blind ? (
              <div className="empty">
                Hidden. Try working out what the function does from the other views first.
              </div>
            ) : (
              <SourceView source={example.source} fn={fn} />
            )}
          </Pane>
          <StagePanes stage={sel.stage} fn={fn} />
        </main>

        <footer>
          Language <code>{variant.languageId}</code> · regenerate with <code>npm run data</code>
        </footer>
      </div>
    </FocusContext.Provider>
  );
}

function StagePanes({ stage, fn }: { stage: Stage; fn: FunctionData }) {
  switch (stage) {
    case 'bytes':
      return (
        <Pane title="Machine code" sub={`${fn.ghidraName} @ ${fn.entry}`}>
          <BytesView fn={fn} />
        </Pane>
      );
    case 'disasm':
      return (
        <Pane title="Disassembly" sub="Ghidra listing">
          <DisasmView fn={fn} />
        </Pane>
      );
    case 'lift':
      return (
        <Pane title="Instructions → P-code" sub="raw, before any simplification">
          <DisasmView fn={fn} showBytes={false} showPcode />
        </Pane>
      );
    case 'cfg':
      return (
        <Pane title="Control-flow graph" sub={`${fn.blocks.length} basic blocks`} wide>
          <CfgView fn={fn} />
        </Pane>
      );
    case 'decompile':
      return (
        <>
          <Pane title="Disassembly" sub="what went in">
            <DisasmView fn={fn} showBytes={false} />
          </Pane>
          <Pane title="Decompiled" sub="Ghidra, untouched">
            <CodeView decomp={fn.raw} fn={fn} />
          </Pane>
        </>
      );
    case 'annotate':
      return (
        <>
          <Pane title="Before" sub="Ghidra, untouched">
            <CodeView decomp={fn.raw} fn={fn} />
          </Pane>
          <Pane title="After" sub="Ghidra, after the analyst’s edits">
            <ul className="steps">
              {fn.analystSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <CodeView decomp={fn.annotated} fn={fn} />
          </Pane>
        </>
      );
  }
}

function Pane({
  title,
  sub,
  note,
  action,
  wide,
  children,
}: {
  title: string;
  sub?: string;
  note?: string;
  action?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`pane${wide ? ' wide' : ''}`}>
      <header>
        <h3>{title}</h3>
        {sub && <span className="sub">{sub}</span>}
        {action && <span className="action">{action}</span>}
      </header>
      {note && <p className="note">{note}</p>}
      <div className="pane-body">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      <span className="seg-label">{label}</span>
      {options.map(([v, text]) => (
        <button
          key={v}
          role="radio"
          aria-checked={v === value}
          className={v === value ? 'on' : ''}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
