/**
 * Layout maths for the Git commit graph — lanes, rows and the edges between
 * them, shared by the SVG panel and the terminal's `log --graph`.
 */

export interface GraphCommit {
  sha: string;
  message: string;
  parents: string[];
  time: number;
  refs: string[];
}

export interface GraphNode {
  sha: string;
  message: string;
  row: number;
  lane: number;
  refs: string[];
  isMerge: boolean;
}

export interface GraphEdge {
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  laneCount: number;
  rowCount: number;
  rowOf: Record<string, number>;
}

/** Newest first, exactly like the commit list the snapshot hands over. */
export function layoutGraph(commits: GraphCommit[]): GraphLayout {
  const sorted = [...commits].sort((a, b) => b.time - a.time);
  const active: (string | null)[] = [];
  const nodes: GraphNode[] = [];
  const pendingEdges: { fromRow: number; fromLane: number; toSha: string; toLane: number }[] = [];
  const rowOf: Record<string, number> = {};

  sorted.forEach((commit, row) => {
    rowOf[commit.sha] = row;
    let lane = active.indexOf(commit.sha);
    if (lane === -1) {
      lane = active.findIndex((slot) => slot === null);
      if (lane === -1) {
        lane = active.length;
        active.push(null);
      }
    }
    active[lane] = null;
    nodes.push({
      sha: commit.sha,
      message: commit.message,
      row,
      lane,
      refs: commit.refs,
      isMerge: commit.parents.length > 1,
    });
    commit.parents.forEach((parentSha, index) => {
      let parentLane = active.indexOf(parentSha);
      if (parentLane === -1) {
        if (index === 0) {
          parentLane = lane;
        } else {
          parentLane = active.findIndex((slot) => slot === null);
          if (parentLane === -1) {
            parentLane = active.length;
            active.push(null);
          }
        }
        active[parentLane] = parentSha;
      }
      pendingEdges.push({ fromRow: row, fromLane: lane, toSha: parentSha, toLane: parentLane });
    });
  });

  const edges: GraphEdge[] = pendingEdges
    .filter((edge) => rowOf[edge.toSha] !== undefined)
    .map((edge) => ({
      fromRow: edge.fromRow,
      fromLane: edge.fromLane,
      toRow: rowOf[edge.toSha],
      toLane: edge.toLane,
    }));

  const laneCount = Math.max(1, ...nodes.map((node) => node.lane + 1), ...edges.map((edge) => Math.max(edge.fromLane, edge.toLane) + 1));
  return { nodes, edges, laneCount, rowCount: sorted.length, rowOf };
}

export const LANE_COLORS = ['#A78BFA', '#4EC9A5', '#F0A868', '#7FB8FF', '#F27D9D', '#C9B458'];
