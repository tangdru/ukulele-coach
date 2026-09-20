// Supabase connection settings for Baritone Uke Coach.
//
// Setup:
//   1. Create a free project at https://supabase.com
//   2. Open the SQL Editor and create a `uke_songs` table:
//        create table public.uke_songs (
//          id uuid primary key default gen_random_uuid(),
//          title text not null unique,
//          text text not null,
//          updated_at timestamptz not null default now()
//        );
//        alter table public.uke_songs enable row level security;
//        create policy "Allow public read" on public.uke_songs
//          for select to public using (true);
//        create policy "Allow public insert" on public.uke_songs
//          for insert to public with check (true);
//        create policy "Allow public update" on public.uke_songs
//          for update to public using (true) with check (true);
//        create policy "Allow public delete" on public.uke_songs
//          for delete to public using (true);
//   3. Also create a `uke_sessions` table (Analyze Me practice history):
//        create table public.uke_sessions (
//          id uuid primary key default gen_random_uuid(),
//          song_title text not null,
//          created_at timestamptz not null default now(),
//          count integer not null default 0,
//          on_time_pct numeric not null default 0,
//          avg_abs_ms numeric not null default 0,
//          grade text not null default '—',
//          lines jsonb not null default '[]'::jsonb
//        );
//        alter table public.uke_sessions enable row level security;
//        create policy "Allow public read" on public.uke_sessions
//          for select to public using (true);
//        create policy "Allow public insert" on public.uke_sessions
//          for insert to public with check (true);
//   4. Go to Project Settings > API and copy the "Project URL" and the
//      publishable/anon key
//   5. Paste them below and commit/push this file
//
// The anon/publishable key is meant to be public — it's safe to ship in
// client-side code. Access control comes from the Row Level Security
// policies above, not from keeping this key secret.
//
// Leaving these blank runs the app in local-only mode (saves to this
// browser's localStorage instead of the shared database) -- see
// js/songlibrary.js and js/sessionhistory.js.
window.SUPABASE_CONFIG = {
  url: 'https://fjzrodjqysdaarfmxvqv.supabase.co',
  anonKey: 'sb_publishable_FjN9VX-smcBQWXRDUKzeMg_-1MERpdi',
};
