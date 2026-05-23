create extension if not exists pgcrypto;

create type order_status as enum (
  'new',
  'needs_review',
  'confirmed',
  'preparing',
  'delivered',
  'cancelled',
  'discarded'
);

create type media_kind as enum (
  'audio',
  'image',
  'pdf',
  'file'
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  whatsapp_name text unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table customer_aliases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  alias text not null,
  normalized_alias text not null unique,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  default_unit text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  alias text not null,
  normalized_alias text not null unique,
  created_at timestamptz not null default now()
);

create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  chat_id text,
  author_name text not null,
  sent_at timestamptz not null,
  body text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index whatsapp_messages_sent_at_idx on whatsapp_messages(sent_at);
create index whatsapp_messages_author_idx on whatsapp_messages(author_name);

create table media_files (
  id uuid primary key default gen_random_uuid(),
  whatsapp_message_id uuid references whatsapp_messages(id) on delete cascade,
  filename text not null,
  kind media_kind not null,
  storage_path text,
  mime_type text,
  transcript text,
  extracted_text text,
  raw_analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table order_candidates (
  id uuid primary key default gen_random_uuid(),
  source_block_id text,
  seller_name text not null,
  customer_guess text,
  status order_status not null default 'needs_review',
  confidence numeric(4, 3),
  original_text text,
  ai_result jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index order_candidates_status_idx on order_candidates(status);
create index order_candidates_started_at_idx on order_candidates(started_at);

create table orders (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  order_candidate_id uuid references order_candidates(id) on delete set null,
  customer_id uuid references customers(id) on delete restrict,
  seller_id uuid references employees(id) on delete set null,
  customer_name text,
  seller_name text,
  status order_status not null default 'confirmed',
  requested_delivery_date date,
  notes text,
  source_summary text,
  original_text text,
  confidence numeric(4, 3),
  needs_review boolean not null default false,
  media jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_status_idx on orders(status);
create index orders_customer_idx on orders(customer_id);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_text text not null,
  product_normalized text,
  quantity numeric,
  unit text,
  notes text,
  confidence numeric(4, 3),
  created_at timestamptz not null default now()
);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  order_candidate_id uuid references order_candidates(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_items;
