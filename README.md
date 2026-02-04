# Todo multi‑appareils (Deno Deploy + Supabase)

Todo app simple et un peu jolie (Tailwind) avec login + DB.

- Hébergement: **Deno Deploy**
- Login + DB: **Supabase Auth + Postgres**
- Sécurité: **RLS**
- Mode: **partagé** (tous les utilisateurs connectés voient toutes les tâches)

## 1) Créer / reconstruire Supabase

1. Crée un projet sur https://supabase.com
2. Va dans **SQL Editor** et exécute `sql/000_rebuild.sql` (recrée le schéma)
3. Va dans **Project Settings > API** et récupère:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`

> Auth: laisse **Email + Password** activé. (Optionnel) désactive la confirmation email si tu veux un flow plus simple.

## 2) Configurer l’app

Édite `public/config.js` et colle les 2 valeurs.

## 3) Déployer sur Deno Deploy

1. Mets ce dossier dans un repo GitHub (ex: `todo-deno-supabase`)
2. Sur Deno Deploy: **New Project → Import from GitHub**
3. Entrypoint: `main.ts`
4. Déploie.

## Notes

- Tout se fait côté client via `@supabase/supabase-js`.
- La clé `anon` est **publique** par design. La protection réelle est assurée par RLS.
- Si tu actives “Confirm email”, l’utilisateur devra valider l’email avant d’être connecté.
