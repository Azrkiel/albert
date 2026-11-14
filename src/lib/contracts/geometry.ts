import { z } from "zod";

export const PAGE = {
  width: 1200,
  studentCol: { x: 0, w: 760 },
  gutter: { x: 760, w: 30 },
  albertCol: { x: 790, w: 410 },
  rowHeight: 128,
  rowPaddingTop: 10,
  statementMinHeight: 96,
} as const;

/** Line inference for the free layout (contracts.md §2, Line assignment). Logical px except MIN_OVERLAP. */
export const LINE = { GAP: 16, GAP_PER_HEIGHT: 0.5, MIN_OVERLAP: 0.3, REACH: 0.5, PAD: 8, DIVIDER_MIN_HEIGHT: 120, DIVIDER_MIN_GLYPHS: 3, DIVIDER_MAX_WIDTH_RATIO: 0.15, DIVIDER_MAX_PATH_RATIO: 1.1 } as const;

export const INK = { student: "#1b1b1f", albert: "#c8321e", clusterLabel: "#2f6fdb" } as const;

export const BBoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number().nonnegative(), h: z.number().nonnegative() });
export type BBox = z.infer<typeof BBoxSchema>;
