import test from 'node:test';
import assert from 'node:assert/strict';
import {monthPeriod,periodBounds,filterPeriod} from '../public/period.js';
const deliveries=[{id:1,date:'2026-09-30'},{id:2,date:'2026-10-01'},{id:3,date:'2026-10-23'},{id:4,date:'2026-10-31'},{id:5,date:'2026-11-01'}];
test('overview defaults to the current month',()=>{assert.deepEqual(monthPeriod('2026-10-23'),{mode:'month',month:'2026-10'});assert.deepEqual(filterPeriod(deliveries,monthPeriod('2026-10-23')).map(d=>d.id),[2,3,4])});
test('custom date range includes both boundary dates',()=>assert.deepEqual(filterPeriod(deliveries,{mode:'range',from:'2026-10-01',to:'2026-10-23'}).map(d=>d.id),[2,3]));
test('month lengths include leap years and year changes',()=>{assert.equal(periodBounds({mode:'month',month:'2024-02'}).to,'2024-02-29');assert.equal(periodBounds({mode:'month',month:'2026-02'}).to,'2026-02-28');assert.equal(periodBounds({mode:'month',month:'2026-12'}).to,'2026-12-31')});
test('reject missing, impossible or reversed periods',()=>{for(const p of [{mode:'range',from:'',to:'2026-10-01'},{mode:'range',from:'2026-02-30',to:'2026-03-01'},{mode:'range',from:'2026-10-24',to:'2026-10-23'},{mode:'month',month:'2026-13'}])assert.throws(()=>periodBounds(p))});
test('empty period returns no records',()=>assert.deepEqual(filterPeriod(deliveries,{mode:'month',month:'2025-01'}),[]));
