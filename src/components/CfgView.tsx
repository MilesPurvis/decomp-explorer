import { Graph, layout } from '@dagrejs/dagre';
import { useMemo } from 'react';
import { focusFromAddrs, isActive, useFocus, useTrace } from '../focus';
import type { Block, EdgeKind, FunctionData, Instruction } from '../types';

const CHAR_W = 7.2; // 12px monospace
const LINE_H = 17;
const PAD_X = 12;
const HEAD_H = 22;
const MAX_CHARS = 44;
const MIN_CHARS = 24; // fits the "LAB_xxxxxxxxx  N insn" header

interface NodeLayout {
  block: Block;
  insns: Instruction[];
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EdgeLayout {
  from: string;
  to: string;
  kind: EdgeKind | 'taken' | 'not-taken';
  back: boolean;
  path: string;
}

/** Rounded path through dagre's control points. */
function toPath(pts: { x: number; y: number }[]) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    d += ` Q${pts[i].x},${pts[i].y} ${mid.x},${mid.y}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x},${last.y}`;
}

function useCfgLayout(fn: FunctionData) {
  return useMemo(() => {
    const byAddr = (a: string) => parseInt(a, 16);
    const g = new Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 44, marginx: 16, marginy: 16 });
    g.setDefaultEdgeLabel(() => ({}));

    const nodes = new Map<string, Omit<NodeLayout, 'x' | 'y'>>();
    for (const block of fn.blocks) {
      const lo = byAddr(block.start);
      const hi = byAddr(block.end);
      const insns = fn.instructions.filter((i) => byAddr(i.addr) >= lo && byAddr(i.addr) <= hi);
      const chars = Math.min(MAX_CHARS, Math.max(MIN_CHARS, ...insns.map((i) => i.text.length + 2)));
      const w = chars * CHAR_W + PAD_X * 2;
      const h = HEAD_H + insns.length * LINE_H + 8;
      nodes.set(block.start, { block, insns, w, h });
      g.setNode(block.start, { width: w, height: h });
    }
    for (const block of fn.blocks) {
      for (const e of block.edges) {
        if (nodes.has(e.to)) g.setEdge(block.start, e.to);
      }
    }
    layout(g);

    const laidOut: NodeLayout[] = [...nodes.values()].map((n) => {
      const { x = 0, y = 0 } = g.node(n.block.start) as { x?: number; y?: number };
      return { ...n, x: x - n.w / 2, y: y - n.h / 2 };
    });
    const edges: EdgeLayout[] = [];
    for (const block of fn.blocks) {
      const conditional = block.edges.some((e) => e.kind === 'conditional');
      for (const e of block.edges) {
        if (!nodes.has(e.to)) continue;
        const pts = (g.edge(block.start, e.to) as { points?: { x: number; y: number }[] })?.points;
        if (!pts?.length) continue;
        edges.push({
          from: block.start,
          to: e.to,
          kind:
            e.kind === 'conditional'
              ? 'taken'
              : e.kind === 'fallthrough' && conditional
                ? 'not-taken'
                : e.kind,
          back: byAddr(e.to) <= byAddr(block.start),
          path: toPath(pts),
        });
      }
    }
    const { width = 0, height = 0 } = g.graph();
    return { nodes: laidOut, edges, width, height };
  }, [fn]);
}

const LEGEND: [string, string][] = [
  ['taken', 'branch taken'],
  ['not-taken', 'not taken'],
  ['back', 'loop (back edge)'],
  ['computed', 'jump table'],
];

export function CfgView({ fn }: { fn: FunctionData }) {
  const { nodes, edges, width, height } = useCfgLayout(fn);
  const { focus } = useFocus();
  const trace = useTrace();
  const active = isActive(focus);

  return (
    <div className="cfg-wrap">
      <div className="legend">
        {LEGEND.map(([k, label]) => (
          <span key={k} className={`lg lg-${k}`}>
            <i />
            {label}
          </span>
        ))}
      </div>
      <div className="cfg" style={{ width, height }}>
        <svg width={width} height={height}>
          <defs>
            {['taken', 'not-taken', 'jump', 'fallthrough', 'computed', 'back'].map((k) => (
              <marker
                key={k}
                id={`arrow-${k}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" className={`arrowhead e-${k}`} />
              </marker>
            ))}
          </defs>
          {edges.map((e, i) => {
            const cls = e.back ? 'back' : e.kind;
            return (
              <path
                key={i}
                d={e.path}
                className={`edge e-${cls}`}
                markerEnd={`url(#arrow-${cls})`}
              />
            );
          })}
        </svg>
        {nodes.map((n) => {
          const lit = n.insns.some((i) => focus.addrs.has(i.addr));
          const isEntry = n.block.start === fn.entry;
          return (
            <div
              key={n.block.start}
              className={`node${lit ? ' lit' : ''}${active && !lit ? ' dim' : ''}`}
              style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
              {...trace(focusFromAddrs(fn, n.insns.map((i) => i.addr)))}
            >
              <div className="node-head">
                {isEntry ? 'entry' : `LAB_${n.block.start}`}
                <span>{n.insns.length} insn</span>
              </div>
              {n.insns.map((i) => (
                <div
                  key={i.addr}
                  className={`node-line${focus.addrs.has(i.addr) ? ' tok-lit' : ''}`}
                >
                  {i.text}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
