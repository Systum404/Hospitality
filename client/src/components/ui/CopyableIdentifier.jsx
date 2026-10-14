import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";

export const IDENTIFIER_FEEDBACK_DURATION = 1600;

export function compactIdentifier(value, { maxLength = 22, leading = 8, trailing = 6 } = {}) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  const prefix = text.match(/^[A-Za-z]+-/)?.[0] ?? "";
  const body = text.slice(prefix.length);
  return `${prefix}${body.slice(0, leading)}…${body.slice(-trailing)}`;
}

export async function copyFullIdentifier(value, clipboard = globalThis.navigator?.clipboard) {
  if (!clipboard?.writeText) throw new Error("Clipboard unavailable");
  await clipboard.writeText(String(value));
}

export function scheduleIdentifierFeedbackClear(clear, schedule = setTimeout) {
  return schedule(clear, IDENTIFIER_FEEDBACK_DURATION);
}

export function IdentifierButton({ feedback = "", label = "ID", onCopy, value }) {
  return <button aria-label={`Copy full ${label}: ${value}`} className="copyable-identifier" onClick={onCopy} title="Click to copy full ID" type="button"><span className="copyable-identifier__value">{compactIdentifier(value)}</span><Copy aria-hidden="true" className="copyable-identifier__icon" size={14} />{feedback ? <span aria-live="polite" className={`copyable-identifier__feedback ${feedback === "Copied" ? "is-success" : "is-error"}`} role="status">{feedback}</span> : null}</button>;
}

export function CopyableIdentifier({ label = "ID", value }) {
  const [feedback, setFeedback] = useState("");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async event => {
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(timer.current);
    try {
      await copyFullIdentifier(value);
      setFeedback("Copied");
    } catch {
      setFeedback("Copy unavailable");
    }
    timer.current = scheduleIdentifierFeedbackClear(() => setFeedback(""));
  };
  return <IdentifierButton feedback={feedback} label={label} onCopy={copy} value={value} />;
}
