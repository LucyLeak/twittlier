-- Twittlier base schema (Supabase)

create extension if not exists pgcrypto;

create table if not exists public.accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  handle text not null,
  youtube_account text,
  profile_photo_url text,
  theme_preference text not null default 'light',
  notifications_enabled boolean not null default true,
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
  ),
  constraint accounts_theme_preference_valid check (
    theme_preference in ('light', 'dark')
  )
);

alter table if exists public.accounts
add column if not exists youtube_account text;

alter table if exists public.accounts
add column if not exists profile_photo_url text;

alter table if exists public.accounts
add column if not exists theme_preference text not null default 'light';

alter table if exists public.accounts
add column if not exists notifications_enabled boolean not null default true;

alter table if exists public.accounts
add column if not exists created_at timestamptz not null default now();

alter table if exists public.accounts
add column if not exists updated_at timestamptz not null default now();

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
  parent_post_id uuid references public.posts(id) on delete cascade,
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

alter table if exists public.posts
add column if not exists parent_post_id uuid;

alter table if exists public.posts
add column if not exists content text;

alter table if exists public.posts
add column if not exists media_url text;

alter table if exists public.posts
add column if not exists media_type text;

alter table if exists public.posts
add column if not exists created_at timestamptz not null default now();

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

create table if not exists public.live_messages (
  id uuid primary key default gen_random_uuid(),
  room_owner_user_id uuid not null references public.accounts(user_id) on delete cascade,
  author_user_id uuid not null references public.accounts(user_id) on delete cascade,
  content text,
  media_url text,
  media_type text,
  moderation_status text not null default 'approved',
  moderation_reason text,
  moderated_by_user_id uuid references public.accounts(user_id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint live_messages_media_type_valid check (
    media_type in ('image', 'video', 'gif') or media_type is null
  ),
  constraint live_messages_content_or_media check (
    (content is not null and length(trim(content)) > 0) or media_url is not null
  ),
  constraint live_messages_moderation_status_valid check (
    moderation_status in ('pending', 'approved', 'rejected')
  )
);

create table if not exists public.live_overlay_assets (
  id uuid primary key default gen_random_uuid(),
  room_owner_user_id uuid not null references public.accounts(user_id) on delete cascade,
  created_by_user_id uuid not null references public.accounts(user_id) on delete cascade,
  name text not null,
  command text not null,
  media_url text not null,
  media_type text not null,
  shortcut_key text,
  image_duration_seconds integer,
  display_size_percent integer not null default 100,
  display_position text not null default 'center',
  display_fit text not null default 'contain',
  entry_animation text not null default 'fade',
  audio_volume_percent integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_overlay_assets_name_nonempty check (
    length(trim(name)) > 0
  ),
  constraint live_overlay_assets_command_format check (
    command ~ '^![a-z0-9_-]{2,32}$'
  ),
  constraint live_overlay_assets_media_type_valid check (
    media_type in ('sound', 'image', 'video')
  ),
  constraint live_overlay_assets_shortcut_key_valid check (
    shortcut_key is null or length(trim(shortcut_key)) between 1 and 24
  ),
  constraint live_overlay_assets_image_duration_valid check (
    image_duration_seconds is null or image_duration_seconds between 2 and 120
  ),
  constraint live_overlay_assets_display_size_valid check (
    display_size_percent between 20 and 100
  ),
  constraint live_overlay_assets_display_position_valid check (
    display_position in (
      'center',
      'top',
      'bottom',
      'left',
      'right',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right'
    )
  ),
  constraint live_overlay_assets_display_fit_valid check (
    display_fit in ('contain', 'cover')
  ),
  constraint live_overlay_assets_entry_animation_valid check (
    entry_animation in ('none', 'fade', 'pop', 'slide-up', 'slide-left')
  ),
  constraint live_overlay_assets_audio_volume_valid check (
    audio_volume_percent between 0 and 100
  )
);

create table if not exists public.live_overlay_events (
  id uuid primary key default gen_random_uuid(),
  room_owner_user_id uuid not null references public.accounts(user_id) on delete cascade,
  asset_id uuid not null references public.live_overlay_assets(id) on delete cascade,
  asset_name text not null,
  asset_command text not null,
  media_url text not null,
  media_type text not null,
  image_duration_seconds integer,
  display_size_percent integer not null default 100,
  display_position text not null default 'center',
  display_fit text not null default 'contain',
  entry_animation text not null default 'fade',
  audio_volume_percent integer not null default 100,
  triggered_by_user_id uuid not null references public.accounts(user_id) on delete cascade,
  triggered_by_handle text not null,
  created_at timestamptz not null default now(),
  constraint live_overlay_events_name_nonempty check (
    length(trim(asset_name)) > 0
  ),
  constraint live_overlay_events_command_format check (
    asset_command ~ '^![a-z0-9_-]{2,32}$'
  ),
  constraint live_overlay_events_media_type_valid check (
    media_type in ('sound', 'image', 'video')
  ),
  constraint live_overlay_events_trigger_handle_nonempty check (
    length(trim(triggered_by_handle)) > 0
  ),
  constraint live_overlay_events_image_duration_valid check (
    image_duration_seconds is null or image_duration_seconds between 2 and 120
  ),
  constraint live_overlay_events_display_size_valid check (
    display_size_percent between 20 and 100
  ),
  constraint live_overlay_events_display_position_valid check (
    display_position in (
      'center',
      'top',
      'bottom',
      'left',
      'right',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right'
    )
  ),
  constraint live_overlay_events_display_fit_valid check (
    display_fit in ('contain', 'cover')
  ),
  constraint live_overlay_events_entry_animation_valid check (
    entry_animation in ('none', 'fade', 'pop', 'slide-up', 'slide-left')
  ),
  constraint live_overlay_events_audio_volume_valid check (
    audio_volume_percent between 0 and 100
  )
);

alter table if exists public.live_overlay_assets
add column if not exists display_size_percent integer not null default 100;

alter table if exists public.live_overlay_assets
add column if not exists display_position text not null default 'center';

alter table if exists public.live_overlay_assets
add column if not exists display_fit text not null default 'contain';

alter table if exists public.live_overlay_assets
add column if not exists entry_animation text not null default 'fade';

alter table if exists public.live_overlay_assets
add column if not exists audio_volume_percent integer not null default 100;

alter table if exists public.live_overlay_events
add column if not exists display_size_percent integer not null default 100;

alter table if exists public.live_overlay_events
add column if not exists display_position text not null default 'center';

alter table if exists public.live_overlay_events
add column if not exists display_fit text not null default 'contain';

alter table if exists public.live_overlay_events
add column if not exists entry_animation text not null default 'fade';

alter table if exists public.live_overlay_events
add column if not exists audio_volume_percent integer not null default 100;

alter table if exists public.live_overlay_assets
drop constraint if exists live_overlay_assets_display_size_valid;
alter table if exists public.live_overlay_assets
add constraint live_overlay_assets_display_size_valid
check (display_size_percent between 20 and 100);

alter table if exists public.live_overlay_assets
drop constraint if exists live_overlay_assets_display_position_valid;
alter table if exists public.live_overlay_assets
add constraint live_overlay_assets_display_position_valid
check (
  display_position in (
    'center',
    'top',
    'bottom',
    'left',
    'right',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right'
  )
);

alter table if exists public.live_overlay_assets
drop constraint if exists live_overlay_assets_display_fit_valid;
alter table if exists public.live_overlay_assets
add constraint live_overlay_assets_display_fit_valid
check (display_fit in ('contain', 'cover'));

alter table if exists public.live_overlay_assets
drop constraint if exists live_overlay_assets_entry_animation_valid;
alter table if exists public.live_overlay_assets
add constraint live_overlay_assets_entry_animation_valid
check (entry_animation in ('none', 'fade', 'pop', 'slide-up', 'slide-left'));

alter table if exists public.live_overlay_assets
drop constraint if exists live_overlay_assets_audio_volume_valid;
alter table if exists public.live_overlay_assets
add constraint live_overlay_assets_audio_volume_valid
check (audio_volume_percent between 0 and 100);

alter table if exists public.live_overlay_events
drop constraint if exists live_overlay_events_display_size_valid;
alter table if exists public.live_overlay_events
add constraint live_overlay_events_display_size_valid
check (display_size_percent between 20 and 100);

alter table if exists public.live_overlay_events
drop constraint if exists live_overlay_events_display_position_valid;
alter table if exists public.live_overlay_events
add constraint live_overlay_events_display_position_valid
check (
  display_position in (
    'center',
    'top',
    'bottom',
    'left',
    'right',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right'
  )
);

alter table if exists public.live_overlay_events
drop constraint if exists live_overlay_events_display_fit_valid;
alter table if exists public.live_overlay_events
add constraint live_overlay_events_display_fit_valid
check (display_fit in ('contain', 'cover'));

alter table if exists public.live_overlay_events
drop constraint if exists live_overlay_events_entry_animation_valid;
alter table if exists public.live_overlay_events
add constraint live_overlay_events_entry_animation_valid
check (entry_animation in ('none', 'fade', 'pop', 'slide-up', 'slide-left'));

alter table if exists public.live_overlay_events
drop constraint if exists live_overlay_events_audio_volume_valid;
alter table if exists public.live_overlay_events
add constraint live_overlay_events_audio_volume_valid
check (audio_volume_percent between 0 and 100);

alter table if exists public.posts drop constraint if exists posts_user_id_fkey;
alter table if exists public.posts
add constraint posts_user_id_fkey
foreign key (user_id) references public.accounts(user_id) on delete cascade;

alter table if exists public.posts drop constraint if exists posts_parent_post_id_fkey;
alter table if exists public.posts
add constraint posts_parent_post_id_fkey
foreign key (parent_post_id) references public.posts(id) on delete cascade;

create index if not exists posts_parent_idx on public.posts(parent_post_id);
create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists follows_following_user_idx on public.follows(following_user_id);
create index if not exists blocks_blocked_user_idx on public.blocks(blocked_user_id);
create index if not exists live_messages_room_created_idx on public.live_messages(room_owner_user_id, created_at);
create index if not exists live_messages_status_idx on public.live_messages(moderation_status);
create unique index if not exists live_overlay_assets_room_command_idx on public.live_overlay_assets(room_owner_user_id, command);
create index if not exists live_overlay_assets_room_created_idx on public.live_overlay_assets(room_owner_user_id, created_at desc);
create index if not exists live_overlay_assets_room_type_idx on public.live_overlay_assets(room_owner_user_id, media_type);
create index if not exists live_overlay_events_room_created_idx on public.live_overlay_events(room_owner_user_id, created_at desc);
create index if not exists live_overlay_events_asset_created_idx on public.live_overlay_events(asset_id, created_at desc);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.accounts(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.accounts(user_id) on delete cascade,
  actor_user_id uuid not null references public.accounts(user_id) on delete cascade,
  type text not null,
  post_id uuid references public.posts(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;
alter table public.posts enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.live_messages enable row level security;
alter table public.live_overlay_assets enable row level security;
alter table public.live_overlay_events enable row level security;

drop trigger if exists live_overlay_assets_set_updated_at on public.live_overlay_assets;
create trigger live_overlay_assets_set_updated_at
before update on public.live_overlay_assets
for each row
execute function public.update_updated_at_column();

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

drop policy if exists "live_messages_select_visible" on public.live_messages;
create policy "live_messages_select_visible"
on public.live_messages
for select
to authenticated
using (
  moderation_status = 'approved'
  or author_user_id = auth.uid()
  or room_owner_user_id = auth.uid()
  or exists (
    select 1
    from public.accounts me
    where me.user_id = auth.uid()
      and me.is_moderator = true
  )
);

drop policy if exists "live_messages_insert_own" on public.live_messages;
create policy "live_messages_insert_own"
on public.live_messages
for insert
to authenticated
with check (
  auth.uid() = author_user_id
  and moderation_reason is null
  and moderated_by_user_id is null
  and moderated_at is null
  and (
    (media_url is null and moderation_status = 'approved')
    or (media_url is not null and media_type is not null and moderation_status = 'pending')
  )
  and (
    (content is not null and length(trim(content)) > 0)
    or media_url is not null
  )
);

drop policy if exists "live_messages_update_moderation" on public.live_messages;
create policy "live_messages_update_moderation"
on public.live_messages
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
with check (
  exists (
    select 1
    from public.accounts me
    where me.user_id = auth.uid()
      and me.is_moderator = true
  )
);

drop policy if exists "live_messages_delete_own" on public.live_messages;
create policy "live_messages_delete_own"
on public.live_messages
for delete
to authenticated
using (auth.uid() = author_user_id);

drop policy if exists "live_messages_delete_moderation" on public.live_messages;
create policy "live_messages_delete_moderation"
on public.live_messages
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

drop policy if exists "live_overlay_assets_select_moderator" on public.live_overlay_assets;
create policy "live_overlay_assets_select_moderator"
on public.live_overlay_assets
for select
to authenticated
using (
  exists (
    select 1
    from public.accounts me
    where me.user_id = auth.uid()
      and me.is_moderator = true
  )
);

drop policy if exists "live_overlay_assets_insert_moderator" on public.live_overlay_assets;
create policy "live_overlay_assets_insert_moderator"
on public.live_overlay_assets
for insert
to authenticated
with check (
  auth.uid() = created_by_user_id
  and exists (
    select 1
    from public.accounts me
    where me.user_id = auth.uid()
      and me.is_moderator = true
  )
);

drop policy if exists "live_overlay_assets_update_moderator" on public.live_overlay_assets;
create policy "live_overlay_assets_update_moderator"
on public.live_overlay_assets
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
with check (
  exists (
    select 1
    from public.accounts me
    where me.user_id = auth.uid()
      and me.is_moderator = true
  )
);

drop policy if exists "live_overlay_assets_delete_moderator" on public.live_overlay_assets;
create policy "live_overlay_assets_delete_moderator"
on public.live_overlay_assets
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

drop policy if exists "live_overlay_events_select_moderator" on public.live_overlay_events;
create policy "live_overlay_events_select_moderator"
on public.live_overlay_events
for select
to authenticated
using (
  exists (
    select 1
    from public.accounts me
    where me.user_id = auth.uid()
      and me.is_moderator = true
  )
);

drop policy if exists "live_overlay_events_insert_moderator" on public.live_overlay_events;
create policy "live_overlay_events_insert_moderator"
on public.live_overlay_events
for insert
to authenticated
with check (
  auth.uid() = triggered_by_user_id
  and exists (
    select 1
    from public.accounts me
    where me.user_id = auth.uid()
      and me.is_moderator = true
  )
  and exists (
    select 1
    from public.live_overlay_assets asset
    where asset.id = asset_id
      and asset.room_owner_user_id = room_owner_user_id
      and asset.command = asset_command
      and asset.name = asset_name
      and asset.media_url = media_url
      and asset.media_type = media_type
      and coalesce(asset.image_duration_seconds, -1) = coalesce(image_duration_seconds, -1)
      and asset.display_size_percent = display_size_percent
      and asset.display_position = display_position
      and asset.display_fit = display_fit
      and asset.entry_animation = entry_animation
      and asset.audio_volume_percent = audio_volume_percent
  )
);

-- Post likes

alter table public.post_likes enable row level security;

drop policy if exists "post_likes_select_authenticated" on public.post_likes;
create policy "post_likes_select_authenticated"
on public.post_likes
for select
to authenticated
using (true);

drop policy if exists "post_likes_insert_own" on public.post_likes;
create policy "post_likes_insert_own"
on public.post_likes
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "post_likes_delete_own" on public.post_likes;
create policy "post_likes_delete_own"
on public.post_likes
for delete
to authenticated
using (auth.uid() = user_id);

-- Notifications

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_recipient" on public.notifications;
create policy "notifications_select_recipient"
on public.notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

drop policy if exists "notifications_insert_actor" on public.notifications;
create policy "notifications_insert_actor"
on public.notifications
for insert
to authenticated
with check (actor_user_id = auth.uid());

drop policy if exists "notifications_update_recipient" on public.notifications;
create policy "notifications_update_recipient"
on public.notifications
for update
to authenticated
using (recipient_user_id = auth.uid())
with check (recipient_user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('profile-media', 'profile-media', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('live-media', 'live-media', true)
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

drop policy if exists "live_media_read_authenticated" on storage.objects;
create policy "live_media_read_authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'live-media');

drop policy if exists "live_media_insert_own_folder" on storage.objects;
create policy "live_media_insert_own_folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'live-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "live_media_delete_own_folder" on storage.objects;
create policy "live_media_delete_own_folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'live-media'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.accounts me
      where me.user_id = auth.uid()
        and me.is_moderator = true
    )
  )
);
