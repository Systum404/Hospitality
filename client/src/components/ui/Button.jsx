export function Button({ children, className = "", icon: Icon, size = "md", variant = "primary", type = "button", ...props }) {
  return (
    <button className={`button button--${variant} button--${size} ${className}`.trim()} type={type} {...props}>
      {Icon ? <span className="button__icon"><Icon aria-hidden="true" size={17} strokeWidth={2} /></span> : null}
      <span>{children}</span>
    </button>
  );
}
