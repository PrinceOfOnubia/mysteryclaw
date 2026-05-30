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
  started_at timestamptz,
  closes_at timestamptz,
  paid_out_at timestamptz,
  status text not null default 'open',
  pool_usdc numeric(18, 6) not null default 1000,
  created_at timestamptz not null default now()
);

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
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists guesses_wallet_created_idx on guesses (wallet_pubkey, created_at desc);
create index if not exists guesses_epoch_idx on guesses (epoch_id);

create table if not exists winners (
  id uuid primary key default gen_random_uuid(),
  epoch_id uuid not null references prize_epochs(id),
  wallet_pubkey text not null,
  guess_id uuid references guesses(id),
  verified_wallet_id uuid not null references verified_wallets(id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  payout_signature text,
  unique (epoch_id, wallet_pubkey)
);

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

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor text,
  wallet_pubkey text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into prize_epochs (epoch_number, status)
values (1, 'open')
on conflict (epoch_number) do nothing;
