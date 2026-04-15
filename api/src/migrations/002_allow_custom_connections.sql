alter table connections drop constraint if exists connections_type_check;

alter table connections
  add constraint connections_type_check check (type in ('api', 'db', 'custom'));

