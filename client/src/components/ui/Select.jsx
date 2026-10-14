export function Select({ children, label, id, hint, className = "", ...props }) {
  const selectId = id || props.name;

  return (
    <label className={`field ${className}`.trim()} htmlFor={selectId}>
      {label ? <span className="field__label">{label}</span> : null}
      <select className="field__control" id={selectId} {...props}>{children}</select>
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}
