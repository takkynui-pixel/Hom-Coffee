-- v4: รูปสินค้า (คอลัมน์ + Storage bucket + สิทธิ์)
alter table products add column if not exists image_path text;
insert into storage.buckets(id,name,public) values('product-images','product-images',true) on conflict (id) do nothing;
drop policy if exists pi_read on storage.objects; drop policy if exists pi_ins on storage.objects; drop policy if exists pi_upd on storage.objects; drop policy if exists pi_del on storage.objects;
create policy pi_read on storage.objects for select using (bucket_id='product-images');
create policy pi_ins on storage.objects for insert to authenticated with check (bucket_id='product-images' and public.my_role() in('admin','warehouse'));
create policy pi_upd on storage.objects for update to authenticated using (bucket_id='product-images' and public.my_role() in('admin','warehouse'));
create policy pi_del on storage.objects for delete to authenticated using (bucket_id='product-images' and public.my_role() in('admin','warehouse'));
