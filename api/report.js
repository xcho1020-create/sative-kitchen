import { timingSafeEqual } from 'node:crypto';
import { rpc } from './v2.js';

const safe=s=>{const value=String(s??'');return /^[=+\-@\t\r]/.test(value)?`'${value}`:value};
const csv=rows=>rows.map(row=>row.map(x=>`"${safe(x).replaceAll('"','""')}"`).join(',')).join('\r\n')+'\r\n';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET')return res.status(405).end();
  const expected=process.env.KITCHEN_REPORT_KEY||'';
  const given=String(req.query.key||'');
  if(!expected||!given||Buffer.byteLength(expected)!==Buffer.byteLength(given)||!timingSafeEqual(Buffer.from(expected),Buffer.from(given)))return res.status(403).end();
  const type=String(req.query.type||'');
  if(!['products','deliveries','items','payouts'].includes(type))return res.status(400).end();
  try{
    const s=await rpc('report','',{});
    if(s.error)throw Error('Report unavailable');
    let rows;
    if(type==='products')rows=[['id','name','category','unit','price_quantity','supply_price','active','version'],...s.products.map(p=>[p.id,p.name,p.category,p.unit,p.price_quantity,p.supply_price,p.active,p.version])];
    if(type==='deliveries')rows=[['id','delivery_date','payout_date','total','source','accepted_at','crm_at','issue','legacy_payment_status'],...s.deliveries.map(d=>[d.id,d.date,d.payout_date,d.total,d.source,d.accepted_at,d.crm_at,d.issue,d.legacy_payment_status])];
    if(type==='items')rows=[['delivery_id','delivery_date','payout_date','product_id','name','category','unit','price_quantity','quantity','supply_price','line_total'],...s.deliveries.flatMap(d=>d.items.map(i=>[d.id,d.date,d.payout_date,i.product_id,i.name,i.category,i.unit,i.price_quantity,i.quantity,i.supply_price,i.line_total]))];
    if(type==='payouts'){
      const totals=new Map();for(const d of s.deliveries.filter(d=>d.source==='app'))totals.set(d.payout_date,(totals.get(d.payout_date)||0)+Number(d.total));
      rows=[['payout_date','new_delivery_total','paid','remaining','delivery_count'],...[...totals].sort().map(([day,total])=>{const paid=s.payments.filter(p=>p.payout_date===day).reduce((n,p)=>n+Number(p.amount),0);return [day,total.toFixed(2),paid.toFixed(2),(total-paid).toFixed(2),s.deliveries.filter(d=>d.source==='app'&&d.payout_date===day).length]})];
    }
    res.setHeader('Content-Type','text/csv; charset=utf-8');return res.status(200).send(csv(rows));
  }catch{return res.status(503).send('Report temporarily unavailable')}
}
