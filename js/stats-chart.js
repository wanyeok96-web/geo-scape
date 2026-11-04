// 통계 그래프 (Chart.js). 조사 연도 값만 점으로 표시하며, 현재 연도는 세로선으로 표시합니다.
const yearLine = {
  id: 'gsYearLine',
  afterDatasetsDraw(chart, _args, opts) {
    if (opts.year == null) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(opts.year);
    if (x < chartArea.left || x > chartArea.right) return;
    ctx.save();
    ctx.strokeStyle = '#0f9488';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
    ctx.restore();
  }
};

export function createStatsChart(canvas, series, range) {
  if (!window.Chart) return null;
  const pts = series.data.map((d) => ({ x: d.year, y: d.value }));
  const chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      datasets: [{
        label: series.label, data: pts, borderColor: '#12385a', backgroundColor: 'rgba(20,184,166,.12)', fill: true,
        tension: 0.25, pointRadius: 3, pointBackgroundColor: '#12385a', pointHoverRadius: 6, borderWidth: 2
      }]
    },
    plugins: [yearLine],
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      scales: {
        x: { type: 'linear', min: range.start, max: range.end, ticks: { stepSize: 10, callback: (v) => v, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { font: { size: 10 } }, grid: { color: '#eef2f5' } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (it) => `${it[0].raw.x}년 조사`, label: (it) => `${it.raw.y.toLocaleString()} ${series.unit}` } },
        gsYearLine: { year: null }
      }
    }
  });

  return {
    setYear(year) {
      // 현재 연도 이하의 가장 최근 조사값 강조 (보간하지 않음)
      let idx = -1;
      pts.forEach((p, i) => { if (p.x <= year) idx = i; });
      const ds = chart.data.datasets[0];
      ds.pointRadius = pts.map((_, i) => (i === idx ? 6 : 3));
      ds.pointBackgroundColor = pts.map((_, i) => (i === idx ? '#14b8a6' : '#12385a'));
      chart.options.plugins.gsYearLine.year = year;
      chart.update('none');
      return idx >= 0 ? series.data[idx] : null;
    },
    destroy() { chart.destroy(); }
  };
}
