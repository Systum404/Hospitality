export function Sparkline({ values }) {
  const width = 160;
  const height = 46;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values.map((value, index) => `${(index * width) / (values.length - 1)},${height - 5 - ((value - min) / (max - min)) * (height - 10)}`).join(" ");
  return <svg className="sparkline" viewBox={`0 0 ${width} ${height}`}><polyline fill="none" points={points} /></svg>;
}
