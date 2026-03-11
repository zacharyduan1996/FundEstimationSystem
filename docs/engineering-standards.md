# Engineering Standards

## 1. Branch Strategy

- `main`: production-ready releases only
- `develop`: default integration branch
- `feature/*`: feature branches from `develop`
- `hotfix/*`: urgent fixes, merge back to `main` and `develop`

## 2. Quality Gate (Required)

Before every commit/PR:

```bash
npm run verify
```

Pipeline includes:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test`
4. `npm run build`

## 3. Commit Convention

Use Conventional Commits:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `refactor:` internal refactor
- `test:` test changes
- `chore:` tooling/config

## 4. API Contract Rules

- Keep existing API fields backward compatible by default
- Any breaking API change must:
  - be documented in README/API section
  - include migration notes in PR description

## 5. Database Change Rules

- Schema changes must preserve existing data
- Default to additive changes first
- Deleting columns/tables requires explicit migration plan

## 6. Code Style

- TypeScript strict mode must remain enabled
- Keep modules focused and small
- Prefer pure utility functions for core calculations
- Use shared constants for trading/refresh rules

## 7. Testing

- Add/adjust tests for business logic changes
- Prioritize tests for:
  - trading window logic
  - stale detection
  - sort/filter behavior
  - group mapping and position calculation

## 8. Security & Hygiene

- Never commit secrets, credentials, private keys
- Never commit local machine absolute paths
- Keep `.gitignore` updated for runtime artifacts

## 9. Documentation

Any visible behavior change must update docs:

- `README.md` (CN default)
- `README.en.md`
- `CONTRIBUTING.*` (if workflow changes)
