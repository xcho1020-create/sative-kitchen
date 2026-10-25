export const amount = value => Number(value) || 0;
export function payoutGroups(deliveries, payments) {
  const groups = new Map();
  const get = day => { if (!groups.has(day)) groups.set(day, {day, deliveries: [], payments: []}); return groups.get(day); };
  for (const d of deliveries) if (d.source === 'app' && !d.deleted_at) get(d.payout_date).deliveries.push(d);
  for (const p of payments) if (!p.deleted_at) get(p.payout_date).payments.push(p);
  return [...groups.values()].map(g => {
    g.deliveries.sort((a,b) => b.date.localeCompare(a.date) || String(b.created_at||'').localeCompare(String(a.created_at||'')));
    g.payments.sort((a,b) => b.date.localeCompare(a.date) || String(b.created_at||'').localeCompare(String(a.created_at||'')));
    g.total = Math.round(g.deliveries.reduce((s,d) => s+amount(d.total),0)*100)/100;
    g.paid = Math.round(g.payments.reduce((s,p) => s+amount(p.amount),0)*100)/100;
    g.balance = Math.round((g.total-g.paid)*100)/100;
    g.status = g.balance < 0 ? 'Advance' : g.balance === 0 ? 'Paid' : g.paid > 0 ? 'Partially paid' : 'Unpaid';
    return g;
  }).sort((a,b) => b.day.localeCompare(a.day));
}
export function selectedLine(row, quantity, price) {
  if (row.index != null && amount(quantity) === amount(row.quantity) && amount(price) === amount(row.supply_price)) return amount(row.line_total);
  return Math.round(amount(quantity)*amount(price)/amount(row.price_quantity)*100)/100;
}
