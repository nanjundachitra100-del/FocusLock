
# FocusLock

FocusLock is a learning and digital-wellness prototype: **Earn Your Scroll. Master Your Goals.**

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Authentication uses Supabase; dashboard metrics and learning flows still use demo data. The AI Learning Lab is intentionally labeled as demo-only, and no Gemma model or Chrome extension is connected.

## Supabase setup

1. Copy `.env.example` to `.env.local` and enter the project URL and publishable key from the Supabase dashboard. Never use a service-role key in these variables.
2. Apply `supabase/migrations/20261016000000_auth_and_user_data.sql` in the Supabase SQL Editor, or run it with the Supabase CLI using your linked project.
3. In Supabase Authentication settings, enable email/password sign-in. Set the Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` to the allowed redirect URLs. Add the corresponding deployed callback URL before production use.
4. Restart the development server after changing `.env.local`.

The migration creates profiles on signup. Authenticated clients can read their own profile and focus sessions and update their own display name/session state. Client writes to quiz attempts and reward transactions are intentionally denied; connect a trusted server-side assessment flow before enabling those writes or issuing rewards. Applying the migration is a separate step and is not performed by `npm run build`.

## Included flows

Dashboard, mission cards, working focus timer, demo quiz flow, skill tree, focus garden, reward wallet, insights, and settings are available from the sidebar. The timer never grants rewards directly; sessions remain pending assessment.


## Planned Features

- AI-powered quizzes using Google Gemma 4
- Focus sessions and study timer
- Learning assessment and feedback
- Reward system for completing learning goals
- Chrome extension for website blocking
- Study progress dashboard

## Technology Stack

- React
- Tailwind CSS
- Python
- FastAPI
- Google Gemma 4
- SQLite
- Chrome Extensions API

## Team

- Chitrashree
- Karthik
