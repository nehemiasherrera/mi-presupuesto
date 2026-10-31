/* =========================================================
   charts.js — Gráficos SVG livianos (sin librerías externas)
   ========================================================= */

const Charts = {
  /** Dona. segments: [{label, value, color}] */
  donut(segments, { size = 200, thickness = 26, centerTop = '', centerBottom = '' } = {}) {
    const total = segments.reduce((s, x) => s + x.value, 0);
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = total > 0 ? segments.filter(s => s.value > 0).map(s => {
      const len = (s.value / total) * c;
      const col = typeof safeColor === 'function' ? safeColor(s.color, '#7c5cff') : s.color;
      const arc = `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${col}"
        stroke-width="${thickness}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}"
        class="donut-seg"><title>${esc(s.label)}: ${fmt(s.value)}</title></circle>`;
      offset += len;
      return arc;
    }).join('') : '';
    return `
      <svg viewBox="0 0 ${size} ${size}" class="donut" style="max-width:${size}px">
        <circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="var(--track)" stroke-width="${thickness}"/>
        <g transform="rotate(-90 ${size / 2} ${size / 2})">${arcs}</g>
        <text x="50%" y="47%" text-anchor="middle" class="donut-top">${esc(centerTop)}</text>
        <text x="50%" y="60%" text-anchor="middle" class="donut-bottom">${esc(centerBottom)}</text>
      </svg>`;
  },

  /** Barras verticales. data: [{label, value, highlight}] */
  bars(data, { height = 180, color = 'var(--accent)', avgLine = null } = {}) {
    const w = 640, pad = 24, h = height;
    const max = Math.max(1, ...data.map(d => d.value), avgLine || 0);
    const bw = (w - pad * 2) / Math.max(1, data.length);
    const bars = data.map((d, i) => {
      const bh = (d.value / max) * (h - 34);
      const x = pad + i * bw + bw * 0.15;
      const y = h - 18 - bh;
      const showLabel = data.length <= 16 || i % 2 === 0;
      return `
        <rect x="${x}" y="${y}" width="${bw * 0.7}" height="${Math.max(0, bh)}" rx="3"
          fill="${d.highlight ? 'var(--danger)' : color}" opacity="${d.value ? 1 : .25}" class="bar">
          <title>${esc(d.label)}: ${fmt(d.value)}</title></rect>
        ${showLabel ? `<text x="${x + bw * 0.35}" y="${h - 4}" text-anchor="middle" class="axis">${esc(d.label)}</text>` : ''}`;
    }).join('');
    const avg = avgLine ? (() => {
      const y = h - 18 - (avgLine / max) * (h - 34);
      return `<line x1="${pad}" x2="${w - pad}" y1="${y}" y2="${y}" class="avg-line"/>
              <text x="${w - pad}" y="${y - 4}" text-anchor="end" class="axis">prom. ${fmt(avgLine)}</text>`;
    })() : '';
    return `<svg viewBox="0 0 ${w} ${h}" class="bars">${bars}${avg}</svg>`;
  },
};
