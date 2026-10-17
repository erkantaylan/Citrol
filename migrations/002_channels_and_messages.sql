create table channels (
  id bigint generated always as identity primary key,
  name text not null unique,
  topic text,
  -- Null for the seeded channels; kept when the creator's account goes away.
  created_by text references users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table messages (
  id bigint generated always as identity primary key,
  channel_id bigint not null references channels (id) on delete cascade,
  author_id text not null references users (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

-- History is read newest-first per channel, paging back with "id < before".
create index messages_channel_id_idx on messages (channel_id, id desc);

insert into channels (name) values ('general'), ('homework'), ('showcase'), ('off-topic');
