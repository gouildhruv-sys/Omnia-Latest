create table users(uid text primary key,name text,country text,city text,last_seen timestamptz default now(),blocked boolean default false,n int default 0);
create table logs(id bigserial primary key,uid text,kind text,prompt text,reply text,ts timestamptz default now());
create table kv(k text primary key,v jsonb);
alter table users enable row level security;
alter table logs enable row level security;
alter table kv enable row level security;
