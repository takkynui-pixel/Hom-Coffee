-- อัปเกรด v2: หลายคลัง · หมวดสินค้า · ใบคำขอเบิก · โอนสต็อก · view สำหรับ Dashboard
-- รันต่อจาก schema.sql (ถ้า error ตรง ALTER TYPE ให้รัน 4 บรรทัดแรกแยกก่อน แล้วรันที่เหลืออีกครั้ง)
alter type move_type add value if not exists 'issue_request';
alter type move_type add value if not exists 'issue_manual';
alter type move_type add value if not exists 'transfer_out';
alter type move_type add value if not exists 'transfer_in';

create table if not exists warehouses(id uuid primary key default gen_random_uuid(), name text not null, is_main boolean default false, active boolean default true);
insert into warehouses(name,is_main) select * from (values('ลำพูน (คลังหลัก)',true),('พิษณุโลก',false),('บางพลี',false)) v where not exists(select 1 from warehouses);
create table if not exists categories(id uuid primary key default gen_random_uuid(), name text unique not null);
insert into categories(name) values('เครื่องดื่ม'),('ดูแลสุขภาพและความงาม'),('อาหาร'),('อุปกรณ์') on conflict do nothing;
alter table products add column if not exists category_id uuid references categories;
update products set category_id=(select id from categories where name=case when sku in('P001','P002','P010') then 'เครื่องดื่ม' when sku='P005' then 'อาหาร' when sku='P006' then 'อุปกรณ์' else 'ดูแลสุขภาพและความงาม' end) where category_id is null;
alter table stock_movements add column if not exists warehouse_id uuid references warehouses;
update stock_movements set warehouse_id=(select id from warehouses where is_main limit 1) where warehouse_id is null;
alter table stock_counts add column if not exists warehouse_id uuid references warehouses;

-- ตั้งคลังเริ่มต้น + กันสต็อกติดลบเมื่อเบิก/ขาย/โอนออก
create or replace function fn_mv_before() returns trigger language plpgsql set search_path=public as $$
declare bal int; begin
  if new.warehouse_id is null then select id into new.warehouse_id from warehouses where is_main limit 1; end if;
  if new.qty<0 and new.move_type::text in('issue_sale','issue_free','issue_request','issue_manual','transfer_out') then
    select coalesce(sum(qty),0) into bal from stock_movements where product_id=new.product_id and warehouse_id=new.warehouse_id;
    if bal+new.qty<0 then raise exception 'สต็อกไม่พอ (คงเหลือ % ชิ้น)',bal; end if;
  end if; return new; end $$;
drop trigger if exists t_wh_default on stock_movements;
drop trigger if exists t_mv_before on stock_movements;
create trigger t_mv_before before insert on stock_movements for each row execute function fn_mv_before();

create or replace view v_stock_wh with (security_invoker=true) as select warehouse_id,product_id,sum(qty)::int balance from stock_movements group by 1,2;
create or replace view v_issued_daily with (security_invoker=true) as select (created_at at time zone 'Asia/Bangkok')::date::text as day,sum(-qty)::int qty from stock_movements where move_type::text in('issue_sale','issue_free','issue_request','issue_manual') group by 1;
create or replace view v_issued_monthly with (security_invoker=true) as select to_char(created_at at time zone 'Asia/Bangkok','YYYY-MM') as month,sum(-qty)::int qty from stock_movements where move_type::text in('issue_sale','issue_free','issue_request','issue_manual') group by 1;
create or replace view v_sales_month with (security_invoker=true) as select to_char(order_date,'YYYY-MM') as month,count(*)::int orders,coalesce(sum(net_total),0) total from orders where order_status='confirmed' group by 1;

create sequence if not exists req_seq;
create table if not exists stock_requests(id uuid primary key default gen_random_uuid(), doc_no text unique default ('RQ'||to_char(now(),'YYMM')||lpad(nextval('req_seq')::text,4,'0')),
  requested_by uuid references profiles default auth.uid(), warehouse_id uuid references warehouses, note text,
  status text not null default 'pending' check(status in('pending','issued','rejected')), decided_by uuid, decided_at timestamptz, created_at timestamptz default now());
create table if not exists stock_request_items(id uuid primary key default gen_random_uuid(), request_id uuid references stock_requests on delete cascade, product_id uuid references products, qty int check(qty>0));

create or replace function create_request(p_wh uuid,p_note text,p_items jsonb) returns text language plpgsql security definer set search_path=public as $$
declare rid uuid; dno text; begin
  insert into stock_requests(warehouse_id,note,requested_by) values(p_wh,p_note,auth.uid()) returning id,doc_no into rid,dno;
  insert into stock_request_items(request_id,product_id,qty) select rid,(i->>'product_id')::uuid,(i->>'qty')::int from jsonb_array_elements(p_items) i;
  return dno; end $$;
create or replace function decide_request(p_id uuid,p_approve boolean) returns void language plpgsql security definer set search_path=public as $$
declare r stock_requests; it record; begin
  if my_role() not in('admin','warehouse') then raise exception 'ไม่มีสิทธิ์อนุมัติ'; end if;
  select * into r from stock_requests where id=p_id for update;
  if r.status<>'pending' then raise exception 'ใบคำขอนี้ดำเนินการแล้ว'; end if;
  if p_approve then
    for it in select * from stock_request_items where request_id=p_id loop
      insert into stock_movements(doc_no,product_id,qty,move_type,warehouse_id,approved_by) values(r.doc_no,it.product_id,-it.qty,'issue_request',r.warehouse_id,auth.uid());
    end loop;
  end if;
  update stock_requests set status=case when p_approve then 'issued' else 'rejected' end,decided_by=auth.uid(),decided_at=now() where id=p_id; end $$;
create or replace function transfer_stock(p_product uuid,p_from uuid,p_to uuid,p_qty int,p_note text) returns void language plpgsql security definer set search_path=public as $$
declare d text:='TR'||to_char(now(),'YYMMDDHH24MISS'); begin
  if my_role() not in('admin','warehouse') then raise exception 'ไม่มีสิทธิ์โอนสต็อก'; end if;
  if p_from=p_to then raise exception 'เลือกคลังต้นทางและปลายทางต่างกัน'; end if;
  insert into stock_movements(doc_no,product_id,qty,move_type,warehouse_id,note,approved_by) values(d,p_product,-p_qty,'transfer_out',p_from,p_note,auth.uid());
  insert into stock_movements(doc_no,product_id,qty,move_type,warehouse_id,note,approved_by) values(d,p_product,p_qty,'transfer_in',p_to,p_note,auth.uid()); end $$;

do $$ declare t text; begin foreach t in array array['warehouses','categories','stock_requests','stock_request_items'] loop
  execute format('alter table %I enable row level security',t);
  execute format('drop policy if exists r_%1$s on %1$I',t);
  execute format('create policy r_%1$s on %1$I for select to authenticated using(true)',t); end loop; end $$;
drop policy if exists w_wh on warehouses; create policy w_wh on warehouses for all to authenticated using(my_role()='admin') with check(my_role()='admin');
drop policy if exists w_cat on categories; create policy w_cat on categories for all to authenticated using(my_role()='admin') with check(my_role()='admin');
drop policy if exists w_prod2 on products; create policy w_prod2 on products for all to authenticated using(my_role()='warehouse') with check(my_role()='warehouse');
drop policy if exists w_stock2 on stock_movements; create policy w_stock2 on stock_movements for insert to authenticated with check(my_role()='warehouse');
