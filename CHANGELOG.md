# Changelog

## 1.0.0

Initial release of the Carousel Digital Signage module.

- Discover players and channels through the Carousel API.
- Change a player's default channel, with options to preserve or remove its schedule.
- Apply timed overrides and restore the original channel and schedule, including after a restart.
- Select Shelter or Evacuate independently through CAP, or clear both alerts.
- Check CAP processing logs and bulletin state before reporting an alert as verified.
- Provide player feedback, variables and routing presets.

Requires the Companion Node 26 runtime and module API 2.1. Alert activation requires
API authentication, CAP configuration, unique bulletin tags and read access to the
configured alert zone. Verification reflects Carousel's reported state; confirm actual
screen output during commissioning.
