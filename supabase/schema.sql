-- รันทั้งไฟล์ใน Supabase > SQL Editor
create extension if not exists pgcrypto;
create type user_role as enum ('admin','sales','warehouse','packer','accounting','executive');
create type move_type as enum ('receive','issue_sale','issue_free','adjust','count_adjust','cancel_return');

create table profiles(id uuid primary key references auth.users on delete cascade, full_name text, email text, role user_role not null default 'sales', active boolean not null default true);
create table products(id uuid primary key default gen_random_uuid(), sku text unique not null, name text not null,
  sell_unit text default 'ชิ้น', stock_unit text default 'ชิ้น', units_per_case int not null default 1,
  cost numeric(12,2) default 0, std_price numeric(12,2) default 0, agent_price numeric(12,2) default 90, retail_price numeric(12,2) default 145,
  reorder_point int default 0, active boolean default true);
create table customers(id uuid primary key default gen_random_uuid(), name text not null, phone text, house_no text, village text, road text,
  subdistrict text, district text, province text, postcode text, created_at timestamptz default now());
create sequence order_seq;
create table orders(id uuid primary key default gen_random_uuid(),
  order_no text unique not null default ('OD'||to_char(now(),'YYMM')||lpad(nextval('order_seq')::text,5,'0')),
  order_date date default current_date, seller uuid references profiles, customer_id uuid references customers,
  items_total numeric(12,2) default 0, discount numeric(12,2) default 0, shipping_fee numeric(12,2) default 0, net_total numeric(12,2) default 0,
  order_status text not null default 'draft' check(order_status in('draft','confirmed','cancelled')),
  ship_status text not null default 'pending' check(ship_status in('pending','packed','shipped','delivered','returned')),
  pay_status text not null default 'unpaid' check(pay_status in('unpaid','cod_pending','paid','mismatch')),
  pay_method text default 'cod', created_at timestamptz default now());
create table order_items(id uuid primary key default gen_random_uuid(), order_id uuid references orders on delete cascade,
  product_id uuid references products, qty int not null check(qty>=0), free_qty int not null default 0 check(free_qty>=0),
  unit_price numeric(12,2) not null, unit_cost numeric(12,2) not null);
create table shipments(id uuid primary key default gen_random_uuid(), order_id uuid references orders, carrier text, tracking_no text unique, shipped_at date, status text, history jsonb default '[]');
create table payments(id uuid primary key default gen_random_uuid(), order_id uuid references orders, method text, expected numeric(12,2), received numeric(12,2), received_at date, reconciled boolean default false);
create table stock_movements(id uuid primary key default gen_random_uuid(), doc_no text, product_id uuid references products not null,
  qty int not null, move_type move_type not null, ref_order uuid references orders, note text,
  created_by uuid default auth.uid(), approved_by uuid, created_at timestamptz default now());
create unique index uq_order_move on stock_movements(ref_order,product_id,move_type) where ref_order is not null;
create table stock_counts(id uuid primary key default gen_random_uuid(), count_date date default current_date, product_id uuid references products,
  system_qty int, counted_qty int, diff int generated always as (counted_qty-system_qty) stored, created_by uuid default auth.uid());
create table purchase_orders(id uuid primary key default gen_random_uuid(), po_no text unique, supplier text, supplier_address text, order_date date default current_date, due_date date, vat_rate numeric default 7, note text, status text default 'open');
create table po_items(id uuid primary key default gen_random_uuid(), po_id uuid references purchase_orders on delete cascade, product_id uuid references products, description text, qty int, unit_price numeric(12,2), received_qty int default 0);
create table expenses(id uuid primary key default gen_random_uuid(), category text, amount numeric(12,2), spent_at date default current_date, order_id uuid references orders);
create table audit_logs(id bigserial primary key, tbl text, row_id text, action text, old_data jsonb, new_data jsonb, by_user uuid default auth.uid(), at timestamptz default now());

create view v_stock with (security_invoker=true) as select p.id product_id,p.sku,p.name,p.units_per_case,p.reorder_point,coalesce(sum(m.qty),0)::int balance,
  case when coalesce(sum(m.qty),0)<=0 then 'out' when coalesce(sum(m.qty),0)<=p.reorder_point then 'low' else 'ok' end status
  from products p left join stock_movements m on m.product_id=p.id where p.active group by p.id;

create function fn_order_stock() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.order_status='confirmed' and old.order_status='draft' then
    insert into stock_movements(doc_no,product_id,qty,move_type,ref_order) select new.order_no,product_id,-sum(qty),'issue_sale',new.id from order_items where order_id=new.id group by product_id having sum(qty)>0 on conflict do nothing;
    insert into stock_movements(doc_no,product_id,qty,move_type,ref_order) select new.order_no,product_id,-sum(free_qty),'issue_free',new.id from order_items where order_id=new.id group by product_id having sum(free_qty)>0 on conflict do nothing;
  elsif new.order_status='cancelled' and old.order_status='confirmed' then
    insert into stock_movements(doc_no,product_id,qty,move_type,ref_order) select new.order_no,product_id,sum(qty+free_qty),'cancel_return',new.id from order_items where order_id=new.id group by product_id on conflict do nothing;
  end if; return new; end $$;
create trigger t_order_stock after update of order_status on orders for each row execute function fn_order_stock();

create function fn_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into audit_logs(tbl,row_id,action,old_data,new_data) values(tg_table_name,coalesce((to_jsonb(new)->>'id'),(to_jsonb(old)->>'id')),tg_op,
  case when tg_op<>'INSERT' then to_jsonb(old) end, case when tg_op<>'DELETE' then to_jsonb(new) end); return coalesce(new,old); end $$;
create trigger a1 after insert or update or delete on orders for each row execute function fn_audit();
create trigger a2 after insert or update or delete on stock_movements for each row execute function fn_audit();
create trigger a3 after insert or update or delete on payments for each row execute function fn_audit();
create trigger a4 after insert or update or delete on products for each row execute function fn_audit();

create function create_order(p_customer jsonb,p_items jsonb,p_discount numeric,p_ship numeric,p_confirm boolean) returns text
language plpgsql security definer set search_path=public as $$
declare cid uuid; oid uuid; ono text; tot numeric; begin
  insert into customers(name,phone,house_no,village,road,subdistrict,district,province,postcode)
  values(p_customer->>'name',p_customer->>'phone',p_customer->>'house_no',p_customer->>'village',p_customer->>'road',p_customer->>'subdistrict',p_customer->>'district',p_customer->>'province',p_customer->>'postcode') returning id into cid;
  insert into orders(seller,customer_id,discount,shipping_fee) values(auth.uid(),cid,p_discount,p_ship) returning id,order_no into oid,ono;
  insert into order_items(order_id,product_id,qty,free_qty,unit_price,unit_cost)
    select oid,(i->>'product_id')::uuid,(i->>'qty')::int,coalesce((i->>'free_qty')::int,0),(i->>'unit_price')::numeric,p.cost
    from jsonb_array_elements(p_items) i join products p on p.id=(i->>'product_id')::uuid;
  select sum(qty*unit_price) into tot from order_items where order_id=oid;
  update orders set items_total=tot,net_total=tot-p_discount+p_ship,pay_status='cod_pending' where id=oid;
  if p_confirm then update orders set order_status='confirmed' where id=oid; end if;
  return ono; end $$;

create function my_role() returns user_role language sql stable security definer set search_path=public as $$ select role from profiles where id=auth.uid() $$;
do $$ declare t text; begin foreach t in array array['profiles','products','customers','orders','order_items','shipments','payments','stock_movements','stock_counts','purchase_orders','po_items','expenses','audit_logs'] loop
  execute format('alter table %I enable row level security',t);
  execute format('create policy r_%1$s on %1$I for select to authenticated using(true)',t);
  execute format('create policy w_%1$s on %1$I for all to authenticated using(my_role()=''admin'') with check(my_role()=''admin'')',t); end loop; end $$;
create policy w_orders2 on orders for all to authenticated using(my_role() in('sales','packer')) with check(my_role() in('sales','packer'));
create policy w_items2 on order_items for all to authenticated using(my_role()='sales') with check(my_role()='sales');
create policy w_stock2 on stock_movements for insert to authenticated with check(my_role()='warehouse');
create policy w_count2 on stock_counts for all to authenticated using(my_role()='warehouse') with check(my_role()='warehouse');
create policy w_pay2 on payments for all to authenticated using(my_role()='accounting') with check(my_role()='accounting');
create policy w_ship2 on shipments for all to authenticated using(my_role() in('packer','sales')) with check(my_role() in('packer','sales'));
create policy w_po2 on purchase_orders for all to authenticated using(my_role()='accounting') with check(my_role()='accounting');
create policy w_poi2 on po_items for all to authenticated using(my_role()='accounting') with check(my_role()='accounting');
create policy w_exp2 on expenses for all to authenticated using(my_role()='accounting') with check(my_role()='accounting');
create or replace function public.fn_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id,full_name,email) values(new.id,split_part(new.email,'@',1),new.email); return new; end $$;
drop trigger if exists on_signup on auth.users;
create trigger on_signup after insert on auth.users for each row execute function public.fn_new_user();

insert into products(sku,name,units_per_case,sell_unit) values
('P001','กาแฟ',48,'กล่อง'),('P002','เทียนหลง',12,'ขวด'),('P003','DLC',60,'กล่อง'),('P004','ยานวด',200,'ขวด'),('P005','ซุป',500,'ชิ้น'),
('P006','วิทยุ',30,'กล่อง'),('P007','สบู่ขาย',120,'ก้อน'),('P008','สบู่แถม',60,'ก้อน'),('P009','มาร์คอฟแถม',48,'กล่อง'),('P010','โกโก้',36,'กล่อง');

-- ยอดขายรายวัน/เดือน สำหรับกราฟ Dashboard (นับเฉพาะออเดอร์ที่ยืนยัน)
create view v_sales_month with (security_invoker=true) as select to_char(order_date,'YYYY-MM') as month,count(*)::int orders,coalesce(sum(net_total),0) total
  from orders where order_status='confirmed' group by 1;
-- สร้างผู้ใช้แรก: สมัครผ่าน Supabase > Authentication > Add user แล้วรัน
-- update profiles set role='admin' where email='อีเมลของคุณ';
