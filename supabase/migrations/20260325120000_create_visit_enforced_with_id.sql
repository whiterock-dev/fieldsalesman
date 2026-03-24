-- visits.id is NOT NULL; insert must set it (client uses v-{timestamp} style ids).
create or replace function public.create_visit_enforced(
  p_visit_id text,
  p_customer_id text,
  p_salesman_id text,
  p_visit_type text,
  p_captured_at timestamptz,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_meters double precision,
  p_photo_path text,
  p_notes text,
  p_next_action text,
  p_follow_up_date date,
  p_max_gps_accuracy_meters double precision default 30
)
returns visits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer customers;
  v_distance double precision;
  v_visit visits;
  v_max_acc double precision;
begin
  if p_visit_id is null or btrim(p_visit_id) = '' then
    raise exception 'Visit id is required';
  end if;

  select * into v_customer from customers where id = p_customer_id;
  if v_customer.id is null then
    raise exception 'Customer does not exist';
  end if;

  v_max_acc := coalesce(p_max_gps_accuracy_meters, 30);
  if v_max_acc < 5 or v_max_acc > 500 then
    v_max_acc := 30;
  end if;

  if p_accuracy_meters > v_max_acc then
    raise exception 'GPS accuracy must be <= % meters (reported: %)', v_max_acc, p_accuracy_meters;
  end if;

  if p_visit_type = 'Existing customer' then
    v_distance :=
      6371000 * acos(
        cos(radians(v_customer.lat)) * cos(radians(p_lat)) * cos(radians(p_lng) - radians(v_customer.lng))
        + sin(radians(v_customer.lat)) * sin(radians(p_lat))
      );
    if v_distance > 30 then
      raise exception 'Visit rejected: outside 30m customer radius (%.2f m)', v_distance;
    end if;
  else
    v_distance := null;
  end if;

  insert into visits (
    id,
    customer_id,
    salesman_id,
    visit_type,
    captured_at,
    lat,
    lng,
    accuracy_meters,
    distance_from_customer_meters,
    photo_path,
    notes,
    next_action,
    follow_up_date
  )
  values (
    p_visit_id,
    p_customer_id,
    p_salesman_id,
    p_visit_type,
    p_captured_at,
    p_lat,
    p_lng,
    p_accuracy_meters,
    v_distance,
    p_photo_path,
    p_notes,
    p_next_action,
    p_follow_up_date
  )
  returning * into v_visit;

  return v_visit;
end;
$$;
