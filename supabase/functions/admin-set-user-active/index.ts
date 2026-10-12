// LOCATION: supabase/functions/admin-set-user-active/index.ts (NEW FILE)
// (project root, beside admin-create-user — NOT inside docwire-app/)
//
// Supabase Edge Function: admin-set-user-active
//
// Deactivates or reactivates one user account. Two steps:
//
//   1. public.set_user_active(), called WITH THE CALLER'S OWN SESSION —
//      so every rule in Add_user_deactivation.sql is checked against the
//      real person asking: who may manage whom (Super Admin: anyone in
//      the firm except themselves; Client Admin: Clients of their own
//      organisation), the blocking rules (open tasks, assigned Clients,
//      organisation defaults, documents waiting for a reupload), the last
//      Super Admin, and the seat limit on reactivation. From this moment
//      the database itself refuses the person everything.
//   2. Block (or unblock) the login in Supabase Auth with the service
//      role, so they can't sign in again or refresh a session.
//
// If step 2 fails after step 1 succeeded, step 1 is undone, so the
// account is never left half-deactivated.
//
// Body: { userId: string, active: boolean }
//
// Deploy: supabase functions deploy admin-set-user-active

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// About 100 years — Supabase's way of saying "banned until unbanned".
const BAN_FOREVER = '876000h';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    const body = await req.json();
    const userId = body.userId as string | undefined;
    const active = body.active as boolean | undefined;
    if (!userId || typeof active !== 'boolean') {
      return jsonResponse({ error: 'userId and active (true/false) are required.' }, 400);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401);

    // The caller's own session — every permission check happens in the
    // database function, as this person.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: callerAuthUser },
      error: callerAuthError,
    } = await callerClient.auth.getUser();
    if (callerAuthError || !callerAuthUser) {
      return jsonResponse({ error: 'Could not identify caller — invalid or expired session.' }, 401);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Remember the current state so step 1 can be undone if step 2 fails.
    const { data: before, error: beforeError } = await adminClient
      .from('users')
      .select('deactivated_at, deactivated_by')
      .eq('id', userId)
      .single();
    if (beforeError || !before) {
      return jsonResponse({ error: 'Could not find that user.' }, 404);
    }

    // Step 1 — all the rules.
    const { error: rpcError } = await callerClient.rpc('set_user_active', { p_user_id: userId, p_active: active });
    if (rpcError) {
      // The database's own message is written for people (e.g. "Kavya
      // can't be deactivated yet: 2 open task(s) ...").
      return jsonResponse({ error: rpcError.message }, 400);
    }

    // Step 2 — the login itself.
    const { error: banError } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: active ? 'none' : BAN_FOREVER,
    });
    if (banError) {
      await adminClient
        .from('users')
        .update({ deactivated_at: before.deactivated_at, deactivated_by: before.deactivated_by })
        .eq('id', userId);
      return jsonResponse({ error: `Could not update the login: ${banError.message}. Nothing was changed.` }, 500);
    }

    return jsonResponse({ success: true, userId, active });
  } catch (err) {
    return jsonResponse({ error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
});