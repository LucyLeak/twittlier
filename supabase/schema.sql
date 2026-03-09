-- Twittlier base schema (Supabase)

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  constraint username_format check (
    username ~ '^[a-z0-9_]{3,24}$'
  )
);

alter table public.profiles drop constraint if exists profiles_username_key;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text,
  media_url text,
  media_type text,
  created_at timestamptz not null default now(),
  constraint media_type_valid check (
    media_type in ('image', 'video', 'gif') or media_type is null
  ),
  constraint content_or_media check (
    (content is not null and length(trim(content)) > 0) or media_url is not null
  )
);

create index if not exists posts_created_at_idx on public.posts(created_at desc);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "posts_select_authenticated" on public.posts;
create policy "posts_select_authenticated"
on public.posts
for select
to authenticated
using (true);

drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own"
on public.posts
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own"
on public.posts
for delete
to authenticated
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

drop policy if exists "post_media_read_authenticated" on storage.objects;
create policy "post_media_read_authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'post-media');

drop policy if exists "post_media_insert_own_folder" on storage.objects;
create policy "post_media_insert_own_folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "post_media_delete_own_folder" on storage.objects;
create policy "post_media_delete_own_folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);
