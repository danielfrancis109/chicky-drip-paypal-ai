create type public.app_role as enum ('admin','user');
create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade not null, role app_role not null, unique(user_id, role));
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "own roles" on public.user_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.user_roles where user_id=_user_id and role=_role) $$;

create or replace function public.handle_new_user_role() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles where role='admin') then
    insert into public.user_roles(user_id, role) values (new.id,'admin');
  end if;
  insert into public.user_roles(user_id, role) values (new.id,'user') on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created_role after insert on auth.users for each row execute function public.handle_new_user_role();

create table public.site_content (key text primary key, value text not null, updated_at timestamptz not null default now());
grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;
grant all on public.site_content to service_role;
alter table public.site_content enable row level security;
create policy "public read" on public.site_content for select to anon, authenticated using (true);
create policy "admin insert" on public.site_content for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
create policy "admin update" on public.site_content for update to authenticated using (public.has_role(auth.uid(),'admin'));
create policy "admin delete" on public.site_content for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  customer_name text not null,
  phone text not null,
  event_date date,
  notes text,
  items jsonb not null,
  subtotal numeric(10,2) not null,
  discount numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  used_reward boolean not null default false,
  status text not null default 'new',
  created_at timestamptz not null default now()
);
grant select, update on public.orders to authenticated;
grant all on public.orders to service_role;
alter table public.orders enable row level security;
create policy "own or admin read" on public.orders for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "admin update" on public.orders for update to authenticated using (public.has_role(auth.uid(),'admin'));
create index on public.orders(user_id);