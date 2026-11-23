-- Storage bucket for raw 10-K HTML downloaded from SEC EDGAR.
-- Path convention: {ticker}/{fiscal_year}.htm (see docs/database-schema.md).
--
-- Private (public = false) and no access policies are added, so only server
-- code and scripts using the service-role key can read or write it. Browsers
-- with the anon key can't list or download files.
--
-- 50 MB per file: large 10-Ks with inline XBRL can run to tens of MB, and
-- 50 MB is the Supabase free plan's per-file maximum.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('raw-filings', 'raw-filings', false, 52428800, array['text/html'])
on conflict (id) do nothing;
