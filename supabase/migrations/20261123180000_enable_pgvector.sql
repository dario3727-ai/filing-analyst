-- Enable pgvector so Postgres can store and search embeddings.
-- Milestone 3 adds chunks.embedding vector(1024) (Voyage voyage-4) and a
-- similarity search over it.
--
-- Supabase recommends installing extensions in the "extensions" schema rather
-- than "public"; the "vector" type is still usable everywhere because
-- "extensions" is on Supabase's default search path.
create extension if not exists vector with schema extensions;
