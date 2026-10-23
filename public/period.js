export function monthPeriod(day){return {mode:'month',month:day.slice(0,7)}}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value}
export function periodBounds(period){
 if(period.mode==='month'){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period.month||''))throw Error('Choose a month');
  const [year,month]=period.month.split('-').map(Number);
  return {from:period.month+'-01',to:period.month+'-'+new Date(Date.UTC(year,month,0)).getUTCDate()};
 }
 if(period.mode!=='range'||!validDate(period.from||'')||!validDate(period.to||''))throw Error('Choose both dates');
 if(period.from>period.to)throw Error('The end date must be on or after the start date');
 return {from:period.from,to:period.to};
}
export function filterPeriod(deliveries,period){const {from,to}=periodBounds(period);return deliveries.filter(d=>d.date>=from&&d.date<=to)}
