"use client";

import { useState } from "react";
import { QUESTION_MAX_CHARS, questionField } from "@/lib/contracts";

export function AskAlbert({ label, disabled, onAsk }: { label: string; disabled?: boolean; onAsk: (question: string) => void }) {
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  return <form aria-label={`Ask Albert about problem ${label}`} className="ask-albert"
    onSubmit={event => {
      event.preventDefault();
      if (disabled) return;
      const parsed = questionField.safeParse(question);
      if (!parsed.success) { setError("Type a question of up to 200 characters."); return; }
      setError(""); onAsk(parsed.data);
    }}>
    <input type="text" aria-label={`Ask Albert about problem ${label}`} placeholder="Ask Albert…" maxLength={QUESTION_MAX_CHARS}
      value={question} disabled={disabled} onChange={event => { setQuestion(event.target.value); setError(""); }}
      className="ask-albert__input" />
    <button type="submit" className="btn-secondary" disabled={disabled || !question.trim()}>Ask</button>
    {error && <span role="alert" className="ask-albert__error">{error}</span>}
  </form>;
}
