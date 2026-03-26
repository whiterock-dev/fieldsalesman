# Changelog

## [1.0.0] - 2026-03-26

### Delivered
- Built a role-based field sales operations web app with dashboard, customers, follow-ups, visit capture, map, live tracking, and settings modules.
- Implemented invite and role management workflows, Supabase-backed data model, realtime updates, visit photo support, and Google Maps links for customer/visit locations.

### Tech Debt / Known Issues
- `eslint` reports `react-hooks/exhaustive-deps` warnings in `src/App.tsx`; behavior is stable but dependency arrays can be further refined.
- Supabase function and DB deployment remain environment-dependent and require project-specific setup/validation before production rollout.

---

*Developed by [Nerdshouse Technologies LLP](https://nerdshouse.com)*
