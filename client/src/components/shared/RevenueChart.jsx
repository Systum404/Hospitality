function pointsFor(values, width, height, padding) {
  const safeValues = values.length ? values.map(value => Number(value) || 0) : [0];
  const max = Math.max(...safeValues);
  const min = Math.min(...safeValues);
  const range = max - min || 1;
  return safeValues.map((value, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(1, safeValues.length - 1);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return [x, y];
  });
}

export function RevenueChart({ labels, values }) {
  const width = 760;
  const height = 255;
  const padding = 24;
  const points = pointsFor(values, width, height, padding);
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`;

  return (
    <div className="revenue-chart">
      <svg aria-label="Daily revenue trend" role="img" viewBox={`0 0 ${width} ${height}`}>
        <defs><linearGradient id="revenue-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#a67c52" stopOpacity="0.22" /><stop offset="100%" stopColor="#a67c52" stopOpacity="0" /></linearGradient></defs>
        {[0.18, 0.4, 0.62, 0.84].map((position) => <line className="revenue-chart__grid" key={position} x1={padding} x2={width - padding} y1={height * position} y2={height * position} />)}
        <polygon fill="url(#revenue-area)" points={area} />
        <polyline className="revenue-chart__line" fill="none" points={line} />
        {points.map(([x, y], index) => <circle className="revenue-chart__point" cx={x} cy={y} key={labels[index]} r="4" />)}
      </svg>
      <div className="revenue-chart__labels">{labels.map((label) => <span key={label}>{label}</span>)}</div>
    </div>
  );
}
