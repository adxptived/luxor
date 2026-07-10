/**
 * Git branch graph visualization data.
 *
 * Computes a lane layout for a commit DAG so the Git panel can render
 * a visual branch graph (like `git log --graph`). Each commit is assigned
 * to a horizontal lane; edges between commits are traced through lanes
 * with merge/branch points.
 */

export interface GraphCommit {
  id: string;
  /** Short hash for display. */
  shortHash: string;
  message: string;
  author: string;
  date: string;
  /** Parent commit ids (1 for normal, 2+ for merges). */
  parents: string[];
  /** Lane (column) assigned to this commit. */
  lane: number;
  /** Whether this commit is a merge commit. */
  isMerge: boolean;
  /** Branch heads that point to this commit. */
  heads: string[];
}

export interface GraphEdge {
  /** Source lane. */
  fromLane: number;
  /** Target lane. */
  toLane: number;
  /** Source commit index. */
  fromIdx: number;
  /** Target commit index. */
  toIdx: number;
  /** Whether this edge represents a merge. */
  isMerge: boolean;
}

export interface BranchGraph {
  commits: GraphCommit[];
  edges: GraphEdge[];
  /** Total number of lanes (columns). */
  laneCount: number;
}

/**
 * Compute a branch graph from a list of commits (newest first).
 * Uses a simple greedy lane assignment: each commit goes to the lane
 * of its first parent if available, otherwise a new lane.
 */
export function computeBranchGraph(
  rawCommits: { id: string; shortHash: string; message: string; author: string; date: string; parents: string[]; heads?: string[] }[],
): BranchGraph {
  if (rawCommits.length === 0) return { commits: [], edges: [], laneCount: 0 };

  // Reverse to oldest-first for processing.
  const ordered = [...rawCommits].reverse();
  const commitById = new Map(ordered.map((c) => [c.id, c]));

  // Lane assignment: track which lane each commit's children are on.
  const laneOf = new Map<string, number>();
  const laneOccupied = new Map<number, string>(); // lane -> commit id currently occupying
  let nextLane = 0;

  const commits: GraphCommit[] = [];

  for (const c of ordered) {
    // Find a lane: prefer the lane of the first child that points to us.
    let lane = -1;
    for (const [cid, l] of laneOf) {
      const child = commitById.get(cid);
      if (child && child.parents[0] === c.id) {
        // This child's lane is our lane.
        lane = l;
        // Free the lane from the child.
        break;
      }
    }

    if (lane === -1) {
      // No child claimed a lane for us — find a free lane or create one.
      for (let l = 0; l < nextLane; l++) {
        if (!laneOccupied.has(l)) {
          lane = l;
          break;
        }
      }
      if (lane === -1) {
        lane = nextLane++;
      }
    }

    // Clear lanes occupied by children that point to us as first parent.
    for (const [cid, l] of laneOf) {
      const child = commitById.get(cid);
      if (child && child.parents[0] === c.id && l === lane) {
        laneOccupied.delete(l);
      }
    }

    laneOccupied.set(lane, c.id);
    laneOf.set(c.id, lane);

    commits.push({
      ...c,
      lane,
      isMerge: c.parents.length > 1,
      heads: c.heads ?? [],
    });
  }

  // Compute edges (parent → child connections).
  const edges: GraphEdge[] = [];
  // Reverse back to newest-first for display.
  commits.reverse();

  const idxById = new Map(commits.map((c, i) => [c.id, i]));
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    for (const parentId of c.parents) {
      const parentIdx = idxById.get(parentId);
      if (parentIdx === undefined) continue;
      const parent = commits[parentIdx];
      edges.push({
        fromLane: c.lane,
        toLane: parent.lane,
        fromIdx: i,
        toIdx: parentIdx,
        isMerge: c.parents.length > 1 && parentId !== c.parents[0],
      });
    }
  }

  return { commits, edges, laneCount: nextLane };
}

/** SVG path for a vertical or diagonal edge between two lanes. */
export function edgePath(
  edge: GraphEdge,
  rowHeight: number,
  laneWidth: number,
): string {
  const x1 = edge.fromLane * laneWidth + laneWidth / 2;
  const y1 = edge.fromIdx * rowHeight + rowHeight / 2;
  const x2 = edge.toLane * laneWidth + laneWidth / 2;
  const y2 = edge.toIdx * rowHeight + rowHeight / 2;
  if (edge.fromLane === edge.toLane) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  // Curved path for lane changes / merges edges.
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}