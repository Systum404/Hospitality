export function Input({ label, id, hint, className = "", ...props }) {
  const inputId = id || props.name;

  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      {label ? <span className="field__label">{label}</span> : null}
      <input className="field__control" id={inputId} {...props} />
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}
