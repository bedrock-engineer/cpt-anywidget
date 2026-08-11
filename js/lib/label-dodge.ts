// 1D label dodging: order-preserving, minimal-displacement placement
// with a minimum separation — the pool-adjacent-violators sweep from
// isotonic regression. Labels that already fit stay exactly at their
// anchors; colliding runs merge into clusters centered on the mean of
// their members' anchors (which minimizes total squared displacement)
// and spread evenly. Deterministic and O(n), so it can run on every
// zoom frame without jitter.

/** a run of labels that would overlap, so they move as one block,
    spaced `separation` apart around a shared center */
interface Cluster {
  anchorSum: number;
  size: number;
  firstIndex: number; // index into `anchors` of the cluster's first member
}

/** anchors must be ascending; returns one placed position per anchor.
    extent clamps whole clusters (a cluster taller than the extent pins
    to its start) */
export function dodgeLabels(
  anchors: readonly number[],
  separation: number,
  extent?: readonly [number, number],
): number[] {
  const placed = Array.from({ length: anchors.length }, () => 0);

  if (anchors.length === 0) {
    return placed;
  }

  // the cluster's center is the mean of its members' anchors, clamped so
  // the whole block stays inside the extent
  const centerOf = (cluster: Cluster): number => {
    const mean = cluster.anchorSum / cluster.size;
    
    if (!extent) {
      return mean;
    }

    const halfSpan = ((cluster.size - 1) * separation) / 2;

    return Math.max(Math.min(mean, extent[1] - halfSpan), extent[0] + halfSpan);
  };

  // positions of a cluster's outermost members
  const firstMemberOf = (cluster: Cluster): number =>
    centerOf(cluster) - ((cluster.size - 1) * separation) / 2;
  
  const lastMemberOf = (cluster: Cluster): number =>
    centerOf(cluster) + ((cluster.size - 1) * separation) / 2;

  const clusters: Cluster[] = [];

  anchors.forEach((anchor, index) => {
    clusters.push({ anchorSum: anchor, size: 1, firstIndex: index });

    // pool adjacent violators: while the two newest clusters are closer
    // than the separation, merge them and re-check — re-centering a
    // merged cluster can create a new violation with its predecessor
    while (clusters.length > 1) {
      const above = clusters[clusters.length - 2];
      const below = clusters[clusters.length - 1];
      const gap = firstMemberOf(below) - lastMemberOf(above);

      if (gap >= separation - 1e-6) {
        break;
      }

      above.anchorSum += below.anchorSum;
      above.size += below.size;
      clusters.pop();
    }
  });

  for (const cluster of clusters) {
    const center = centerOf(cluster);

    for (let member = 0; member < cluster.size; member++) {
      placed[cluster.firstIndex + member] =
        center + (member - (cluster.size - 1) / 2) * separation;
    }
  }

  return placed;
}
