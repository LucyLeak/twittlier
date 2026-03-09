-- Twittlier base schema (Supabase)

create extension if not exists pgcrypto;

create table if not exists public.accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  handle text not null,
  youtube_account text,
  profile_photo_url text,
  is_moderator boolean not null default false,
  email_verified_optional boolean not null default false,
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_handle_format check (
    handle ~ '^[a-z0-9_]{3,24}$'
  ),
  constraint accounts_photo_url_format check (
    profile_photo_url is null or profile_photo_url ~* '^https?://'
  )
);

alter table if exists public.accounts
add column if not exists email_verified_optional boolean not null default false;

alter table if exists public.accounts
add column if not exists email_verified_at timestamptz;

alter table if exists public.accounts
add column if not exists is_moderator boolean not null default false;

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

create table if not exists public.follows (
  follower_user_id uuid not null references public.accounts(user_id) on delete cascade,
  following_user_id uuid not null references public.accounts(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_user_id, following_user_id),
  constraint follows_not_self check (follower_user_id <> following_user_id)
);

create table if not exists public.blocks (
  blocker_user_id uuid not null references public.accounts(user_id) on delete cascade,
  blocked_user_id uuid not null references public.accounts(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint blocks_not_self check (blocker_user_id <> blocked_user_id)
);

alter table if exists public.posts drop constraint if exists posts_user_id_fkey;
alter table if exists public.posts
add constraint posts_user_id_fkey
foreign key (user_id) references public.accounts(user_id) on delete cascade;

create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists follows_following_user_idx on public.follows(following_user_id);
create index if not exists blocks_blocked_user_idx on public.blocks(blocked_user_id);

alter table public.accounts enable row level security;
alter table public.posts enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;

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

drop policy if exists "accounts_update_by_moderator" on public.accounts;
create policy "accounts_update_by_moderator"
on public.accounts
for update
to authenticated
using (
  exists (
    select 1
    from public.accounts me
    where me.user_id = auth.uid()
      and me.is_moderator = true
  )
)
with check (true);

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

drop policy if exists "posts_delete_moderator" on public.posts;
create policy "posts_delete_moderator"
on public.posts
for delete
to authenticated
using (
  exists (
    select 1
    from public.accounts me
    where me.user_id = auth.uid()
      and me.is_moderator = true
  )
);

drop policy if exists "follows_select_authenticated" on public.follows;
create policy "follows_select_authenticated"
on public.follows
for select
to authenticated
using (true);

drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
on public.follows
for insert
to authenticated
with check (
  auth.uid() = follower_user_id
  and follower_user_id <> following_user_id
  and not exists (
    select 1
    from public.blocks b
    where
      (b.blocker_user_id = follower_user_id and b.blocked_user_id = following_user_id)
      or (b.blocker_user_id = following_user_id and b.blocked_user_id = follower_user_id)
  )
);

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own"
on public.follows
for delete
to authenticated
using (auth.uid() = follower_user_id);

drop policy if exists "blocks_select_authenticated" on public.blocks;
create policy "blocks_select_authenticated"
on public.blocks
for select
to authenticated
using (true);

drop policy if exists "blocks_insert_own" on public.blocks;
create policy "blocks_insert_own"
on public.blocks
for insert
to authenticated
with check (
  auth.uid() = blocker_user_id
  and blocker_user_id <> blocked_user_id
);

drop policy if exists "blocks_delete_own" on public.blocks;
create policy "blocks_delete_own"
on public.blocks
for delete
to authenticated
using (auth.uid() = blocker_user_id);

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('profile-media', 'profile-media', true)
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

drop policy if exists "profile_media_read_authenticated" on storage.objects;
create policy "profile_media_read_authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'profile-media');

drop policy if exists "profile_media_insert_own_folder" on storage.objects;
create policy "profile_media_insert_own_folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "profile_media_update_own_folder" on storage.objects;
create policy "profile_media_update_own_folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "profile_media_delete_own_folder" on storage.objects;
create policy "profile_media_delete_own_folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);
