-- v5: ข้อมูลผู้ใช้เพิ่มเติม (รหัสพนักงาน, แผนก)
alter table profiles add column if not exists employee_code text;
alter table profiles add column if not exists department text;
