# Project Agent Rules (FundEstimationSystem)

This file constrains AI/code agents working in this repository.

## Branching

- Default development branch: `develop`
- Never push feature work directly to `main`
- New feature branches should be based on `develop`

## Mandatory Quality Gate Before Commit

Run all checks and ensure success:

```bash
npm run verify
```

`verify` includes:
- lint
- typecheck
- test
- build

## Commit & PR

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
- Keep commits focused and reversible
- PR target branch should be `develop` (unless hotfix release is explicitly required)

## Safety

- Do not commit secrets, tokens, private keys, or local absolute paths
- Do not commit runtime artifacts (`.next`, `*.db-wal`, logs, pid files)
- Keep API changes backward compatible where possible; document breaking changes clearly

## Documentation Sync

Any user-visible behavior/API/script changes must update at least one of:
- `README.md` / `README.en.md`
- `CONTRIBUTING.*`
- `docs/engineering-standards.md`
