// Pure data merge shared by the Worker and browser; no secrets or network access.
const fail = () => new Error('รูปแบบข้อมูลรายได้ไม่ถูกต้อง');
function label(date) { return date.slice(8, 10) + '/' + date.slice(5, 7); }
function nextLabel(date) { return label(new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString()); }

export function mergeMonth(data, source, config, provider = 'eqlink') {
  if (!Array.isArray(data.rows) || !Array.isArray(data.slots)) throw fail();
  const codes = new Set(config.mapping.map(m => m.code));
  const indices = new Map(data.slots.map((s, i) => [s, i]));
  const seen = new Set();
  const metadata = new Map((source.machines||[]).map(m=>[m.code,m]));
  const existing = new Set(data.rows.map(r=>r.code));
  const added = [...metadata.values()].filter(m=>m.append && codes.has(m.code) && !existing.has(m.code))
    .map(m=>({code:m.code,name:m.name||m.code,owner:provider.toUpperCase(),cells:data.slots.map(()=>null)}));
  const merged = [...data.rows,...added].map(row => {
    if (!codes.has(row.code)) return row;
    if (seen.has(row.code)) throw fail();
    seen.add(row.code);
    if (!Array.isArray(row.cells)) throw fail();
    const meta=metadata.get(row.code);
    const unavailable=meta?.unavailable;
    let total = 0;
    const daily = {};
    source.dates.forEach((date, i) => {
      if(!unavailable)total += source.totals[i][row.code];
      if (!Number.isSafeInteger(total)) throw fail();
      const day = label(date);
      const index = indices.get(nextLabel(date) + ' 00:00') ?? indices.get(day + ' 22:00') ?? indices.get(day + ' 00:00');
      daily[day] = { s: row.cells[index]?.s || 'UNKNOWN', d: unavailable?null:source.totals[i][row.code] / 100,
        m: unavailable?null:total / 100, closed: date < source.today };
    });
    const roundTotals = new Map(source.dates.filter(date => date < source.today)
      .map(date => [nextLabel(date) + ' 00:00', daily[label(date)]]));
    const cells = data.slots.map((slot, i) => {
      const observed = row.cells[i], money = roundTotals.get(slot);
      return observed || money ? { s: observed?.s || 'UNKNOWN', d: money?.d ?? null, m: money?.m ?? null } : null;
    });
    return { ...row, cells, daily, revenueSource: provider, revenueUnavailable: unavailable||null, currency:meta?.currency||'THB',
      ...(source.current ? { currentStatus: source.status[row.code] } : {}) };
  });
  return seen.size ? { ...data, rows: merged, dailyLabels: [...new Set([...(data.dailyLabels || []), ...source.dates.map(label)])] } : data;
}

