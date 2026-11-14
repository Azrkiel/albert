import { z } from "zod";
import { BBoxSchema } from "./geometry";

export const PointSchema = z.object({ x: z.number(), y: z.number(), t: z.number().nonnegative(), p: z.number().min(0).max(1) });
export type Point = z.infer<typeof PointSchema>;

export const StrokeSchema = z.object({
  id: z.string(), problemId: z.string(), rowId: z.string().nullable(),
  tool: z.enum(["pen", "eraser"]), pointerType: z.enum(["pen", "touch", "mouse"]),
  points: z.array(PointSchema), t0: z.number().nonnegative(), t1: z.number().nonnegative(),
  bbox: BBoxSchema, erasedAt: z.number().nonnegative().optional(),
});
export type Stroke = z.infer<typeof StrokeSchema>;

export const RowSchema = z.object({ id: z.string(), problemId: z.string(), index: z.number().int().positive(), bbox: BBoxSchema });
export type Row = z.infer<typeof RowSchema>;

export const ClusterSchema = z.object({ id: z.string(), rowId: z.string(), label: z.number().int().positive(), strokeIds: z.array(z.string()), bbox: BBoxSchema });
export type Cluster = z.infer<typeof ClusterSchema>;
