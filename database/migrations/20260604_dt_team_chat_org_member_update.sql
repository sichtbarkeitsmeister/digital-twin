-- Allow any org member to update/archive team chats (shared collaboration)

DROP POLICY IF EXISTS "dt_chats_update_visible" ON public.dt_chats;
CREATE POLICY "dt_chats_update_visible"
ON public.dt_chats FOR UPDATE
USING (
  public.is_platform_admin(auth.uid())
  OR owner_user_id = auth.uid()
  OR (
    mode = 'team'
    AND public.is_org_member(organisation_id, auth.uid())
  )
)
WITH CHECK (
  public.is_platform_admin(auth.uid())
  OR owner_user_id = auth.uid()
  OR (
    mode = 'team'
    AND public.is_org_member(organisation_id, auth.uid())
  )
);
