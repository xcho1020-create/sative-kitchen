-- Apply after schema.sql. Existing data, snapshots and sessions are retained.
alter table kitchen.deliveries add column if not exists deleted_at timestamptz;
alter table kitchen.deliveries add column if not exists version integer not null default 1;
alter table kitchen.payments add column if not exists deleted_at timestamptz;
alter table kitchen.payments add column if not exists version integer not null default 1;

-- Internal helper: callable only by the authenticated, gateway-protected request function.
create or replace function kitchen.ledger_request(who text, action text, data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
<<ledger>>
declare
 d kitchen.deliveries; p kitchen.products; pay kitchen.payments; before_row jsonb;
 item jsonb; entry jsonb; old_item jsonb; selected jsonb; items jsonb:='[]'; rest jsonb:='[]';
 idx integer; seen integer[]:='{}'; quantity numeric; price numeric; line numeric; total numeric:=0; rest_total numeric:=0;
 day date; delivery_day date; amount numeric; credit numeric; remaining numeric; take numeric;
 new_id text; request_id text:=data->>'request_id'; changed boolean; previous_day date;
begin
 if who is null or who not in ('supplier','manager') then return jsonb_build_object('error','Please sign in','status',401); end if;
 -- All ledger operations serialize, including retries, edits and advance transfers.
 perform pg_advisory_xact_lock(hashtextextended('kitchen:ledger',0));
 if action in ('delivery','split_delivery','payment','transfer_advance') then
  if length(coalesce(request_id,'')) not between 8 and 100 then return jsonb_build_object('error','Request ID required','status',400); end if;
  if exists(select 1 from kitchen.audit where details->>'request_id'=request_id and kitchen.audit.action=ledger_request.action)
   then return jsonb_build_object('ok',true); end if;
 end if;
 if action in ('edit_delivery','delete_delivery','split_delivery','move_payout') then
  select * into d from kitchen.deliveries where id=data->>'id' and deleted_at is null for update;
  if d.id is null then return jsonb_build_object('error','Delivery no longer exists. Reload the list.','status',404); end if;
  if data->>'version' is null or d.version<>(data->>'version')::integer then return jsonb_build_object('error','This delivery changed. Reload and review it before saving.','status',409); end if;
  before_row:=to_jsonb(d);
 end if;
 if action in ('delivery','edit_delivery') then
  if jsonb_typeof(data->'items') is distinct from 'array' or jsonb_array_length(data->'items') not between 1 and 200 then return jsonb_build_object('error','Add at least one item','status',400); end if;
  delivery_day:=(data->>'date')::date; day:=(data->>'payout_date')::date;
  if delivery_day is null or day is null then return jsonb_build_object('error','Choose delivery and payout dates','status',400); end if;
  if action='delivery' and exists(select 1 from kitchen.deliveries where kitchen.deliveries.request_id=ledger.request_id) then return jsonb_build_object('ok',true); end if;
  for entry in select value from jsonb_array_elements(data->'items') loop
   old_item:=null;
   if action='edit_delivery' and entry ? 'index' then
    idx:=(entry->>'index')::integer;
    if idx<0 or idx>=jsonb_array_length(d.items) or idx=any(seen) then return jsonb_build_object('error','Invalid or repeated delivery item','status',400); end if;
    seen:=array_append(seen,idx); old_item:=d.items->idx; item:=old_item;
   else
    select * into p from kitchen.products where id=entry->>'product_id' and active for share;
    if p.id is null then return jsonb_build_object('error','Choose an active product','status',400); end if;
    if (entry->>'version')::integer is distinct from p.version then return jsonb_build_object('error','A product changed. Reload and check its price.','status',409); end if;
    item:=jsonb_build_object('product_id',p.id,'name',p.name,'category',p.category,'unit',p.unit,'price_quantity',p.price_quantity,'supply_price',p.supply_price,'cost_price',p.cost_price);
   end if;
   quantity:=(entry->>'quantity')::numeric; price:=coalesce((entry->>'supply_price')::numeric,(item->>'supply_price')::numeric);
   if quantity is null or quantity<=0 or quantity>10000000 or quantity::text in ('NaN','Infinity','-Infinity') or price is null or price<0 or price>10000000 or price::text in ('NaN','Infinity','-Infinity') then return jsonb_build_object('error','Check item quantities and prices','status',400); end if;
   -- Preserve recorded historic totals unless quantity or price is explicitly changed.
   if old_item is not null and quantity=(old_item->>'quantity')::numeric and price=(old_item->>'supply_price')::numeric then line:=(old_item->>'line_total')::numeric;
   else line:=round(quantity*price/(item->>'price_quantity')::numeric,2); end if;
   item:=item||jsonb_build_object('quantity',quantity,'supply_price',price,'line_total',line);
   items:=items||jsonb_build_array(item); total:=total+line;
  end loop;
  if action='delivery' then
   insert into kitchen.deliveries(date,payout_date,items,total,request_id) values(delivery_day,day,items,total,request_id) returning id into new_id;
  else
   changed:=d.date is distinct from delivery_day or d.items is distinct from items;
   update kitchen.deliveries set date=delivery_day,payout_date=day,items=ledger.items,total=ledger.total,version=version+1,
    accepted_at=case when changed then null else accepted_at end,crm_at=case when changed then null else crm_at end where id=d.id;
   new_id:=d.id;
  end if;
 elsif action='delete_delivery' then
  update kitchen.deliveries set deleted_at=now(),version=version+1 where id=d.id; new_id:=d.id;
 elsif action='move_payout' then
  day:=(data->>'payout_date')::date;
  if day is null then return jsonb_build_object('error','Choose a payout date','status',400); end if;
  update kitchen.deliveries set payout_date=day,version=version+1 where id=d.id; new_id:=d.id;
 elsif action='split_delivery' then
  day:=(data->>'payout_date')::date; delivery_day:=(data->>'date')::date;
  if day is null or delivery_day is null or jsonb_typeof(data->'items') is distinct from 'array' or jsonb_array_length(data->'items')=0 then return jsonb_build_object('error','Choose dates and quantities to move','status',400); end if;
  for entry in select value from jsonb_array_elements(data->'items') loop
   idx:=(entry->>'index')::integer;
   if idx is null or idx<0 or idx>=jsonb_array_length(d.items) or idx=any(seen) then return jsonb_build_object('error','Invalid or repeated split item','status',400); end if;
   quantity:=(entry->>'quantity')::numeric;
   if quantity is null or quantity<=0 or quantity>(d.items->idx->>'quantity')::numeric or quantity::text in ('NaN','Infinity','-Infinity') then return jsonb_build_object('error','Split quantity exceeds original quantity','status',400); end if;
   seen:=array_append(seen,idx);
  end loop;
  for idx in 0..jsonb_array_length(d.items)-1 loop
   item:=d.items->idx;
   select value into selected from jsonb_array_elements(data->'items') where (value->>'index')::integer=idx;
   quantity:=coalesce((selected->>'quantity')::numeric,0);
   line:=round((item->>'line_total')::numeric*quantity/(item->>'quantity')::numeric,2);
   if quantity>0 then items:=items||jsonb_build_array(item||jsonb_build_object('quantity',quantity,'line_total',line)); total:=total+line; end if;
   if quantity<(item->>'quantity')::numeric then
    rest:=rest||jsonb_build_array(item||jsonb_build_object('quantity',(item->>'quantity')::numeric-quantity,'line_total',(item->>'line_total')::numeric-line));
    rest_total:=rest_total+(item->>'line_total')::numeric-line;
   end if;
  end loop;
  if jsonb_array_length(rest)=0 then return jsonb_build_object('error','Leave at least one item or some quantity in the original delivery. Use Edit to move the whole delivery.','status',400); end if;
  update kitchen.deliveries set items=rest,total=rest_total,version=version+1,accepted_at=null,crm_at=null where id=d.id;
  insert into kitchen.deliveries(date,payout_date,items,total,source,legacy_payment_status,request_id) values(delivery_day,day,items,total,d.source,d.legacy_payment_status,request_id) returning id into new_id;
 elsif action in ('payment','edit_payment','delete_payment') then
  if action<>'payment' then
   select * into pay from kitchen.payments where id::text=data->>'id' and deleted_at is null for update;
   if pay.id is null then return jsonb_build_object('error','Payment no longer exists. Reload the list.','status',404); end if;
   if (data->>'version')::integer is distinct from pay.version then return jsonb_build_object('error','This payment changed. Reload before saving.','status',409); end if;
   before_row:=to_jsonb(pay);
  end if;
  if action='delete_payment' then
   update kitchen.payments set deleted_at=now(),version=version+1 where id=pay.id; new_id:=pay.id::text;
  else
   day:=(data->>'payout_date')::date; delivery_day:=(data->>'date')::date; amount:=round((data->>'amount')::numeric,2);
   if day is null or delivery_day is null or amount is null or amount<=0 or amount>1000000000 or amount::text in ('NaN','Infinity','-Infinity') then return jsonb_build_object('error','Check payment amount and dates','status',400); end if;
   if action='payment' then
    if exists(select 1 from kitchen.payments where kitchen.payments.request_id=ledger.request_id) then return jsonb_build_object('ok',true); end if;
    insert into kitchen.payments(payout_date,amount,date,reference,actor,request_id) values(day,amount,delivery_day,left(coalesce(data->>'reference',''),250),who,request_id) returning id::text into new_id;
   else
    update kitchen.payments set payout_date=day,amount=ledger.amount,date=delivery_day,reference=left(coalesce(data->>'reference',''),250),version=version+1 where id=pay.id; new_id:=pay.id::text;
   end if;
  end if;
 elsif action='transfer_advance' then
  previous_day:=(data->>'from')::date; day:=(data->>'to')::date; amount:=round((data->>'amount')::numeric,2);
  if previous_day is null or day is null or previous_day=day or amount is null or amount<=0 or amount::text in ('NaN','Infinity','-Infinity') then return jsonb_build_object('error','Choose different payout dates and a positive amount','status',400); end if;
  select coalesce(sum(kp.amount),0)-(select coalesce(sum(kd.total),0) from kitchen.deliveries kd where kd.payout_date=previous_day and kd.source='app' and kd.deleted_at is null) into credit from kitchen.payments kp where kp.payout_date=previous_day and kp.deleted_at is null;
  if amount>credit then return jsonb_build_object('error','Transfer exceeds the available advance. Reload the payout.','status',409); end if;
  remaining:=amount;
  for pay in select * from kitchen.payments where payout_date=previous_day and deleted_at is null order by date desc,created_at desc for update loop
   exit when remaining<=0; take:=least(remaining,pay.amount);
   if take=pay.amount then update kitchen.payments set payout_date=day,version=version+1 where id=pay.id;
   else
    update kitchen.payments set amount=payments.amount-take,version=version+1 where id=pay.id;
    insert into kitchen.payments(payout_date,amount,date,reference,actor) values(day,take,pay.date,pay.reference,pay.actor);
   end if;
   remaining:=remaining-take;
  end loop;
 else return jsonb_build_object('error','Unknown ledger action','status',400);
 end if;
 insert into kitchen.audit(actor,action,entity,details) values(who,action,new_id,jsonb_build_object('before',before_row,'input',data,'request_id',request_id));
 insert into kitchen.outbox(event,entity) values(action,coalesce(new_id,day::text,''));
 return jsonb_build_object('ok',true,'id',new_id);
exception when invalid_text_representation or check_violation or not_null_violation or datetime_field_overflow or division_by_zero or numeric_value_out_of_range then
 return jsonb_build_object('error','Invalid values. Check all fields.','status',400);
end $$;
revoke all on function kitchen.ledger_request(text,text,jsonb) from public,anon,authenticated;

-- Patch only the authenticated dispatcher; preserve the current login/session logic.
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('kitchen.request(text,text,text,jsonb)'::regprocedure);
 if position('kitchen.ledger_request(who,action,data)' in definition)=0 then
  definition:=replace(definition, '  if action in (''product'',''archive'',''delivery'',''move_payout'')', E'  if action in (''delivery'',''edit_delivery'',''delete_delivery'',''split_delivery'',''move_payout'',''payment'',''edit_payment'',''delete_payment'',''transfer_advance'') then return kitchen.ledger_request(who,action,data); end if;\n  if action in (''product'',''archive'',''delivery'',''move_payout'')');
 end if;
 definition:=replace(definition,'from kitchen.deliveries dd)', 'from kitchen.deliveries dd where dd.deleted_at is null)');
 definition:=replace(definition,'from kitchen.payments x)', 'from kitchen.payments x where x.deleted_at is null)');
 definition:=replace(definition,'order by x.date desc)', 'order by x.date desc,x.created_at desc)');
 definition:=replace(definition, 'select * into d from kitchen.deliveries where id=data->>''id'' for update;', 'select * into d from kitchen.deliveries where id=data->>''id'' and deleted_at is null for update;');
 definition:=replace(definition, 'set accepted_at=coalesce(accepted_at,now()) where', 'set accepted_at=coalesce(accepted_at,now()),version=version+1 where');
 definition:=replace(definition, 'set crm_at=coalesce(crm_at,now()) where', 'set crm_at=coalesce(crm_at,now()),version=version+1 where');
 definition:=replace(definition, 'set issue=nullif(left(btrim(data->>''issue''),1000),'''')', 'set version=version+1,issue=nullif(left(btrim(data->>''issue''),1000),'''')');
 if position('kitchen.ledger_request(who,action,data)' in definition)=0 or position('dd.deleted_at is null' in definition)=0 then raise exception 'Dispatcher did not match expected shape'; end if;
 execute definition;
end $patch$;
