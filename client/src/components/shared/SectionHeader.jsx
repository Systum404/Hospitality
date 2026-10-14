export function SectionHeader({ action, eyebrow, title }) {
  return (
    <div className="section-header">
      <div>{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}<h3>{title}</h3></div>
      {action || null}
    </div>
  );
}
