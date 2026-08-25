# DocWire — MVP scaffold (web + mobile, Client + Accountant loop)

Project structure:
```
docwire-app/
  App.tsx              root: auth state + role-based routing
  app.json              Expo config (includes web bundler setup)
  eas.json               EAS build profiles (development/preview/production)
  vercel.json              Vercel build config for the web export
  .env.example              template — copy to .env, fill in real values
  babel.config.js
  tsconfig.json
  lib/
    supabase.ts          Supabase client, reads from env vars
    types.ts              shared TS types
  theme/
    colors.ts              design tokens pulled from the demo prototype
  components/
    UI.tsx                  Pill, PrimaryButton, OutlineButton
  screens/
    LoginScreen.tsx
    ClientHomeScreen.tsx
    AccountantHomeScreen.tsx
    ManagerHomeScreen.tsx   (placeholder — build next)
  supabase/
    schema.sql               run this in the Supabase SQL editor
```

## 1. Create your Supabase project
supabase.com → New project (free tier is fine).

## 2. Run the schema
SQL Editor → paste all of `supabase/schema.sql` → Run. When it asks about
enabling RLS on the new tables, say **yes** — the script also does this
explicitly, so it's a safe no-op if it's already on.

## 3. Set up your environment file
```bash
cp .env.example .env
```
Then open `.env` and fill in your real Supabase Project URL + anon key
(Project Settings → API). `.env` is gitignored — it never gets committed.

`lib/supabase.ts` reads these automatically via `process.env.EXPO_PUBLIC_...`
— no code changes needed when you switch projects or environments later.

## 4. Seed one tenant with test users
Manual for now (no admin UI yet — that's Phase 2).

**a.** Authentication → Add user → create `client@test.com` and
`accountant@test.com`. Copy each user's UID.

**b.** SQL Editor:
```sql
insert into tenants (id, firm_name) values ('11111111-1111-1111-1111-111111111111', 'Test Firm');
insert into client_organizations (id, tenant_id, name)
  values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Test Client Co');

insert into users (id, tenant_id, client_org_id, name, role) values
  ('PASTE-CLIENT-UID', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Test Client', 'client'),
  ('PASTE-ACCOUNTANT-UID', '11111111-1111-1111-1111-111111111111', null, 'Test Accountant', 'accountant');

insert into accountant_assignments (client_org_id, accountant_id)
  values ('22222222-2222-2222-2222-222222222222', 'PASTE-ACCOUNTANT-UID');
```

## 5. Install and run locally
```bash
npm install
npx expo start
```
- Scan the QR code with **Expo Go** for mobile
- Press **w** in the terminal for the web version (opens in your browser)

Both run against the exact same code and the exact same Supabase backend —
that's the point of Expo's web support, no separate web app to maintain.

## 6. Test the loop
Log in as `client@test.com` → upload a document. Log out, log in as
`accountant@test.com` → it should appear in the Pending queue → tap
**Mark Accounted**.

## 7. Mobile: build once, then `eas update` for changes (your existing workflow)
```bash
npx eas login
npx eas init          # links this project to an EAS project, fills in app.json's projectId
```

**Important**: since `.env` is gitignored, EAS's build servers never see it —
you need to give them the same values separately, once:
```bash
npx eas env:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value "https://YOUR-PROJECT.supabase.co" --visibility plaintext
npx eas env:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "YOUR-ANON-KEY" --visibility plaintext
```
(The anon key is safe as `plaintext` — it's meant to be public-facing; your
actual security comes from the RLS policies, not from hiding this key.)

Then build as usual:
```bash
npx eas build --profile preview --platform android   # or ios
```
- **`preview`** → gives you the QR code + download link, same as your other project. This is what your tester installs once.
- After that, day-to-day changes go out via `npx eas update` — no reinstall needed, the app pulls the new JS on next launch. `eas update` runs from your machine, so it reads your local `.env` automatically — no extra step needed for updates, just for the initial `eas build`.
- A fresh `eas build` is only needed again if you add a native dependency (not just JS/UI changes) or when submitting to app stores later.

Free tier: 30 builds/month, unlimited `eas update` pushes — plenty for a tester phase.

## 8. Web: connect once to Vercel, then it deploys itself on every push
This is a **separate pipeline from mobile** — `eas update` does not touch the web version, and vice versa.

**One-time setup:**
1. Push this project to a GitHub repo (`.env` won't be included — that's the point).
2. vercel.com → New Project → import that repo.
3. Vercel will pick up `vercel.json` automatically (build command `npm run build:web`, output folder `dist`) — no manual config needed.
4. **Add your env vars in Vercel's dashboard**: Project Settings → Environment Variables → add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` with the same values as your `.env`. Vercel's build servers need these the same way EAS's do — the gitignored `.env` file never reaches either one.
5. Deploy. You get a free `*.vercel.app` URL immediately.

**After that:** every `git push` triggers an automatic rebuild and redeploy — no manual `expo export` or upload step required. Your tester's web link just always reflects the latest `main` branch.

**If you'd rather not connect GitHub yet**, you can deploy manually any time (this reads your local `.env` automatically, no dashboard step needed):
```bash
npm run build:web
npx vercel --prod
```

Free tier: 100GB bandwidth/month, unlimited deployments — comfortably enough for a tester phase. (Vercel's Hobby tier is meant for non-commercial use; fine while testing, worth moving to Pro once DocWire is a real business, not urgent now.)

## Day-to-day workflow, once both are set up
1. Make a code change.
2. `npx eas update` → mobile tester's app updates automatically on next open.
3. `git push` → web redeploys automatically.

Same source files both times — the two versions never drift apart in behavior, only briefly in *when* each one catches up.


## Next steps
Once the Client → Accountant loop is confirmed working on both web and
mobile: build out `ManagerHomeScreen.tsx` (Accounted → Reviewed/Rework),
then the Tasks module, per the roadmap doc.