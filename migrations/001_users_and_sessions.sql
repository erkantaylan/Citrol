create table users (
  -- Discord user id. Snowflakes are too big for JS numbers, so text.
  id text primary key,
  username text not null,
  display_name text,
  avatar text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create table sessions (
  -- sha256 of the token in the cookie, so a database leak can't be used to log in.
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index sessions_user_id_idx on sessions (user_id);
