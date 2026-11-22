import { useMemo } from 'react';
import { t, type Lang } from '../i18n';
import type { GitSnapshot } from '../tracks/git/repo';
import { LANE_COLORS, layoutGraph } from '../tracks/git/graph';

interface GitGraphProps {
  lang: Lang;
  snap: GitSnapshot | null;
}

const LANE_W = 22;
const ROW_H = 30;
const PAD_X = 16;
const PAD_Y = 20;

const short = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/** The right panel's commit graph: lanes, merges, refs and HEAD. */
export function GitGraph({ lang, snap }: GitGraphProps) {
  const commits = snap?.commits ?? [];
  const layout = useMemo(
    () => layoutGraph(commits.map((commit) => ({ ...commit }))),
    [commits],
  );

  if (!snap?.initialized || commits.length === 0) {
    return (
      <div className="viz-card">
        <div className="viz-head">
          <span>{t(lang, 'gitGraph')}</span>
        </div>
        <p className="viz-empty">{t(lang, 'gitGraphEmpty')}</p>
      </div>
    );
  }

  const labelX = PAD_X + layout.laneCount * LANE_W + 8;
  const width = Math.max(280, labelX + 210);
  const height = PAD_Y * 2 + layout.rowCount * ROW_H - (ROW_H - 18);
  const headSha = snap.head.sha;

  return (
    <div className="viz-card">
      <div className="viz-head">
        <span>{t(lang, 'gitGraph')}</span>
        <span className="viz-meta">
          {layout.rowCount} commit{layout.rowCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="graph-wrap">
        <svg width={width} height={height} role="img" aria-label={t(lang, 'gitGraph')} data-testid="git-graph">
          {layout.edges.map((edge, index) => {
            const x1 = PAD_X + edge.fromLane * LANE_W;
            const y1 = PAD_Y + edge.fromRow * ROW_H;
            const x2 = PAD_X + edge.toLane * LANE_W;
            const y2 = PAD_Y + edge.toRow * ROW_H;
            const color = LANE_COLORS[edge.toLane % LANE_COLORS.length];
            const path =
              edge.fromLane === edge.toLane
                ? `M ${x1} ${y1} L ${x2} ${y2}`
                : `M ${x1} ${y1} C ${x1} ${y1 + (y2 - y1) / 2}, ${x2} ${y2 - (y2 - y1) / 2}, ${x2} ${y2}`;
            return <path key={`e${index}`} d={path} fill="none" stroke={color} strokeWidth={1.8} opacity={0.85} />;
          })}
          {layout.nodes.map((node) => {
            const cx = PAD_X + node.lane * LANE_W;
            const cy = PAD_Y + node.row * ROW_H;
            const color = LANE_COLORS[node.lane % LANE_COLORS.length];
            const isHead = node.sha === headSha;
            return (
              <g key={node.sha}>
                {isHead && <circle cx={cx} cy={cy} r={8.5} fill="none" stroke={color} strokeWidth={1.2} opacity={0.5} />}
                <circle
                  cx={cx}
                  cy={cy}
                  r={node.isMerge ? 5.4 : 4.4}
                  fill={node.isMerge ? 'var(--viz-bg)' : color}
                  stroke={color}
                  strokeWidth={node.isMerge ? 2.4 : 1}
                />
                <text x={labelX} y={cy + 3.5} className="graph-sha">
                  {node.sha.slice(0, 7)}
                </text>
                <text x={labelX + 54} y={cy + 3.5} className="graph-msg">
                  {node.refs.length > 0 && (
                    <tspan className="graph-ref">{node.refs.join(', ')}{' · '}</tspan>
                  )}
                  {short(node.message, 18)}
                </text>
                <title>{`${node.sha.slice(0, 7)} ${node.message}${isHead ? ' (HEAD)' : ''}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="branch-chips">
        {snap.branches.map((branch) => (
          <li key={branch.name} className={branch.current ? 'on' : ''}>
            <span className="branch-dot" aria-hidden />
            {branch.name}
            {branch.sha && <em>{branch.sha.slice(0, 7)}</em>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Working tree / staging / HEAD — the state a learner watches while typing. */
export function GitStatus({ lang, snap }: GitGraphProps) {
  if (!snap?.initialized) {
    return (
      <div className="viz-card">
        <div className="viz-head">
          <span>{t(lang, 'gitWorktree')}</span>
        </div>
        <p className="viz-empty">
          {lang === 'ko' ? 'git init 을 실행하면 상태가 나타납니다.' : 'Run git init and the state appears here.'}
        </p>
      </div>
    );
  }
  const rows = [
    ...snap.staged.map((entry) => ({ ...entry, area: 'staged' as const })),
    ...snap.unmerged.map((path) => ({ path, status: 'unmerged' as const, area: 'unmerged' as const })),
    ...snap.unstaged.map((entry) => ({ ...entry, area: 'unstaged' as const })),
    ...snap.untracked.map((path) => ({ path, status: 'untracked' as const, area: 'untracked' as const })),
  ];
  return (
    <div className="viz-card">
      <div className="viz-head">
        <span>{t(lang, 'gitWorktree')}</span>
        <span className="viz-meta">
          {snap.head.label}
          {snap.head.sha ? ` · ${snap.head.sha.slice(0, 7)}` : ''}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="viz-empty">{t(lang, 'gitClean')}</p>
      ) : (
        <ul className="status-list">
          {rows.map((row) => (
            <li key={`${row.area}-${row.path}`} className={`st-${row.area}`}>
              <span className="st-badge">
                {row.status === 'added'
                  ? 'A'
                  : row.status === 'deleted'
                    ? 'D'
                    : row.status === 'untracked'
                      ? '?'
                      : row.status === 'unmerged'
                        ? '!'
                        : 'M'}
              </span>
              <span className="st-path">{row.path}</span>
              <span className="st-area">
                {row.area === 'staged'
                  ? t(lang, 'gitStaged')
                  : row.area === 'unmerged'
                    ? t(lang, 'gitUnmerged')
                    : row.area === 'unstaged'
                      ? t(lang, 'gitUnstaged')
                      : t(lang, 'gitUntracked')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {snap.mergePending && (
        <p className="viz-note">
          {t(lang, 'gitMerging')}: {snap.mergePending}
          {snap.unmerged.length > 0 ? ` · ${snap.unmerged.length} ${t(lang, 'gitUnmerged')}` : ''}
        </p>
      )}
      {snap.mergePending && !snap.mergeStateAvailable && <p className="viz-error">{t(lang, 'gitMergeLegacy')}</p>}
    </div>
  );
}
