import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseConfigError =
  !SUPABASE_URL || !SUPABASE_ANON_KEY
    ? 'Missing Supabase env vars. Check that .env has real values and was included in this build.'
    : null;

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-key',
  {
    auth: {
      // AsyncStorage works on native; on web, Supabase falls back to
      // localStorage automatically when storage isn't passed the same way.
      storage: Platform.OS === 'web' ? undefined : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  }
);

// supabase.functions.invoke() only puts the Edge Function's JSON response
// body into `data` on a 2xx response. On a NON-2xx response (which is how
// admin-create-user reports every validation failure — bad auth, wrong
// caller role, seat limit hit, etc. — see index.ts's jsonResponse calls),
// `data` comes back null and `error` is a generic FunctionsHttpError
// whose `.message` is just "Edge Function returned a non-2xx status
// code" — not the actual { error: "..." } body the function sent. That
// real body has to be read from `error.context`, the raw Response object
// supabase-js attaches but doesn't parse for you. This normalizes both
// cases (2xx-with-error-field and non-2xx) into one string so every
// screen calling an Edge Function can show the real reason instead of
// this generic message.
export async function extractFunctionError(error: unknown, data: any): Promise<string | null> {
  if (data?.error) return data.error as string;
  if (!error) return null;
  const err = error as { context?: Response; message?: string };
  if (err.context && typeof err.context.json === 'function') {
    try {
      const body = await err.context.json();
      if (body?.error) return body.error as string;
    } catch {
      // context wasn't JSON (or already consumed) — fall through
    }
  }
  return err.message ?? 'Something went wrong.';
}