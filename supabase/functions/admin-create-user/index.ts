// LOCATION: supabase/functions/admin-create-user/index.ts
// (project root, NOT inside docwire-app/ — see the deploy steps in chat
// if this is your first Edge Function; supabase/ is a separate CLI-managed
// folder, not part of the Expo bundle.)
//
// Supabase Edge Function: admin-create-user
//
// The one place in this app that touches the Admin API / service-role
// key — deliberately kept out of the client app entirely (Super Admin
// session summary: "creating an actual login-capable account requires
// Supabase's Admin API (a service-role key), which must never live in
// the client app"). One shared function, not one per caller, because the
// sensitive/expensive part (auth.admin.createUser + the matching
// public.users insert) is identical either way — only the validation
// branches by caller role:
//
//   Super Admin  -> can create manager / accountant / client_admin,
//                   anywhere in their own tenant, no seat limit.
//   Client Admin -> can create client ONLY, forced into their own org,
//                   blocked once seat_limit is hit (Roles doc: "Cannot
//                   exceed the seat limit set by Super Admin").
//
// Creates the account with a server-generated password (returned once in
// the response) rather than emailing an invite link. Originally used
// auth.admin.inviteUserByEmail — switched after hitting two real problems
// with that approach during testing: (1) Supabase's invite flow rejects
// non-deliverable-looking domains outright (test.com, example.com, etc.),
// which is exactly what dev/test account creation reaches for, and (2)
// it depends on Supabase's transactional email actually being deliverable
// and not rate-limited, neither of which this app needs to depend on
// just to create a login. Trade-off: there's no "user sets their own
// password via a link" flow anymore — whoever creates the account has to
// relay this password to the person some other way. Worth revisiting
// once this moves past internal testing (a "must change password on
// first login" flag, or switching back to invite-by-email once real
// email addresses are in play, are both reasonable follow-ups — neither
// is built here).
//
// Deploy: supabase functions deploy admin-create-user
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
// auto-injected by the Supabase runtime — nothing to configure manually.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TargetRole = 'manager' | 'accountant' | 'client_admin' | 'client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// 16 characters from a charset that avoids visually-confusable characters
// (no 0/O, 1/I/l) since this may need to be read off a screen and typed
// back in by whoever it's relayed to.
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let pw = '';
  for (let i = 0; i < bytes.length; i++) pw += chars[bytes[i] % chars.length];
  return pw;
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
    const targetRole = body.targetRole as TargetRole;
    const name = (body.name as string | undefined)?.trim();
    const email = (body.email as string | undefined)?.trim();
    // Only meaningful when the caller is Super Admin creating a
    // client_admin — Client Admin's org is always forced to their own,
    // never taken from the request body (see below).
    const requestedClientOrgId = body.client_org_id as string | undefined;

    if (!name || !email || !targetRole) {
      return jsonResponse({ error: 'name, email, and targetRole are required.' }, 400);
    }

    // Identify the CALLER using their own JWT (not the service role) —
    // this is what lets us trust req's Authorization header to mean
    // "this really is the signed-in user," rather than trusting a
    // caller-supplied field. RLS (users_select_own) is what allows this
    // read to succeed for the caller's own row.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401);

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

    const { data: callerProfile, error: callerProfileError } = await callerClient
      .from('users')
      .select('id, tenant_id, client_org_id, role')
      .eq('id', callerAuthUser.id)
      .single();
    if (callerProfileError || !callerProfile) {
      return jsonResponse({ error: 'Could not load caller profile.' }, 403);
    }

    // Service-role client — only used AFTER the caller has been
    // identified and validated above, and only for the specific
    // privileged actions below.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let resolvedClientOrgId: string | null = null;

    if (callerProfile.role === 'super_admin') {
      if (!['manager', 'accountant', 'client_admin'].includes(targetRole)) {
        return jsonResponse({ error: `Super Admin cannot create a ${targetRole} account.` }, 403);
      }
      if (targetRole === 'client_admin') {
        if (!requestedClientOrgId) {
          return jsonResponse({ error: 'client_org_id is required when creating a Client Admin.' }, 400);
        }
        // Verify the target org actually belongs to this Super Admin's
        // own tenant — without this, a Super Admin could technically
        // attach a Client Admin to another firm's client org by id.
        const { data: org, error: orgError } = await adminClient
          .from('client_organizations')
          .select('id, tenant_id')
          .eq('id', requestedClientOrgId)
          .single();
        if (orgError || !org || org.tenant_id !== callerProfile.tenant_id) {
          return jsonResponse({ error: 'client_org_id does not belong to your tenant.' }, 403);
        }
        resolvedClientOrgId = requestedClientOrgId;
      }
      // Manager / Accountant: firm staff, not tied to a client org —
      // resolvedClientOrgId stays null, matching users.client_org_id
      // being nullable for these roles.
    } else if (callerProfile.role === 'client_admin') {
      if (targetRole !== 'client') {
        return jsonResponse({ error: 'Client Admin can only create Client accounts.' }, 403);
      }
      if (!callerProfile.client_org_id) {
        return jsonResponse({ error: 'Your account has no client_org_id set — cannot create users.' }, 400);
      }
      // Deliberately ignores any client_org_id in the request body —
      // Client Admin can only ever create within their own org
      // (Roles doc: "Does not see other client organizations").
      resolvedClientOrgId = callerProfile.client_org_id;

      // Seat limit check (Roles doc: "Cannot exceed the seat limit set
      // by Super Admin") — counts everyone currently in the org against
      // the cap before creating one more.
      const { data: org, error: orgError } = await adminClient
        .from('client_organizations')
        .select('seat_limit')
        .eq('id', resolvedClientOrgId)
        .single();
      if (orgError || !org) {
        return jsonResponse({ error: 'Could not load your organization.' }, 500);
      }
      const { count, error: countError } = await adminClient
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('client_org_id', resolvedClientOrgId);
      if (countError) {
        return jsonResponse({ error: 'Could not check seat usage.' }, 500);
      }
      if ((count ?? 0) >= org.seat_limit) {
        return jsonResponse(
          { error: `Seat limit reached (${count}/${org.seat_limit}). Ask Super Admin to raise it before adding more users.` },
          403
        );
      }
    } else {
      return jsonResponse({ error: 'Only Super Admin or Client Admin can create accounts.' }, 403);
    }

    // Generates the account with a password set immediately — no email
    // sent, no dependency on the address being deliverable or Supabase's
    // email sending not being rate-limited. See the file header for why
    // this replaced inviteUserByEmail.
    const tempPassword = generateTempPassword();
    const { data: created, error: createUserError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true, // account usable immediately, no confirmation step pending
    });
    if (createUserError || !created?.user) {
      return jsonResponse({ error: `Could not create account: ${createUserError?.message ?? 'unknown error'}` }, 500);
    }

    const { error: insertError } = await adminClient.from('users').insert({
      id: created.user.id,
      tenant_id: callerProfile.tenant_id,
      client_org_id: resolvedClientOrgId,
      name,
      email,
      role: targetRole,
    });
    if (insertError) {
      // Don't leave an auth-only account with no matching profile row —
      // roll back the created auth account so a failed create doesn't
      // silently orphan an account nobody can see or manage.
      await adminClient.auth.admin.deleteUser(created.user.id);
      return jsonResponse({ error: `Could not save user profile: ${insertError.message}` }, 500);
    }

    // tempPassword is returned exactly once here — Supabase stores only
    // a hash, so there is no way to retrieve it again after this
    // response. The calling screen is responsible for showing it clearly
    // and telling the admin to relay it now.
    return jsonResponse({
      success: true,
      user: { id: created.user.id, name, email, role: targetRole, client_org_id: resolvedClientOrgId },
      tempPassword,
    });
  } catch (err) {
    return jsonResponse({ error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
});