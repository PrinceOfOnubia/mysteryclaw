create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  wallet_pubkey text unique not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists wallet_nonces (
  id uuid primary key default gen_random_uuid(),
  wallet_pubkey text not null,
  nonce_hash text unique not null,
  message text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists wallet_nonces_wallet_idx on wallet_nonces (wallet_pubkey);
create index if not exists wallet_nonces_expires_idx on wallet_nonces (expires_at);

create table if not exists verified_wallets (
  id uuid primary key default gen_random_uuid(),
  wallet_pubkey text unique not null,
  last_verified_at timestamptz not null default now(),
  last_nonce_hash text,
  signature text,
  message text,
  created_at timestamptz not null default now()
);

create table if not exists prize_epochs (
  id uuid primary key default gen_random_uuid(),
  epoch_number integer unique not null,
  title text,
  slug text unique,
  started_at timestamptz,
  closes_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  paid_out_at timestamptz,
  status text not null default 'open',
  pool_usdc numeric(18, 6) not null default 1000,
  max_attempts_per_wallet integer not null default 10,
  x_thread_url text,
  secret_env_var text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table prize_epochs add column if not exists title text;
alter table prize_epochs add column if not exists slug text;
alter table prize_epochs add column if not exists starts_at timestamptz;
alter table prize_epochs add column if not exists ends_at timestamptz;
alter table prize_epochs add column if not exists max_attempts_per_wallet integer not null default 10;
alter table prize_epochs add column if not exists x_thread_url text;
alter table prize_epochs add column if not exists secret_env_var text;
alter table prize_epochs add column if not exists metadata jsonb not null default '{}'::jsonb;
create unique index if not exists prize_epochs_slug_unique on prize_epochs (slug) where slug is not null;

create table if not exists guesses (
  id uuid primary key default gen_random_uuid(),
  wallet_pubkey text not null,
  user_id text,
  guess text not null,
  normalized_guess text not null,
  correct boolean not null default false,
  verified_wallet boolean not null default false,
  verified_wallet_id uuid references verified_wallets(id),
  epoch_id uuid references prize_epochs(id),
  source text not null default 'website',
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table guesses add column if not exists source text not null default 'website';

create index if not exists guesses_wallet_created_idx on guesses (wallet_pubkey, created_at desc);
create index if not exists guesses_epoch_idx on guesses (epoch_id);

create table if not exists winners (
  id uuid primary key default gen_random_uuid(),
  epoch_id uuid not null references prize_epochs(id),
  wallet_pubkey text not null,
  guess_id uuid references guesses(id),
  verified_wallet_id uuid not null references verified_wallets(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  paid_at timestamptz,
  payout_signature text,
  unique (epoch_id, wallet_pubkey)
);

alter table winners add column if not exists approved_at timestamptz;
alter table winners add column if not exists approved_by text;

create index if not exists winners_unpaid_idx on winners (epoch_id, paid_at) where paid_at is null;

create table if not exists payout_attempts (
  id uuid primary key default gen_random_uuid(),
  winner_id uuid not null references winners(id),
  epoch_id uuid not null references prize_epochs(id),
  wallet_pubkey text not null,
  amount_usdc numeric(18, 6) not null,
  status text not null,
  signature text,
  error text,
  idempotency_key text unique not null,
  requested_by text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table if not exists autonomous_posts (
  id text primary key,
  post text not null,
  context jsonb not null default '[]'::jsonb,
  earnings jsonb,
  token_info jsonb,
  mood text,
  created_at timestamptz not null default now()
);

create index if not exists autonomous_posts_created_idx on autonomous_posts (created_at desc);

create table if not exists epoch_clues (
  id uuid primary key default gen_random_uuid(),
  epoch_id uuid not null references prize_epochs(id) on delete cascade,
  clue_number integer not null,
  scheduled_at timestamptz,
  post_copy text not null,
  x_url text,
  status text not null default 'draft',
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (epoch_id, clue_number)
);

create index if not exists epoch_clues_epoch_idx on epoch_clues (epoch_id, clue_number);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor text,
  wallet_pubkey text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists system_settings (
  key text primary key,
  value text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

insert into system_settings (key, value)
values
  ('prize_submissions_paused', 'false'),
  ('agent_actions_paused', 'false')
on conflict (key) do nothing;

insert into prize_epochs (epoch_number, status)
values (1, 'closed')
on conflict (epoch_number) do nothing;

update prize_epochs
set title = coalesce(title, 'Epoch 01: Mysterio'),
    slug = coalesce(slug, 'mysterio'),
    secret_env_var = coalesce(secret_env_var, 'SECRET_WORD')
where epoch_number = 1;

insert into prize_epochs (
  epoch_number, title, slug, status, pool_usdc, max_attempts_per_wallet,
  started_at, starts_at, closes_at, ends_at, secret_env_var, metadata
)
values (
  2,
  'TRIALS OF ECHO',
  'echo',
  'live',
  1000,
  10,
  now(),
  now(),
  now() + interval '3 hours',
  now() + interval '3 hours',
  'ECHO_SECRET_WORD',
  jsonb_build_object(
    'tagline', 'The word is gone. The echoes remain.',
    'launchCopy', 'Fragments will appear across X and inside the terminal. No single clue is enough. Echo is the live trial. Your job is to reconstruct the answer.',
    'xCta', 'Follow the X investigation'
  )
)
on conflict (epoch_number) do update
set title = excluded.title,
    slug = excluded.slug,
    pool_usdc = excluded.pool_usdc,
    max_attempts_per_wallet = excluded.max_attempts_per_wallet,
    secret_env_var = excluded.secret_env_var,
    metadata = prize_epochs.metadata || excluded.metadata;

insert into epoch_clues (epoch_id, clue_number, scheduled_at, post_copy, status)
select e.id, c.clue_number, now() + (c.clue_number - 1) * interval '30 minutes', c.post_copy, 'draft'
from prize_epochs e
cross join (values
  (1, 'ECHO CLUE 01: The word is gone. The echoes remain. X is for theories. The terminal is for answers.'),
  (2, 'ECHO CLUE 02: A fragment is not proof. A pattern is not a confession. Keep both.'),
  (3, 'ECHO CLUE 03: No single clue is enough. The archive only opens when the fragments agree.'),
  (4, 'ECHO CLUE 04: Mysterio already knows the answer. Echo only repeats the shape it left behind.')
) as c(clue_number, post_copy)
where e.slug = 'echo'
on conflict (epoch_id, clue_number) do nothing;
