const toneRules = [
  ["red", /critical|danger|delete|destructive|failed|unpaid|overdue|absent|cancel/],
  ["orange", /preparing|attention|occupied|check out|checkout/],
  ["green", /revenue|success|available|menu|food|completed|active|collected|ready|present/],
  ["amber", /inventory|stock|staff|attendance|pending|warning|reserved/],
  ["purple", /report|analytics|table|dining|operations/],
  ["pink", /beverage|dessert|fruit/],
];

export function getSemanticIconTone(semantic = "", fallback = "blue") {
  const value = String(semantic).trim().toLowerCase();
  return toneRules.find(([, pattern]) => pattern.test(value))?.[0] || fallback;
}

export function SemanticIcon({ className = "", icon: Icon, semantic, size = "md", tone }) {
  const resolvedTone = tone || getSemanticIconTone(semantic);
  const iconSize = { nav: 16, sm: 18, md: 20, lg: 21 }[size] || 20;

  if (!Icon) return null;

  return (
    <span aria-hidden="true" className={`semantic-icon semantic-icon--${size} semantic-icon--${resolvedTone} ${className}`.trim()}>
      <Icon size={iconSize} strokeWidth={1.9} />
    </span>
  );
}
