# Repository maintenance

- Treat `baileyh8/antigravity-gateway` as the maintained repository. Its `main` is the installation/default branch; `codex/bailey-stability` is the current development line. `LeeFeee/antigravity-gateway` is the source upstream, not the default push or PR target. Verify remote URLs before publishing.
- Preserve existing work and original MIT attribution. Integrate upstream changes only after reviewing compatibility with this repository's maintenance changes.
- Keep Chinese and English README, installation/update URLs, configuration defaults, CHANGELOG and package metadata consistent with actual behavior. Follow CONTRIBUTING.md. Do not label tests as deployed acceptance or imply a GitHub release exists before publishing one.
- Use isolated configuration for tests. Never commit real credentials, account identifiers, private infrastructure details, `.runtime/`, local `docs/reviews/` operations reports, or user-owned helper scripts without reviewing their contents and scope.
- Runtime deployments require the user's authorized environment and its operations instructions; repository maintenance alone does not authorize changing production services. Keep rollback and real-request verification separate from CI.
