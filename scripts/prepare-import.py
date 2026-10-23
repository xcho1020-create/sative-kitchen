"""Create an idempotent import from verified live Sheets reads; never touch source sheets."""
import json,datetime,decimal,pathlib,hashlib
D=decimal.Decimal
root=pathlib.Path(__file__).resolve().parent.parent
src=json.loads((root/'.migration/source-live.json').read_text())
def sql(s):return "'"+str(s).replace("'","''")+"'"
def j(v):return sql(json.dumps(v,ensure_ascii=False,separators=(',',':')))+'::jsonb'
def ident(v):return str(int(v)) if isinstance(v,(int,float)) and int(v)==v else str(v)
def day(v):
 if isinstance(v,(int,float)):return (datetime.datetime(1899,12,30)+datetime.timedelta(days=v)).date().isoformat()
 return str(v)[:10]
def unit(v):
 v=str(v).lower()
 if v in ('100g','100 g'):return 'g',100
 if v in ('100ml','100 ml'):return 'ml',100
 if v in ('kg','кг'):return 'g',1000
 if v in ('l','литр'):return 'ml',1000
 return 'pcs',1
products=src['kitchen']['products']['values'][1:]
lookup={ident(r[0]):r for r in products}
chunks=[];issues=[];group={};count=0
for r in src['kitchen']['delivery_items']['values'][1:]:
 if not r or r[0] is None:continue
 group.setdefault(ident(r[1]),[]).append(r)
for r in products:
 u,n=unit(r[4]);chunks.append(f"insert into kitchen.products(id,name,category,unit,price_quantity,supply_price,cost_price,active,created_at) values({sql(ident(r[0]))},{sql(r[1])},{sql(r[5])},{sql(u)},{n},{r[3]},{'null' if r[2] is None else r[2]},{str(r[6]).lower()},{sql(day(r[7]))}::date) on conflict(id) do nothing;")
for r in src['kitchen']['deliveries']['values'][1:]:
 if not r or r[0] is None:continue
 ds=[]
 for i in group.get(ident(r[0]),[]):
  p=lookup.get(ident(i[2]));u,n=unit(p[4] if p else 'pcs')
  ds.append(dict(source_item_id=ident(i[0]),product_id=ident(i[2]),name=p[1] if p else 'Archived product '+ident(i[2]),category=p[5] if p else 'ready',unit=u,price_quantity=n,quantity=float(D(str(i[3]))*n),supply_price=i[5],cost_price=i[4] if isinstance(i[4],(int,float)) else None,line_total=round(i[7],2)))
 total=sum(D(str(i['line_total'])) for i in ds).quantize(D('.01'))
 note=None
 if not isinstance(r[4],(int,float)):
  note='Original total_cost is text; cost totals remain available from item records.'
  issues.append(dict(source='sative kitchen',reference=ident(r[0]),kind='invalid_legacy_total_cost',details={'original':r[4]}))
 if r[3]=='unpaid':
  note='Legacy unpaid flag requires reconciliation before carrying into a new payout.'
  issues.append(dict(source='sative kitchen',reference=ident(r[0]),kind='legacy_unpaid',details={'amount':float(total),'date':day(r[1])}))
 chunks.append(f"insert into kitchen.deliveries(id,date,payout_date,items,total,source,legacy_payment_status,review_note,created_at) values({sql(ident(r[0]))},{sql(day(r[1]))},{sql(day(r[1]))},{j(ds)},{total},'legacy',{sql(r[3])},{sql(note) if note else 'null'},{sql(day(r[1]))}::date) on conflict(id) do nothing;")
 count+=1
for issue in issues:
 chunks.append(f"insert into kitchen.reconciliation(source,reference,kind,details) select {sql(issue['source'])},{sql(issue['reference'])},{sql(issue['kind'])},{j(issue['details'])} where not exists(select 1 from kitchen.reconciliation where reference={sql(issue['reference'])} and kind={sql(issue['kind'])});")
for source in ('kitchen','procurement'):
 for tab,content in src[source].items():
  # Full source cells retained independently, never imported twice as financial movements.
  chunks.append(f"insert into kitchen.source_archive(id,source,tab,content,captured_at) values({sql(source+':'+tab)},{sql(source)},{sql(tab)},{j(content)},{sql(src['captured_at'])}) on conflict(id) do nothing;")
chunks.append(f"insert into kitchen.config values('source_captured_at',{j(src['captured_at'])}),('stage','\"parallel_review\"'::jsonb) on conflict(key) do nothing;")
output=root/'.migration/chunks';output.mkdir(exist_ok=True)
files=[];batch='';index=0
for stmt in chunks:
 if len(batch)+len(stmt)>22000 and batch:
  path=output/f'{index:03}.sql';path.write_text(batch);files.append(path.name);batch='';index+=1
 batch+=stmt+'\n'
if batch:
 path=output/f'{index:03}.sql';path.write_text(batch);files.append(path.name)
summary={'products':len(products),'deliveries':count,'items':sum(len(x) for x in group.values()),'source_tabs':sum(len(src[s]) for s in ('kitchen','procurement')),'legacy_unpaid':sum(i['details']['amount'] for i in issues if i['kind']=='legacy_unpaid'),'issues':len(issues),'chunks':files,'source_sha256':hashlib.sha256((root/'.migration/source-live.json').read_bytes()).hexdigest()}
(root/'.migration/summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps({k:v for k,v in summary.items() if k!='chunks'}))
