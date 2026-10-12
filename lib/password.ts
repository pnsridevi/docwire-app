// LOCATION: docwire-app/lib/password.ts (NEW FILE)
//
// Change-password helpers (Add_password_change.sql). The forced
// first-login screen and the "Change password" dialog both use these.
// Nothing here is a security boundary: Supabase Auth checks the session,
// and the database clears must_change_password only when the password
// really changes.
import { supabase } from './supabase';

export const MIN_PASSWORD_LENGTH = 8;

// Checks done before anything is sent. Returns a message, or null if fine.
export function checkNewPassword(next: string, confirm: string, current?: string): string | null {
  if (current !== undefined && !current) return 'Enter your current password.';
  if (next.length < MIN_PASSWORD_LENGTH) return `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (next !== confirm) return 'The two new passwords do not match.';
  if (current !== undefined && next === current) return 'The new password must be different from your current one.';
  return null;
}

// Turns Supabase's error into something people can act on.
function friendlyError(error: { message?: string; code?: string } | null): string {
  const code = error?.code ?? '';
  const msg = error?.message ?? '';
  if (code === 'same_password' || /different from the old/i.test(msg)) {
    return 'The new password must be different from your current one.';
  }
  if (code === 'weak_password' || /weak|at least/i.test(msg)) {
    return msg ? `This password is not accepted: ${msg}` : 'This password is too weak.';
  }
  if (code === 'reauthentication_needed' || /reauthenticat/i.test(msg)) {
    return 'For safety, please log out, log in again, and then change your password.';
  }
  return msg || 'Could not change the password. Please try again.';
}

// Changes the signed-in person's password. Returns an error message, or
// null on success.
//   current: given  -> checked first by signing in with it again (the
//                      normal "Change password" dialog). Supabase would
//                      otherwise accept a new password from anyone holding
//                      an unlocked, signed-in phone.
//   current: absent -> not checked (the forced first-login screen; the
//                      person typed the temporary password moments ago).
// On success every OTHER session of this person is signed out; this
// device stays signed in.
export async function changePassword(next: string, current?: string): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const email = sessionData.session?.user?.email;
  if (!email) return 'You are no longer signed in. Please log in again.';

  if (current !== undefined) {
    const { error: checkError } = await supabase.auth.signInWithPassword({ email, password: current });
    if (checkError) {
      return /invalid login credentials/i.test(checkError.message) || (checkError as any).code === 'invalid_credentials'
        ? 'Your current password is not correct.'
        : friendlyError(checkError as any);
    }
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return friendlyError(error as any);

  // Not critical if this fails — the password itself has already changed.
  const { error: othersError } = await supabase.auth.signOut({ scope: 'others' });
  if (othersError) console.warn('[password] could not sign out other sessions:', othersError);
  return null;
}