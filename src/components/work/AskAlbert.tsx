"use client";

import { useState } from "react";
import { QUESTION_MAX_CHARS, questionField } from "@/lib/contracts";

export function AskAlbert({ label, disabled, onAsk }: { label: string; disabled?: boolean; onAsk: (question: string) => void }) {
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  return <form aria-label={`Ask Albert about problem ${label}`} style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
    onSubmit={event => {
      event.preventDefault();
      if (disabled) return;
      const parsed = questionField.safeParse(question);
      if (!parsed.success) { setError("Type a question of up to 200 characters."); return; }
      setError(""); onAsk(parsed.data);
    }}>
    <input type="text" aria-label={`Ask Albert about problem ${label}`} placeholder="Ask Albert…" maxLength={QUESTION_MAX_CHARS}
      value={question} disabled={disabled} onChange={event => { setQuestion(event.target.value); setError(""); }}
      style={{ minWidth: 180, width: "min(320px, 65vw)", padding: "6px 10px" }} />
    <button type="submit" disabled={disabled || !question.trim()}>Ask</button>
    {error && <span role="alert">{error}</span>}
  </form>;
}
