# Companion module for Carousel Digital Signage

This connection module lets Bitfocus Companion route individual Carousel Digital Signage players to channels. It supports permanent routing, timed overrides, schedule-aware restoration, live feedback, variables, and recovery after a Companion or module restart.

Maintained by [Eric Busby](https://github.com/ericbusby77).

Uses the Companion Node 26 runtime and module API 2.1. API and CAP integration have been used with Companion 5.1.0; version 1.0.0 is installed on Companion 5.1.1 with live read verification complete. See [validation](docs/VALIDATION.md) for the distinction between automated checks, server-side verification and screen testing.

## Features

- Select separately tagged shelter or evacuation CAP bulletins, or clear both alerts.
- Discover Carousel players and channels and present them by name in Companion.
- Change a player's default channel while either preserving or removing its channel schedule.
- Temporarily override a player, then restore both its original default channel and channel schedule.
- Preserve the original restore target when a timed override is replaced by another timed override.
- Recover active overrides after a connection or Companion restart.
- Retry failed restores without discarding the saved state.
- Poll player state for channel, override, and offline feedbacks.
- Expose player state and override countdowns as Companion variables.
- Serialize operations per player to prevent overlapping button presses from racing.

See [companion/HELP.md](companion/HELP.md) for setup and operator instructions.

## Carousel API design

The implementation follows Carousel's published Swagger/OpenAPI description:

- Authentication: `POST /CarouselAPI/v1/Auth/token`
- Player discovery: `GET /CarouselAPI/v1/Players`
- Channel discovery: `GET /CarouselAPI/v1/Channels`
- Player snapshot: `GET /CarouselAPI/v1/Players/{id}`
- Routing update: `POST /CarouselAPI/v1/Players/bulkupdate`

Carousel does not document a dedicated endpoint for changing only the currently displayed channel. The module therefore updates the documented writable `DefaultChannelID` and, when requested, `ChannelScheduleID` properties. It treats `CurrentChannelID` as observed state for feedback rather than a writable field.

Live testing established an API detail not expressed by the Swagger schema: non-null routing values inside `Properties` must be JSON strings, while `IDs` remains an array of numbers. A missing schedule is sent as JSON `null`.

See [docs/API-NOTES.md](docs/API-NOTES.md) for protocol details and [docs/VALIDATION.md](docs/VALIDATION.md) for test coverage and known limits.

## Development

Use Node.js 26.5 or newer in the Node 26 release line and Yarn 4:

```sh
corepack enable
yarn install
yarn build
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn check
yarn package
```

`yarn package` creates a `.tgz` that can be imported from Companion's **Modules** page for testing. For active development, enable Developer Modules in the Companion launcher and select a parent directory containing this repository.

Do not commit Carousel credentials, bearer tokens, authorization headers, cookies, private server addresses, or captured production responses. Credential fields use Companion's secret configuration type, and debug logging never logs authentication values or token bodies.

## Release process

For a first public release, request a `manufacturer-product` repository through the Bitfocus Developer Portal. After Bitfocus creates the repository:

1. Push the reviewed source to the Bitfocus repository.
2. Set the release version in `package.json` using semantic versioning.
3. Create and push a matching `v<version>` tag.
4. Submit that tag through the [Bitfocus Developer Portal](https://developer.bitfocus.io/) for review.

The build process intentionally replaces the `0.0.0` placeholders in `companion/manifest.json`; those values should not be manually synchronized with `package.json`.

The prepared release version is `1.0.0`. See [release preparation](docs/RELEASE.md) before publishing source or history.

## License

MIT
