-- Chicky Drip: online payments via PayPal (PayPal AI Hackathon update, Nov 2026)
-- Safe to run once on the existing schema; does not drop or rewrite any data.
begin;

alter table public.orders
  add column if not exists payment_status text not null default 'pending',
  add column if not exists paypal_order_id text,
  add column if not exists paypal_capture_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists currency text not null default 'USD';

-- Orders placed before online payments existed were "pay on pickup". Mark them legacy so they keep
-- counting toward each customer's Drip Meter exactly as before.
update public.orders set payment_status = 'legacy' where paypal_order_id is null and payment_status = 'pending';

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('pending', 'paid', 'legacy', 'failed', 'refunded'));

create unique index if not exists orders_paypal_order_id_key on public.orders (paypal_order_id) where paypal_order_id is not null;
create index if not exists orders_payment_status_idx on public.orders (payment_status);

commit;
