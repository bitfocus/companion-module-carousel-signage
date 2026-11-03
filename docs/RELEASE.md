# Release preparation

Maintainer: Eric Busby (`ericbusby77`). Reviewed local build: **1.0.0**.

The `carousel-signage` repository request has been approved in the Bitfocus Developer Portal. Repository approval is separate from approval of a module version.

## Validation and packaging

Use Node 26.5 or later in the Node 26 line and Yarn 4. Run:

```sh
yarn install --immutable
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn npm audit --all --recursive
yarn package
yarn check
yarn test:package
yarn test:emergency-package
```

Inspect the archive and repeat both smoke tests against its extracted entry point. The emergency smoke test handles every request in memory and never contacts an installation. Preserve required third-party dependency license notices. Project authorship and maintainership belong to Eric Busby; dependency notices identify their respective copyright holders.

The development-only `minimatch` resolution selects the patched 11.x line because ESLint's transitive 10.x requirement remains affected by an advisory. Lint is tested against this resolution. Remove the override when upstream requirements incorporate a patched release. Build cleanup uses Node's filesystem API rather than a globbing dependency.

## Local installation

Back up Companion privately. Wait for pending timed overrides to finish and prevent new actions during a version change. Import `carousel-signage-1.0.0.tgz` on the Modules page, then select it on the existing connection. Keep the connection identity, label, secrets and saved recovery records. Verify discovery, feedbacks and logs before operator testing. Do not delete the connection to switch versions.

## Public source and history

Earlier local commits contain site-specific test details. Publish a separate clean source tree, not this working repository's history. Include only `src/`, `scripts/`, `companion/`, `docs/`, `.github/`, README, CHANGELOG, LICENSE, build/configuration files, `.gitignore`, `.gitattributes`, `.prettierignore`, `.yarnrc.yml`, and `yarn.lock`. Exclude dependencies, generated output, archives, private notes, environment files, machine paths, and unrelated nested projects.

Review the export and use Eric Busby's approved Git identity for its initial commit. Do not rewrite the existing local history or remove third-party license notices.

## Submit a version

1. Confirm repository write access for `ericbusby77`, then push the reviewed source to the assigned `bitfocus/companion-module-carousel-signage` repository. Start from the Bitfocus-created repository and retain its official module-check and release workflows.
2. The prepared public version is **1.0.0**. Confirm `package.json` and the built manifest both report that version, and wait for the uploaded source checks to pass.
3. Create and push the matching `v1.0.0` tag against that exact reviewed commit.
4. Select the module in the [Developer Portal](https://developer.bitfocus.io/), choose Submit Version, select the tag, and submit for review.
5. Check the review result and address feedback before declaring the module released.

Source manifest version and API version remain `0.0.0`; the build fills them in. See the [official release process](https://companion.free/for-developers/module-development/module-lifecycle/releasing-your-module/).

The Node CI workflow runs formatting, lint, type checking, tests, module validation and
both smoke tests against a freshly extracted archive. The official Bitfocus workflows
perform the organization's module checks and attach the built package to a published
GitHub release. Their hosted results cannot be confirmed until the source is uploaded.
