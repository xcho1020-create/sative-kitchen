-- Execute inside BEGIN / ROLLBACK. Never commits test records or changes credentials.
do $test$
declare
 g text:=encode(extensions.gen_random_bytes(32),'hex'); st text:=encode(extensions.gen_random_bytes(32),'hex'); mt text:=encode(extensions.gen_random_bytes(32),'hex');
 product text:=gen_random_uuid()::text; delivery text; split_id text; payment text; rid text:=gen_random_uuid()::text;
 r jsonb; d jsonb; v integer; payload jsonb; amount_before numeric;
begin
 update kitchen.config set value=to_jsonb(encode(extensions.digest(g,'sha256'),'hex')) where key='gateway_hash';
 insert into kitchen.sessions(token_hash,account,version,expires_at) select encode(extensions.digest(case when name='supplier' then st else mt end,'sha256'),'hex'),name,version,now()+interval '1 hour' from kitchen.accounts;
 insert into kitchen.products(id,name,category,unit,price_quantity,supply_price,cost_price) values(product,'Ledger test product','ready','pcs',1,10,4);
 -- Advance paid first, no deliveries and no manager acceptance required.
 r:=kitchen.request(g,'payment',st,jsonb_build_object('payout_date','2190-01-01','date','2189-12-31','amount',300,'request_id',rid));
 if r->>'ok' is distinct from 'true' then raise exception 'Prepayment failed: %',r; end if; payment:=r->>'id';
 r:=kitchen.request(g,'payment',mt,jsonb_build_object('payout_date','2190-01-01','date','2189-12-31','amount',300,'request_id',rid));
 if (select count(*) from kitchen.payments where request_id=rid)<>1 then raise exception 'Retry duplicated payment'; end if;
 -- A future delivery can be added to a payout that is already paid.
 payload:=jsonb_build_object('date','2190-01-05','payout_date','2190-01-01','request_id',gen_random_uuid(),'items',jsonb_build_array(jsonb_build_object('product_id',product,'quantity',35,'version',1)));
 r:=kitchen.request(g,'delivery',st,payload); delivery:=r->>'id';
 if delivery is null then raise exception 'Future paid-payout delivery failed: %',r; end if;
 r:=kitchen.request(g,'delivery',st,payload);
 if (select count(*) from kitchen.deliveries where request_id=payload->>'request_id')<>1 then raise exception 'Retry duplicated delivery'; end if;
 if (select accepted_at from kitchen.deliveries where id=delivery) is not null then raise exception 'Payment incorrectly accepts delivery'; end if;
 r:=kitchen.request(g,'accept',mt,jsonb_build_object('id',delivery));
 if r->>'ok' is distinct from 'true' then raise exception 'Acceptance failed: %',r; end if;
 r:=kitchen.request(g,'crm',mt,jsonb_build_object('id',delivery));
 -- Manager editing preserves private cost and snapshots, resets operational confirmations.
 select version into v from kitchen.deliveries where id=delivery;
 r:=kitchen.request(g,'edit_delivery',mt,jsonb_build_object('id',delivery,'version',v,'date','2189-12-30','payout_date','2190-01-01','items',jsonb_build_array(jsonb_build_object('index',0,'quantity',25,'supply_price',10,'cost_price',999))));
 if r->>'ok' is distinct from 'true' then raise exception 'Manager historical edit failed: %',r; end if;
 if (select total from kitchen.deliveries where id=delivery)<>250 or (select items->0->>'cost_price' from kitchen.deliveries where id=delivery)<>'4' then raise exception 'Snapshot or edited total incorrect'; end if;
 if exists(select 1 from kitchen.deliveries where id=delivery and (accepted_at is not null or crm_at is not null)) then raise exception 'Changed delivery not queued for review'; end if;
 r:=kitchen.request(g,'edit_delivery',st,jsonb_build_object('id',delivery,'version',v,'date','2189-12-30','payout_date','2190-01-01','items',jsonb_build_array(jsonb_build_object('index',0,'quantity',25))));
 if r->>'status' is distinct from '409' then raise exception 'Stale edit was accepted'; end if;
 -- Transfer a 50 advance, maintaining total received money.
 select sum(amount) into amount_before from kitchen.payments where deleted_at is null;
 r:=kitchen.request(g,'transfer_advance',mt,jsonb_build_object('from','2190-01-01','to','2190-01-08','amount',50,'request_id',gen_random_uuid()));
 if r->>'ok' is distinct from 'true' then raise exception 'Advance transfer failed: %',r; end if;
 if (select sum(amount) from kitchen.payments where deleted_at is null)<>amount_before or (select sum(amount) from kitchen.payments where payout_date='2190-01-08' and deleted_at is null)<>50 then raise exception 'Advance lost or duplicated'; end if;
 r:=kitchen.request(g,'transfer_advance',st,jsonb_build_object('from','2190-01-01','to','2190-01-08','amount',1,'request_id',gen_random_uuid()));
 if r->>'status' is distinct from '409' then raise exception 'Excess advance allowed'; end if;
 -- Split 10 of 25 items, preserving combined totals and costs.
 select version into v from kitchen.deliveries where id=delivery;
 payload:=jsonb_build_object('id',delivery,'version',v,'date','2190-01-09','payout_date','2190-01-08','request_id',gen_random_uuid(),'items',jsonb_build_array(jsonb_build_object('index',0,'quantity',10)));
 r:=kitchen.request(g,'split_delivery',mt,payload); split_id:=r->>'id';
 if split_id is null then raise exception 'Split failed: %',r; end if;
 r:=kitchen.request(g,'split_delivery',mt,payload);
 if (select sum(total) from kitchen.deliveries where id in (delivery,split_id))<>250 then raise exception 'Split changed combined total'; end if;
 -- Reassign a split into a payout with existing money, with no paid-payout blocker.
 select version into v from kitchen.deliveries where id=split_id;
 r:=kitchen.request(g,'move_payout',mt,jsonb_build_object('id',split_id,'version',v,'payout_date','2190-01-01'));
 if r->>'ok' is distinct from 'true' then raise exception 'Paid payout reassignment failed: %',r; end if;
 -- The manager can also record an additional payment before accepting a delivery.
 r:=kitchen.request(g,'payment',mt,jsonb_build_object('payout_date','2190-01-01','date','2190-01-01','amount',10,'request_id',gen_random_uuid()));
 if r->>'ok' is distinct from 'true' then raise exception 'Manager independent payment failed: %',r; end if;
 -- Payment edits and delete are separate from delivery removal.
 select version into v from kitchen.payments where id::text=payment;
 r:=kitchen.request(g,'edit_payment',mt,jsonb_build_object('id',payment,'version',v,'date','2189-12-29','payout_date','2190-01-01','amount',255,'reference','Corrected receipt'));
 if r->>'ok' is distinct from 'true' then raise exception 'Payment edit failed: %',r; end if;
 select version into v from kitchen.deliveries where id=delivery;
 r:=kitchen.request(g,'delete_delivery',st,jsonb_build_object('id',delivery,'version',v));
 if r->>'ok' is distinct from 'true' or (select amount from kitchen.payments where id::text=payment)<>255 then raise exception 'Delete removed or changed payment'; end if;
 r:=kitchen.request(g,'state',mt);
 if exists(select 1 from jsonb_array_elements(r->'deliveries') x where x->>'id'=delivery) then raise exception 'Deleted delivery visible'; end if;
 if exists(select 1 from jsonb_array_elements(r->'products') x where x ? 'cost_price') or exists(select 1 from jsonb_array_elements(r->'deliveries') x cross join jsonb_array_elements(x->'items') y where y ? 'cost_price') then raise exception 'Manager private costs exposed'; end if;
 select version into v from kitchen.payments where id::text=payment;
 r:=kitchen.request(g,'delete_payment',st,jsonb_build_object('id',payment,'version',v));
 if r->>'ok' is distinct from 'true' then raise exception 'Payment delete failed: %',r; end if;
 r:=kitchen.request(g,'state',st);
 if exists(select 1 from jsonb_array_elements(r->'payments') x where x->>'id'=payment) then raise exception 'Deleted payment visible'; end if;
 if not exists(select 1 from kitchen.audit where entity=delivery and action='delete_delivery' and details->'before'->>'id'=delivery) then raise exception 'Recovery snapshot missing'; end if;
 r:=kitchen.request(g,'delete_delivery','invalid',jsonb_build_object('id',split_id,'version',1));
 if r->>'status' is distinct from '401' then raise exception 'Unauthenticated edit allowed'; end if;
end $test$;
