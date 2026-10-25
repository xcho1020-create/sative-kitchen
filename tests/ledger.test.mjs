import test from 'node:test';
import assert from 'node:assert/strict';
import {payoutGroups,selectedLine} from '../public/ledger.js';
const delivery=(id,day,total,extra={})=>({id,date:day,payout_date:day,total,source:'app',...extra});
const payment=(id,day,amount,extra={})=>({id,date:day,payout_date:day,amount,...extra});
test('newest payout dates first, including payments without deliveries',()=>{
 const groups=payoutGroups([delivery('d','2026-10-22',300)],[payment('advance','2026-10-26',50)]);
 assert.deepEqual(groups.map(g=>g.day),['2026-10-26','2026-10-22']);assert.equal(groups[0].status,'Advance');assert.equal(groups[0].balance,-50);
});
test('deleting or reducing delivery leaves money recorded and exposes advance',()=>{
 const payments=[payment('p','2026-10-22',300)];
 assert.equal(payoutGroups([delivery('d','2026-10-22',350)],payments)[0].balance,50);
 assert.equal(payoutGroups([delivery('d','2026-10-22',250)],payments)[0].balance,-50);
 assert.equal(payoutGroups([delivery('d','2026-10-22',250,{deleted_at:'2026-10-25'})],payments)[0].balance,-300);
});
test('deleted payments, deleted deliveries and legacy paid totals do not enter current balances',()=>{
 const groups=payoutGroups([delivery('legacy','2026-10-22',999,{source:'legacy'}),delivery('d','2026-10-22',100)],[payment('p','2026-10-22',20),payment('removed','2026-10-22',999,{deleted_at:'2026-10-25'})]);
 assert.equal(groups[0].total,100);assert.equal(groups[0].paid,20);assert.equal(groups[0].status,'Partially paid');
});
test('payment history sorts by actual payment date then timestamp',()=>{
 const groups=payoutGroups([],[payment('a','2026-10-22',1,{date:'2026-10-20',created_at:'a'}),payment('b','2026-10-22',1,{date:'2026-10-21',created_at:'a'}),payment('c','2026-10-22',1,{date:'2026-10-21',created_at:'b'})]);
 assert.deepEqual(groups[0].payments.map(p=>p.id),['c','b','a']);
});
test('balance rounds currency, and equal totals are closed',()=>{
 const g=payoutGroups([delivery('d','2026-10-22',0.3)],[payment('p1','2026-10-22',0.1),payment('p2','2026-10-22',0.2)])[0];assert.equal(g.balance,0);assert.equal(g.status,'Paid');
});
test('unchanged imported line preserves its recorded total; explicit edits recalculate',()=>{
 const row={index:0,quantity:3,supply_price:10,price_quantity:1,line_total:29.99};assert.equal(selectedLine(row,3,10),29.99);assert.equal(selectedLine(row,4,10),40);assert.equal(selectedLine(row,3,11),33);
});
