import { z } from "zod";
import { ChatBedrockConverse } from "@langchain/aws";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AlbertReplySchema, DiagnoseSchema, InkSegmentSchema, MarkSchema, ReadWorkSchema, WriteHintSchema,
} from "../contracts";
import { getChatModel } from "../llm";

// Extend the contract only with descriptions: validation still uses AlbertReplySchema.
const reading = ReadWorkSchema.extend({
  rows: z.array(ReadWorkSchema.shape.rows.element.extend({
    index: ReadWorkSchema.shape.rows.element.shape.index.describe("The printed row tag's number, starting at 1."),
    latex: z.string().describe("Transcribe this row's ink as LaTeX, excluding blue labels; say illegible rather than guessing."),
    confidence: ReadWorkSchema.shape.rows.element.shape.confidence.describe("Your confidence in this transcription."),
  })).describe("Read every supplied row, in order, before judging the work."),
});
const diagnosis = DiagnoseSchema.extend({
  status: DiagnoseSchema.shape.status.describe("error for an invalid step, on_track or stalled for correct unfinished work, unreadable for illegible work."),
  rowIndex: DiagnoseSchema.shape.rowIndex.describe("For an error, the FIRST incorrect row's printed number."),
  clusterLabels: DiagnoseSchema.shape.clusterLabels.describe("Blue labels of the incorrect ink in that row; do not invent labels for missing ink."),
  errorType: DiagnoseSchema.shape.errorType.describe("A short snake_case error name, such as missing_dx."),
  subskillId: DiagnoseSchema.shape.subskillId.describe("An applicable subskill id listed in the scope bundle; omit if none applies."),
  privateNote: z.string().describe("One private sentence explaining what is actually wrong; never student-facing."),
  easierOutOfScope: DiagnoseSchema.shape.easierOutOfScope.unwrap().extend({
    methodName: z.string().describe("The name of an easier upcoming method; do not use or teach it."),
    unitId: z.string().describe("That method's unit id from upcomingMethods."),
  }).optional().describe("Optional observation about an upcoming shortcut; continue with a covered method."),
});
const marks = z.array(z.discriminatedUnion("type", [
  MarkSchema.options[0].extend({
    type: MarkSchema.options[0].shape.type.describe("The pen mark to put around or under the incorrect ink."),
    rowIndex: MarkSchema.options[0].shape.rowIndex.describe("The target's printed row number."),
    clusterLabels: MarkSchema.options[0].shape.clusterLabels.describe("Existing blue labels in that row; [] targets the whole row."),
  }),
  MarkSchema.options[1].extend({
    type: MarkSchema.options[1].shape.type.describe("Draw an arrow from the margin hint to the ink."),
    fromHint: MarkSchema.options[1].shape.fromHint.describe("Always true: the arrow starts at the hint."),
    toRowIndex: MarkSchema.options[1].shape.toRowIndex.describe("The arrow target's printed row number."),
    toClusterLabels: MarkSchema.options[1].shape.toClusterLabels.describe("Existing blue target labels; [] targets the whole row."),
  }),
])).max(3);
const hint = WriteHintSchema.extend({
  kind: WriteHintSchema.shape.kind.describe("Rung 1: question or nudge; rung 2: next_step; rung 3: worked_step. Unreadable overrides every rung with reread."),
  segments: z.array(z.discriminatedUnion("type", [
    InkSegmentSchema.options[0].extend({
      type: InkSegmentSchema.options[0].shape.type.describe("Plain margin text."),
      text: z.string().describe("Short student-facing words; no praise, private diagnosis, or answer on rung 1."),
    }),
    InkSegmentSchema.options[1].extend({
      type: InkSegmentSchema.options[1].shape.type.describe("A mathematical expression."),
      latex: z.string().describe("LaTeX without dollar delimiters, using the teacher's notation. No equation containing = on rung 2."),
    }),
    InkSegmentSchema.options[2].extend({
      type: InkSegmentSchema.options[2].shape.type.describe("A line break in the margin note."),
    }),
  ])).describe("Write the note in reading order: rung 1 ends in ?, at most 18 words and two short math segments; rung 2 at most 24 words; rung 3 at most two math segments."),
  citation: WriteHintSchema.shape.citation.unwrap().extend({
    unitId: z.string().describe("The covered lecture example's unit id."),
    label: z.string().describe("A matching label from the card, such as Lecture 9, Example 2."),
  }).optional().describe("Cite a matching worked example when one applies."),
});

export const albertReplyTool = {
  name: "albert_reply",
  description: "Reply exactly once, in order: read the ink, diagnose the first error, point by blue label, write one in-scope margin hint.",
  schema: AlbertReplySchema.extend({
    reading: reading.describe("1. Transcribe before diagnosing."),
    diagnosis: diagnosis.describe("2. Judge the steps, keeping your explanation private."),
    marks: marks.describe("3. Zero to three marks; no marks for unreadable work."),
    hint: hint.describe("4. One short note at the requested rung."),
  }),
};

export function getHintModel(model: BaseChatModel = getChatModel("hint")) {
  if (!model.bindTools) throw new Error("The hint model must support tools.");
  // @langchain/aws 1.5.2 ChatBedrockConverseCallOptions and core 1.4.1
  // both accept a tool-name string. Bedrock converts it to { tool: { name } }.
  const bound = model.bindTools([albertReplyTool], { tool_choice: albertReplyTool.name, maxRetries: 0 });
  let disposed = false;
  return Object.assign(bound, {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // Each hint owns its model. Abort alone need not release SDK connection pools.
      if (model instanceof ChatBedrockConverse) model.client.destroy();
    },
  });
}
