create extension if not exists pgcrypto with schema extensions;
create schema if not exists kitchen;
revoke all on schema kitchen from public;
grant usage on schema kitchen to anon;
create table kitchen.config (key text primary key,value jsonb not null);
create table kitchen.accounts (name text primary key check(name in ('supplier','manager')),password_hash text not null,version int not null default 1);
create table kitchen.sessions (token_hash text primary key,account text not null references kitchen.accounts(name),version int not null,expires_at timestamptz not null);
create index sessions_account on kitchen.sessions(account);
create table kitchen.attempts (key text primary key,count int not null default 0,started_at timestamptz not null default now());
create table kitchen.products (id text primary key,name text not null check(length(name) between 1 and 160),category text not null check(category in ('ready','ingredient')),unit text not null check(unit in ('pcs','g','ml')),price_quantity numeric not null check(price_quantity>0),supply_price numeric not null check(supply_price>=0),cost_price numeric check(cost_price>=0),active boolean not null default true,version int not null default 1,created_at timestamptz not null default now());
create table kitchen.deliveries (id text primary key default gen_random_uuid()::text,date date not null,payout_date date not null,items jsonb not null check(jsonb_typeof(items)='array'),total numeric(14,2) not null check(total>=0),accepted_at timestamptz,crm_at timestamptz,issue text,source text not null default 'app',legacy_payment_status text,review_note text,request_id text unique,created_at timestamptz not null default now());
create index deliveries_date on kitchen.deliveries(date desc);
create index deliveries_payout on kitchen.deliveries(payout_date);
create table kitchen.payments (id uuid primary key default gen_random_uuid(),payout_date date not null,amount numeric(14,2) not null check(amount>0),date date not null,reference text not null default '',actor text not null,request_id text unique,created_at timestamptz not null default now());
create index payments_payout on kitchen.payments(payout_date);
create table kitchen.audit (id bigint generated always as identity primary key,actor text not null,action text not null,entity text,details jsonb,created_at timestamptz not null default now());
create table kitchen.source_archive (id text primary key,source text not null,tab text not null,content jsonb not null,captured_at timestamptz not null default now());
create table kitchen.reconciliation (id bigint generated always as identity primary key,source text not null,reference text not null,kind text not null,details jsonb not null,resolved_at timestamptz);
create table kitchen.outbox (id bigint generated always as identity primary key,event text not null,entity text not null,created_at timestamptz not null default now());
do $$ declare t text; begin foreach t in array array['config','accounts','sessions','attempts','products','deliveries','payments','audit','source_archive','reconciliation','outbox'] loop execute format('alter table kitchen.%I enable row level security',t); end loop; end $$;
revoke all on all tables in schema kitchen from anon,authenticated;
revoke all on all sequences in schema kitchen from anon,authenticated;

create or replace function kitchen.request(gateway text,action text,token text,data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  who text; acct kitchen.accounts; sess kitchen.sessions; p kitchen.products; d kitchen.deliveries;
  raw_token text; attempt_key text; attempts kitchen.attempts; result jsonb; entry jsonb; item jsonb; items jsonb:='[]'::jsonb;
  qty numeric; total numeric:=0; day date; amount numeric; already numeric; due numeric; duplicate text; v_date date;
begin
  if gateway is null or encode(extensions.digest(gateway,'sha256'),'hex') is distinct from (select value#>>'{}' from kitchen.config where key='gateway_hash') then
    return jsonb_build_object('error','Access denied','status',403);
  end if;
  if action='login' then
    if data->>'account' not in ('supplier','manager') or length(coalesce(data->>'password',''))>128 then return jsonb_build_object('error','Incorrect account or password','status',401); end if;
    attempt_key:=encode(extensions.digest(coalesce(data->>'ip','unknown')||':'||(data->>'account'),'sha256'),'hex');
    perform pg_advisory_xact_lock(hashtextextended(attempt_key,0));
    insert into kitchen.attempts(key) values(attempt_key) on conflict do nothing;
    select * into attempts from kitchen.attempts where key=attempt_key for update;
    if attempts.started_at<now()-interval '15 minutes' then update kitchen.attempts set count=0,started_at=now() where key=attempt_key; attempts.count:=0; end if;
    if attempts.count>=10 then return jsonb_build_object('error','Too many attempts. Try again in 15 minutes.','status',429); end if;
    select * into acct from kitchen.accounts where name=data->>'account';
    if acct.name is null or extensions.crypt(coalesce(data->>'password',''),acct.password_hash)<>acct.password_hash then
      update kitchen.attempts set count=count+1 where key=attempt_key;
      return jsonb_build_object('error','Incorrect account or password','status',401);
    end if;
    delete from kitchen.attempts where key=attempt_key;
    delete from kitchen.sessions where expires_at<now();
    raw_token:=encode(extensions.gen_random_bytes(32),'hex');
    insert into kitchen.sessions values(encode(extensions.digest(raw_token,'sha256'),'hex'),acct.name,acct.version,now()+interval '90 days');
    return jsonb_build_object('account',acct.name,'session',raw_token);
  end if;
    select s.* into sess from kitchen.sessions s join kitchen.accounts a on a.name=s.account and a.version=s.version where s.token_hash=encode(extensions.digest(coalesce(token,''),'sha256'),'hex') and s.expires_at>now();
    who:=sess.account;

  if who is null then return jsonb_build_object('error','Please sign in','status',401); end if;
  update kitchen.sessions set expires_at=now()+interval '90 days' where token_hash=sess.token_hash and expires_at<now()+interval '89 days';
  if action='logout' then delete from kitchen.sessions where token_hash=sess.token_hash; return jsonb_build_object('ok',true); end if;
  if action='password' then
    select * into acct from kitchen.accounts where name=who for update;
    if extensions.crypt(coalesce(data->>'current',''),acct.password_hash)<>acct.password_hash then return jsonb_build_object('error','Current password is incorrect','status',400); end if;
    if length(coalesce(data->>'password','')) not between 4 and 128 then return jsonb_build_object('error','Use 4 to 128 characters','status',400); end if;
    update kitchen.accounts set password_hash=extensions.crypt(data->>'password',extensions.gen_salt('bf',10)),version=version+1 where name=who;
    delete from kitchen.sessions where account=who and token_hash<>sess.token_hash;
    update kitchen.sessions set version=version+1 where token_hash=sess.token_hash;
    insert into kitchen.audit(actor,action) values(who,'password_changed');
    return jsonb_build_object('ok',true);
  end if;
  if action='state' then
    select jsonb_build_object('account',who,'products',coalesce((select jsonb_agg(case when who='supplier' then to_jsonb(pp) else to_jsonb(pp)-'cost_price' end order by pp.active desc,pp.category desc,pp.name) from kitchen.products pp),'[]'::jsonb),'deliveries',coalesce((select jsonb_agg(case when who='supplier' then to_jsonb(dd) else jsonb_set(to_jsonb(dd),'{items}',coalesce((select jsonb_agg(i-'cost_price') from jsonb_array_elements(dd.items) i),'[]'::jsonb)) end order by dd.date desc,dd.created_at desc) from kitchen.deliveries dd),'[]'::jsonb),'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.date desc) from kitchen.payments x),'[]'::jsonb),'migration',jsonb_build_object('captured_at',(select value from kitchen.config where key='source_captured_at'),'review_count',(select count(*) from kitchen.reconciliation where resolved_at is null),'stage',(select value from kitchen.config where key='stage'))) into result;
    return result;
  end if;
  if action in ('product','archive','delivery','move_payout') and who<>'supplier' then return jsonb_build_object('error','Supplier access required','status',403); end if;
  if action in ('accept','crm','issue') and who<>'manager' then return jsonb_build_object('error','Manager access required','status',403); end if;
  if action='product' then
    if nullif(btrim(data->>'name'),'') is null or data->>'unit' not in ('pcs','g','ml') or (data->>'supply_price')::numeric<0 or (data->>'price_quantity')::numeric<=0 then return jsonb_build_object('error','Check product fields','status',400); end if;
    if nullif(data->>'id','') is not null then
      select * into p from kitchen.products where id=data->>'id' for update;
      if p.id is null then return jsonb_build_object('error','Product not found','status',404); end if;
      if p.version<>(data->>'version')::int then return jsonb_build_object('error','Product changed. Reload before saving.','status',409); end if;
      update kitchen.products set name=btrim(data->>'name'),category=data->>'category',unit=data->>'unit',price_quantity=(data->>'price_quantity')::numeric,supply_price=(data->>'supply_price')::numeric,cost_price=nullif(data->>'cost_price','')::numeric,version=version+1 where id=p.id;
    else
      insert into kitchen.products(id,name,category,unit,price_quantity,supply_price,cost_price) values(gen_random_uuid()::text,btrim(data->>'name'),data->>'category',data->>'unit',(data->>'price_quantity')::numeric,(data->>'supply_price')::numeric,nullif(data->>'cost_price','')::numeric) returning * into p;
    end if;
    insert into kitchen.audit(actor,action,entity,details) values(who,'product_saved',p.id,jsonb_build_object('previous',to_jsonb(p),'new',data));
    insert into kitchen.outbox(event,entity) values('catalogue',p.id);
    return jsonb_build_object('ok',true);
  elsif action='archive' then
    update kitchen.products set active=(data->>'active')::boolean,version=version+1 where id=data->>'id';
  elsif action='delivery' then
    if length(coalesce(data->>'request_id','')) not between 8 and 100 then return jsonb_build_object('error','Request ID required','status',400); end if;
    if jsonb_typeof(data->'items')<>'array' or jsonb_array_length(data->'items') not between 1 and 200 then return jsonb_build_object('error','Add at least one product','status',400); end if;
    select id into duplicate from kitchen.deliveries where request_id=data->>'request_id';
    if duplicate is not null then return jsonb_build_object('ok',true,'id',duplicate); end if;
    v_date:=(data->>'date')::date; day:=(data->>'payout_date')::date;
    if v_date is null or day is null then return jsonb_build_object('error','Choose both dates','status',400); end if;
    perform pg_advisory_xact_lock(hashtextextended('payout:'||day::text,0));
    if exists(select 1 from kitchen.payments where payout_date=day) then return jsonb_build_object('error','Choose a payout without recorded payments','status',409); end if;
    for entry in select value from jsonb_array_elements(data->'items') loop
      select * into p from kitchen.products where id=entry->>'product_id' and active for share;
      qty:=(entry->>'quantity')::numeric;
      if p.id is null or qty is null or qty<=0 or qty>10000000 then return jsonb_build_object('error','Check quantities and active products','status',400); end if;
      if p.version<>(entry->>'version')::int then return jsonb_build_object('error','A product price changed. Reload and check the total.','status',409); end if;
      if exists(select 1 from jsonb_array_elements(items) x where x->>'product_id'=p.id) then return jsonb_build_object('error','Duplicate product','status',400); end if;
      item:=jsonb_build_object('product_id',p.id,'name',p.name,'category',p.category,'unit',p.unit,'price_quantity',p.price_quantity,'quantity',qty,'supply_price',p.supply_price,'cost_price',p.cost_price,'line_total',round(qty*p.supply_price/p.price_quantity,2));
      items:=items||jsonb_build_array(item); total:=total+round(qty*p.supply_price/p.price_quantity,2);
    end loop;
    insert into kitchen.deliveries(date,payout_date,items,total,request_id) values(v_date,day,items,total,data->>'request_id') returning * into d;
    insert into kitchen.audit(actor,action,entity,details) values(who,'delivery_created',d.id,to_jsonb(d));
    insert into kitchen.outbox(event,entity) values('delivery',d.id);
    return jsonb_build_object('ok',true,'id',d.id);
  elsif action='move_payout' then
    select * into d from kitchen.deliveries where id=data->>'id' for update;
    day:=(data->>'payout_date')::date;
    if d.id is null or day is null then return jsonb_build_object('error','Delivery or date missing','status',400); end if;
    perform pg_advisory_xact_lock(hashtextextended('payout:'||least(day,d.payout_date)::text,0));
    perform pg_advisory_xact_lock(hashtextextended('payout:'||greatest(day,d.payout_date)::text,0));
    if d.source<>'app' or exists(select 1 from kitchen.payments where payout_date in (day,d.payout_date)) then return jsonb_build_object('error','Imported or paid payouts cannot be reassigned','status',409); end if;
    update kitchen.deliveries set payout_date=day where id=d.id;
  elsif action in ('accept','crm','issue') then
    select * into d from kitchen.deliveries where id=data->>'id' for update;
    if d.id is null then return jsonb_build_object('error','Delivery not found','status',404); end if;
    if action='accept' then
      if d.issue is not null then return jsonb_build_object('error','Resolve discrepancy before acceptance','status',409); end if;
      update kitchen.deliveries set accepted_at=coalesce(accepted_at,now()) where id=d.id;
    elsif action='crm' then
      if d.accepted_at is null or d.issue is not null then return jsonb_build_object('error','Accept delivery and resolve discrepancies first','status',409); end if;
      update kitchen.deliveries set crm_at=coalesce(crm_at,now()) where id=d.id;
    else update kitchen.deliveries set issue=nullif(left(btrim(data->>'issue'),1000),'') where id=d.id;
    end if;
  elsif action='payment' then
    if length(coalesce(data->>'request_id','')) not between 8 and 100 then return jsonb_build_object('error','Request ID required','status',400); end if;
    day:=(data->>'payout_date')::date; amount:=round((data->>'amount')::numeric,2); v_date:=(data->>'date')::date;
    if day is null or v_date is null or amount is null or amount<=0 then return jsonb_build_object('error','Check payment amount and dates','status',400); end if;
    perform pg_advisory_xact_lock(hashtextextended('payout:'||day::text,0));
    if exists(select 1 from kitchen.payments where request_id=data->>'request_id') then return jsonb_build_object('ok',true); end if;
    if exists(select 1 from kitchen.deliveries where payout_date=day and source='app' and (accepted_at is null or issue is not null)) then return jsonb_build_object('error','Accept all deliveries and resolve discrepancies first','status',409); end if;
    select coalesce(sum(kd.total),0) into due from kitchen.deliveries kd where kd.payout_date=day and kd.source='app';
    select coalesce(sum(kpay.amount),0) into already from kitchen.payments kpay where kpay.payout_date=day;
    if amount>due-already then return jsonb_build_object('error','Payment exceeds outstanding amount','status',409); end if;
    insert into kitchen.payments(payout_date,amount,date,reference,actor,request_id) values(day,amount,v_date,left(coalesce(data->>'reference',''),250),who,data->>'request_id');
  else return jsonb_build_object('error','Unknown action','status',400);
  end if;
  insert into kitchen.audit(actor,action,entity,details) values(who,action,data->>'id',case when action='archive' then data else data-'password'-'current' end);
  insert into kitchen.outbox(event,entity) values(action,coalesce(data->>'id',data->>'payout_date',''));
  return jsonb_build_object('ok',true);
exception when invalid_text_representation or check_violation or not_null_violation or datetime_field_overflow then
  return jsonb_build_object('error','Invalid values. Check all fields.','status',400);
end $$;
revoke all on function kitchen.request(text,text,text,jsonb) from public,authenticated;
grant execute on function kitchen.request(text,text,text,jsonb) to anon;
create or replace function public.kitchen_request(gateway text,action text,token text default '',data jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select kitchen.request(gateway,action,token,data); $$;
revoke all on function public.kitchen_request(text,text,text,jsonb) from public,authenticated;
grant execute on function public.kitchen_request(text,text,text,jsonb) to anon;
