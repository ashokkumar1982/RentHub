# Implementation Plan — Rental Management System (Version 1)

Stack: Vue 3 + TypeScript + Vite + Tailwind CSS + Supabase + Capacitor (Android) + GitHub Pages.

## Phase 1 — Setup ✅
- Vue/Vite/TS scaffold, Tailwind, Pinia, Vue Router (hash history for GitHub Pages/Capacitor compatibility)
- Supabase client (`src/lib/supabase.ts`) using only `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
- Admin auth (login, logout, forgot password, reset password) via `useAuth` composable + router guard
- App layout: sidebar (desktop) / dropdown menu (mobile)
- `supabase/schema.sql`: rooms, tenants, meter_readings, bills, payments, settings + RLS policies

## Phase 2 — Rooms & Tenants ✅
- Rooms: add/edit/view, per-room rent/electricity rate/water/maintenance, delete blocked if bills exist
- Tenants: full field set, optional ID document upload to Supabase Storage
- Room assignment auto-fills tenant's agreed rent from the room default, but the field stays editable and future room changes won't silently overwrite a manually-set rent
- Room status (vacant/occupied) kept in sync automatically on assign/vacate

## Phase 3 — Electricity & Billing ✅
- Meter readings: auto-fetch previous reading from prior month, block current < previous, live unit/amount calc
- `lib/billing.ts`: single source of truth for `Total = Rent + Electricity + Water + Maintenance + Other + Previous Due − Discount`
- Bills: generate draft per room/tenant/month (unique DB constraint prevents duplicates), edit before finalizing, Finalize locks the row permanently — later rent/rate changes never retroactively alter a finalized bill
- Previous due carries forward from the prior bill's `outstanding_amount`, avoiding double counting

## Phase 4 — Payments, PDF & WhatsApp ✅
- Payments: partial payments supported, `payment_status` auto-recalculated (unpaid / partially_paid / paid)
- PDF: `lib/pdf.ts` (jsPDF) — Download / Print
- WhatsApp: `lib/whatsapp.ts` builds a free `wa.me` link with the bill summary; on Android, the PDF is shared directly via the native Share sheet (Capacitor `@capacitor/share` + `@capacitor/filesystem`); `whatsapp_shared` flag tracked per bill

## Phase 5 — Dashboard & Reports ✅
- Dashboard: room/tenant counts, current month billed/collected, total outstanding, quick actions
- Reports: Monthly Bills, Outstanding, Payments — each with CSV export
- Settings: property/owner info, contact numbers, UPI ID, payment instructions, bill prefix, due day

## Phase 6 — Deployment ✅
- `.github/workflows/deploy.yml`: builds with secrets injected, deploys `dist/` to GitHub Pages
- `capacitor.config.ts` + `android/` platform added via `npx cap add android`
- README documents Supabase setup, local dev, GitHub Pages, Android testing, and debug APK generation

## Explicitly out of scope for V1
Multi-company support, GST/tax, tenant login, SMS/email automation, online payment gateway, complex analytics, expense tracking, automated WhatsApp Business API.
