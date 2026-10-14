export function Textarea({ label, id, hint, className = "", ...props }) {
  const textareaId = id || props.name;

  return (
    <label className={`field ${className}`.trim()} htmlFor={textareaId}>
      {label ? <span className="field__label">{label}</span> : null}
      <textarea className="field__control field__control--textarea" id={textareaId} {...props} />
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}
