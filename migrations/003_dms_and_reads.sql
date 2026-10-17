-- Direct messages live in channels too, so messages, history and edits work the same for both kinds.
alter table channels add column kind text not null default 'text';
alter table channels alter column name drop not null;

-- The two members of a DM, stored in order (dm_user_a < dm_user_b) so each pair has one spelling.
alter table channels
  add column dm_user_a text references users (id) on delete cascade,
  add column dm_user_b text references users (id) on delete cascade;

alter table channels add constraint channels_kind_check check (
  (kind = 'text' and name is not null and dm_user_a is null and dm_user_b is null)
  or (kind = 'dm' and name is null and topic is null and dm_user_a < dm_user_b)
);

-- Exactly one DM per pair. Text channels have nulls here, which never collide.
create unique index channels_dm_pair_idx on channels (dm_user_a, dm_user_b);
create index channels_dm_user_b_idx on channels (dm_user_b) where kind = 'dm';

-- How far each user has read each channel. No row means: nothing read in a DM,
-- and in a text channel everything up to the user's first login (users.created_at).
-- Not a foreign key to messages: the marker must survive its message being deleted.
create table channel_reads (
  user_id text not null references users (id) on delete cascade,
  channel_id bigint not null references channels (id) on delete cascade,
  last_read_message_id bigint not null,
  primary key (user_id, channel_id)
);
