export function DonutChart({ items, value }) {
  const gradient = items.reduce((segments, item, index) => {
    const previous = segments[index - 1]?.end || 0;
    const end = previous + item.value;
    segments.push({ ...item, start: previous, end });
    return segments;
  }, []);
  const background = `conic-gradient(${gradient.map((item) => `${item.color} ${item.start}% ${item.end}%`).join(", ")})`;

  return (
    <div className="donut-chart-wrap">
      <div aria-label={`Occupancy ${value}%`} className="donut-chart" role="img" style={{ background }}><div><strong>{value}%</strong><span>occupied</span></div></div>
      <div className="donut-legend">{items.map((item) => <div key={item.label}><span style={{ backgroundColor: item.color }} /><p>{item.label}<strong>{item.value}%</strong></p></div>)}</div>
    </div>
  );
}
