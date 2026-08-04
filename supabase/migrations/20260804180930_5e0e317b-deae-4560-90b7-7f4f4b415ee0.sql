-- 1. Fix mutable search_path
CREATE OR REPLACE FUNCTION public.block_direct_status_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.transition_ok', true), '') <> 'on' then
    raise exception 'Status só pode mudar via transition_sale()';
  end if;
  return new;
end $function$;

-- 2. Trigger-only functions must never be callable through the API
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decrement_stock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_direct_status_change() FROM PUBLIC, anon, authenticated;

-- 3. Business RPCs: signed-in users only, never anonymous
REVOKE ALL ON FUNCTION public.create_order(uuid, text, jsonb, text, text, numeric, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_sale(uuid, order_status, text, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dispatch_route(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_route(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, text, jsonb, text, text, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_sale(uuid, order_status, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_route(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_route(uuid) TO authenticated;

-- 4. Role helpers: needed by RLS policies for signed-in users, not for anon
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_has_role(app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_courier() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_has_role(app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_courier() TO authenticated;