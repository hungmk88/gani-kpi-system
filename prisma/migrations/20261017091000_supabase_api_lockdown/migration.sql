-- Khoá Supabase Data API (PostgREST) khỏi các bảng của ứng dụng.
--
-- Ứng dụng chỉ truy cập database qua Prisma bằng role chủ bảng (postgres),
-- KHÔNG dùng supabase-js. Nhưng Supabase mặc định cấp quyền trên schema
-- public cho role `anon` và `authenticated` — ai có URL project + anon key là
-- đọc/ghi thẳng được bảng users (kể cả passwordHash) qua /rest/v1.
--
-- Thu hồi mọi quyền của hai role đó, kể cả trên bảng tạo sau này. Chỉ chạy
-- khi hai role tồn tại (database Supabase); Postgres thường (máy dev, CI)
-- không có hai role này nên bỏ qua. Không ảnh hưởng Prisma.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated';
    RAISE NOTICE 'Đã thu hồi quyền của anon/authenticated trên schema public.';
  ELSE
    RAISE NOTICE 'Không có role anon/authenticated (không phải Supabase) — bỏ qua.';
  END IF;
END $$;
