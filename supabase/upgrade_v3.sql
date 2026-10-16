-- v3: ตั้งค่าการแจ้งเตือนอีเมล (เก็บค่าตั้งค่าผู้รับและเหตุการณ์)
create table if not exists notification_settings(id int primary key default 1 check(id=1), emails text default '', on_low_stock boolean default true,
  on_new_request boolean default true, on_cod_mismatch boolean default true, updated_at timestamptz default now());
insert into notification_settings(id) values(1) on conflict do nothing;
alter table notification_settings enable row level security;
drop policy if exists n_admin on notification_settings;
create policy n_admin on notification_settings for all to authenticated using(my_role()='admin') with check(my_role()='admin');
