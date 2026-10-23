import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{cookie} from '../api/v2.js';
import report from '../api/report.js';
import proxy from '../api/proxy.js';
const token='a'.repeat(64);
process.env.SUPABASE_URL='https://database.example';
process.env.SUPABASE_PUBLISHABLE_KEY='test-publishable';
process.env.KITCHEN_GATEWAY_KEY='test-gateway';
function response(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v},getHeader(k){return this.headers[k]},status(n){this.statusCode=n;return this},json(v){this.body=v;return this},end(){return this}}}
function request(action='state',headers={}){return {method:'POST',headers:{host:'kitchen.example','content-type':'application/json',origin:'https://kitchen.example',...headers},body:{action,data:{}},socket:{remoteAddress:'127.0.0.1'}}}
test('reject cross-site writes before database access',async()=>{const res=response();await handler(request('product',{origin:'https://attacker.example'}),res);assert.equal(res.statusCode,403)});
test('login keeps the opaque session out of JSON and sets a persistent protected cookie',async()=>{const original=global.fetch;try{global.fetch=async()=>({ok:true,json:async()=>({account:'supplier',session:token})});const res=response();await handler(request('login'),res);assert.equal(res.statusCode,200);assert.equal(res.body.session,undefined);for(const flag of ['HttpOnly','Secure','SameSite=Strict','Max-Age=7776000'])assert.ok(res.headers['Set-Cookie'].includes(flag))}finally{global.fetch=original}});
test('successful state refresh renews the existing cookie',async()=>{const original=global.fetch;try{global.fetch=async()=>({ok:true,json:async()=>({account:'manager',products:[]})});const res=response();await handler(request('state',{cookie:'kitchen_session='+token}),res);assert.ok(res.headers['Set-Cookie'].includes(token));assert.ok(res.headers['Set-Cookie'].includes('Max-Age=7776000'))}finally{global.fetch=original}});
test('expired authentication clears the cookie',async()=>{const original=global.fetch;try{global.fetch=async()=>({ok:true,json:async()=>({error:'Please sign in',status:401})});const res=response();await handler(request('state',{cookie:'kitchen_session='+token}),res);assert.equal(res.statusCode,401);assert.ok(res.headers['Set-Cookie'].includes('Max-Age=0'))}finally{global.fetch=original}});
test('cookie parser rejects malformed tokens',()=>{assert.equal(cookie({headers:{cookie:'kitchen_session=hello'}}),'');assert.equal(cookie({headers:{cookie:'other=1; kitchen_session='+token}}),token)});
test('spreadsheet feed and legacy write gateway are retired',()=>{for(const fn of [report,proxy]){const res=response();fn({},res);assert.equal(res.statusCode,410)}});
