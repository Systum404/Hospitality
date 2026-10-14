export function Card({ children, className = "" }) {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function CardHeader({ children }) {
  return <header className="card__header">{children}</header>;
}

export function CardTitle({ children }) {
  return <h3 className="card__title">{children}</h3>;
}

export function CardDescription({ children }) {
  return <p className="card__description">{children}</p>;
}

export function CardContent({ children }) {
  return <div className="card__content">{children}</div>;
}

export function CardFooter({ children }) {
  return <footer className="card__footer">{children}</footer>;
}
