-- Twittlier base schema (Supabase)

create extension if not exists pgcrypto;

create table if not exists public.accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  handle text not null,
  youtube_account text,
  profile_photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_handle_format check (
    handle ~ '^[a-z0-9_]{3,24}$'
  ),
  constraint accounts_photo_url_format check (
    profile_photo_url is null or profile_photo_url ~* '^https?://'
  )
);

create unique index if not exists accounts_handle_unique_idx on public.accounts(handle);

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
before update on public.accounts
for each row
execute function public.update_updated_at_column();

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.accounts(user_id) on delete cascade,
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

alter table if exists public.posts drop constraint if exists posts_user_id_fkey;
alter table if exists public.posts
add constraint posts_user_id_fkey
foreign key (user_id) references public.accounts(user_id) on delete cascade;

create index if not exists posts_created_at_idx on public.posts(created_at desc);

alter table public.accounts enable row level security;
alter table public.posts enable row level security;

drop policy if exists "accounts_select_authenticated" on public.accounts;
create policy "accounts_select_authenticated"
on public.accounts
for select
to authenticated
using (true);

drop policy if exists "accounts_insert_own" on public.accounts;
create policy "accounts_insert_own"
on public.accounts
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "accounts_update_own" on public.accounts;
create policy "accounts_update_own"
on public.accounts
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
