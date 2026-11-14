"use client";

import { INK, type Cluster, type Row } from "@/lib/contracts";

/** Dev-only (?dev=1) view of each cluster's box and label, for tuning STUCK.CLUSTER_GAP. Never intercepts input. */
/** With `lines` (free layout), each inferred line's band is outlined too. */
export function ClusterOverlay({ clusters, lines }: { clusters: Cluster[]; lines?: Row[] }) {
  return (
    <g data-cluster-overlay="" pointerEvents="none" style={{ pointerEvents: "none" }} aria-hidden="true">
      {lines?.map((line) => (
        <rect key={line.id} data-line-band={line.id} x={line.bbox.x + 1} y={line.bbox.y} width={line.bbox.w - 2} height={line.bbox.h}
          fill="none" stroke="#9aa0a6" strokeWidth={1} strokeDasharray="1 4" />
      ))}
      {clusters.map((cluster) => (
        <g key={cluster.id} data-cluster-id={cluster.id}>
          <rect data-cluster-box="" x={cluster.bbox.x - 2} y={cluster.bbox.y - 2}
            width={cluster.bbox.w + 4} height={cluster.bbox.h + 4}
            fill="none" stroke={INK.clusterLabel} strokeWidth={1} strokeDasharray="4 3" />
          <text data-cluster-label="" x={cluster.bbox.x} y={cluster.bbox.y - 5}
            fill={INK.clusterLabel} fontSize={12} fontFamily="monospace">{cluster.label}</text>
        </g>
      ))}
    </g>
  );
}
