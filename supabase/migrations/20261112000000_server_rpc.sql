-- Chicky Drip: server-side checkout without the Supabase service-role key (PayPal AI Hackathon update).
--
-- Why: the hosted demo only has the project's publishable (anon) key. Checkout must create orders,
-- attach PayPal ids, mark orders paid and cancel unpaid orders, and none of that is allowed for anon
-- by RLS. Instead of exposing the table, this migration adds a few narrow SECURITY DEFINER functions.
-- Each one first checks a secret server token (only its SHA-256 hash appears here, as a literal inside
-- a function in a private schema that anon/authenticated cannot use) and then does exactly one
-- privileged operation. This file only defines schema objects and functions (it writes no data itself).
-- Requires the 20261109000000_paypal_payments.sql columns. Idempotent: safe to run more than once.
-- Uses only built-in Postgres functions (sha256 needs Postgres 11+), no extensions.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Rotating the token = re-run this migration with a new hash literal below.
create or replace function private.srv_check_token(p_token text)
returns void language plpgsql immutable security definer set search_path = public, pg_catalog as $$
begin
  if p_token is null or length(p_token) < 32
     or encode(sha256(convert_to(p_token, 'utf8')), 'hex') <> 'a2bd729dbdf45960e325730dec3a6c41dab4e98656513056ca917f44823b4129' then
    raise exception 'invalid_server_token' using errcode = '28000';
  end if;
end $$;
revoke all on function private.srv_check_token(text) from public, anon, authenticated;

-- Health check: srv_ping(token) -> {"ok": true, ...}. Wrong token -> error 28000.
create or replace function public.srv_ping(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  perform private.srv_check_token(p_token);
  return jsonb_build_object(
    'ok', true,
    'payment_columns', (
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'orders'
        and column_name in ('payment_status','paypal_order_id','paypal_capture_id','paid_at','currency')
    )
  );
end $$;

-- All of one customer's orders (rewards / Drip Meter).
create or replace function public.srv_list_user_orders(p_token text, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  perform private.srv_check_token(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id, 'user_id', o.user_id, 'status', o.status, 'used_reward', o.used_reward,
      'payment_status', o.payment_status, 'total', o.total, 'subtotal', o.subtotal,
      'discount', o.discount, 'paypal_order_id', o.paypal_order_id
    ))
    from public.orders o where o.user_id = p_user_id
  ), '[]'::jsonb);
end $$;

-- One customer's order by its PayPal order id (null when not found).
create or replace function public.srv_find_order_by_paypal_id(p_token text, p_user_id uuid, p_paypal_order_id text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  perform private.srv_check_token(p_token);
  return (
    select jsonb_build_object(
      'id', o.id, 'user_id', o.user_id, 'status', o.status, 'used_reward', o.used_reward,
      'payment_status', o.payment_status, 'total', o.total, 'subtotal', o.subtotal,
      'discount', o.discount, 'paypal_order_id', o.paypal_order_id
    )
    from public.orders o
    where o.user_id = p_user_id and o.paypal_order_id = p_paypal_order_id
    limit 1
  );
end $$;

-- Create an order. Only a pending order (status new) or an already-paid free-meal order (status confirmed).
create or replace function public.srv_insert_order(p_token text, p_row jsonb)
returns uuid language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  v_id uuid;
  v_payment text := coalesce(p_row->>'payment_status', 'pending');
  v_status text := coalesce(p_row->>'status', 'new');
begin
  perform private.srv_check_token(p_token);
  if v_payment not in ('pending', 'paid') or v_status not in ('new', 'confirmed') then
    raise exception 'invalid_order_state' using errcode = '22023';
  end if;
  insert into public.orders (
    user_id, customer_name, phone, event_date, notes, items,
    subtotal, discount, total, used_reward, status, payment_status, currency, paid_at
  ) values (
    (p_row->>'user_id')::uuid,
    p_row->>'customer_name',
    p_row->>'phone',
    nullif(p_row->>'event_date', '')::date,
    nullif(p_row->>'notes', ''),
    p_row->'items',
    (p_row->>'subtotal')::numeric,
    coalesce((p_row->>'discount')::numeric, 0),
    (p_row->>'total')::numeric,
    coalesce((p_row->>'used_reward')::boolean, false),
    v_status,
    v_payment,
    coalesce(nullif(p_row->>'currency', ''), 'USD'),
    nullif(p_row->>'paid_at', '')::timestamptz
  ) returning id into v_id;
  return v_id;
end $$;

-- Update one of the customer's own orders. Only the payment/status fields below can change, and a
-- paid (or legacy) order can never be changed through this function. Returns true if a row changed.
create or replace function public.srv_update_order(p_token text, p_id uuid, p_user_id uuid, p_patch jsonb)
returns boolean language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  v_n integer;
begin
  perform private.srv_check_token(p_token);
  if (p_patch -> 'payment_status') is not null and (p_patch->>'payment_status') not in ('pending', 'paid', 'failed') then
    raise exception 'invalid_payment_status' using errcode = '22023';
  end if;
  if (p_patch -> 'status') is not null and (p_patch->>'status') not in ('new', 'confirmed', 'cancelled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update public.orders o set
    payment_status    = case when (p_patch -> 'payment_status') is not null    then p_patch->>'payment_status'    else o.payment_status end,
    status            = case when (p_patch -> 'status') is not null            then p_patch->>'status'            else o.status end,
    paypal_order_id   = case when (p_patch -> 'paypal_order_id') is not null   then p_patch->>'paypal_order_id'   else o.paypal_order_id end,
    paypal_capture_id = case when (p_patch -> 'paypal_capture_id') is not null then p_patch->>'paypal_capture_id' else o.paypal_capture_id end,
    paid_at           = case when (p_patch -> 'paid_at') is not null           then (p_patch->>'paid_at')::timestamptz else o.paid_at end
  where o.id = p_id and o.user_id = p_user_id and o.payment_status in ('pending', 'failed');
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- Customer cancels their own unpaid order. Returns {id,status} or null when it can't be cancelled.
create or replace function public.srv_cancel_order(p_token text, p_id uuid, p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  v_id uuid;
begin
  perform private.srv_check_token(p_token);
  update public.orders o set status = 'cancelled'
  where o.id = p_id and o.user_id = p_user_id
    and o.status in ('new', 'confirmed') and o.payment_status <> 'paid'
  returning o.id into v_id;
  if v_id is null then return null; end if;
  return jsonb_build_object('id', v_id, 'status', 'cancelled');
end $$;

-- Owner insights: the most recent orders (only the columns the stats need). The app checks the
-- caller is an admin (has_role) before calling this.
create or replace function public.srv_admin_orders(p_token text, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  perform private.srv_check_token(p_token);
  return coalesce((
    select jsonb_agg(to_jsonb(t)) from (
      select items, total, payment_status, status, event_date, created_at, used_reward
      from public.orders order by created_at desc limit least(greatest(coalesce(p_limit, 500), 1), 1000)
    ) t
  ), '[]'::jsonb);
end $$;

-- Only anon/authenticated (the roles PostgREST uses with the publishable key) may call them, and
-- every function above refuses to do anything without the correct token.
revoke all on function public.srv_ping(text) from public;
grant execute on function public.srv_ping(text) to anon, authenticated;
revoke all on function public.srv_list_user_orders(text,uuid) from public;
grant execute on function public.srv_list_user_orders(text,uuid) to anon, authenticated;
revoke all on function public.srv_find_order_by_paypal_id(text,uuid,text) from public;
grant execute on function public.srv_find_order_by_paypal_id(text,uuid,text) to anon, authenticated;
revoke all on function public.srv_insert_order(text,jsonb) from public;
grant execute on function public.srv_insert_order(text,jsonb) to anon, authenticated;
revoke all on function public.srv_update_order(text,uuid,uuid,jsonb) from public;
grant execute on function public.srv_update_order(text,uuid,uuid,jsonb) to anon, authenticated;
revoke all on function public.srv_cancel_order(text,uuid,uuid) from public;
grant execute on function public.srv_cancel_order(text,uuid,uuid) to anon, authenticated;
revoke all on function public.srv_admin_orders(text,integer) from public;
grant execute on function public.srv_admin_orders(text,integer) to anon, authenticated;
