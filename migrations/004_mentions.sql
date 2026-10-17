-- Who each message mentions (the <@USER_ID> tokens in its content that count, see docs/api.md).
-- channel_id is copied from the message (messages never move) so a user's unread mentions in one
-- channel are a range scan on the index below, the same shape as the unread count.
create table message_mentions (
  message_id bigint not null references messages (id) on delete cascade,
  channel_id bigint not null references channels (id) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  primary key (message_id, user_id)
);

create index message_mentions_user_channel_idx on message_mentions (user_id, channel_id, message_id);

-- Backfill from existing messages with the same rules as the server: existing users only,
-- not the author, in a DM only the other member.
insert into message_mentions (message_id, channel_id, user_id)
select distinct m.id, m.channel_id, u.id
from messages m
join channels c on c.id = m.channel_id
cross join lateral regexp_matches(m.content, '<@([0-9]+)>', 'g') as token (parts)
join users u on u.id = token.parts[1]
where u.id <> m.author_id and (c.kind = 'text' or u.id in (c.dm_user_a, c.dm_user_b));
