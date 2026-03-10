# Contributing Guide

Thanks for your interest in contributing to Fund Estimation System.

## 1) Workflow

1. Fork this repository
2. Create a branch from `main`
3. Make your changes
4. Add/adjust tests when needed
5. Ensure checks pass
6. Open a Pull Request

```bash
git checkout -b feat/your-change
npm test
npm run build
```

## 2) Commit Style

Use Conventional Commits where possible:

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `refactor: ...`
- `test: ...`

## 3) Code Expectations

- Keep TypeScript strict and readable
- Avoid breaking existing API contracts unless discussed first
- Keep UI consistent with design tokens
- Update docs for user-facing changes

## 4) Pull Request Checklist

- [ ] PR description explains purpose and scope
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] No secrets or local machine paths added
- [ ] README/docs updated when behavior changes

## 5) Reporting Issues

When opening an issue, please include:

- Expected behavior
- Actual behavior
- Repro steps
- Logs or screenshots if available
- Environment (OS, Node version)

## 6) Security

Please do not open public issues for sensitive vulnerabilities.
For security concerns, contact the maintainer privately first.
