# Carousel Digital Signage

Control individual Carousel players from Companion. You can make permanent channel changes or run timed overrides that restore the player's previous default channel and channel schedule.

## Before you begin

Create a Carousel API key and secret for routine use. On the Carousel Cloud installation used for validation, the key needed a Site Role with **Manage Players** and **System Configuration** permissions to discover channels and update players. Permission names can differ between Carousel versions. A broader administrative role works but grants more access than this module needs.

Username/password authentication is also available. Carousel documents that this flow does not work for accounts with multi-factor authentication enabled.

Test routing on a non-critical player before using the module in a live production environment.

## Connection configuration

- **Carousel Server URL:** Enter the site root, such as `https://example.carouselsignage.net`. URLs ending in `/CarouselAPI` or `/CarouselAPI/v1` are also accepted. Do not put credentials in the URL.
- **Authentication:** Choose API key and secret (recommended) or username and password.
- **Player Poll Interval:** How often the module refreshes player state for feedbacks and variables. Default: 5 seconds.
- **Player/Channel Discovery:** How often names and dropdown choices are refreshed. Default: 5 minutes.
- **API Timeout:** Maximum time for one API request. Default: 10 seconds.
- **Offline Threshold:** A player is considered offline when `SecondsSinceLastCheckin` reaches this value. Default: 120 seconds.
- **Debug Logging:** Logs request methods, paths, status codes, and timing. It does not log credentials, authorization headers, access tokens, or token response bodies.

When connected, the status message shows the discovered player and channel counts. Authentication, configuration, timeout, and connection failures are reported in the connection status and Companion log.

## Actions

### Set Player Channel – Permanent

Sets the selected player's default channel.

- **Preserve schedule association:** Changes only the default channel. If a schedule is active, Carousel may continue to display the channel selected by that schedule.
- **Override / remove schedule association:** Changes the default channel and clears the player's channel schedule, allowing the new default to take precedence.

Running a permanent action on a player with an active timed override cancels that override after the permanent update succeeds. The former pre-override state will no longer be restored.

### Set Player Channel – Timed Override

Snapshots the player's current default channel and channel schedule, applies the temporary channel for the selected duration, and restores the snapshot when time expires. Durations can be specified in seconds, minutes, or hours, up to 30 days.

- **Suspend schedule:** Temporarily clears the channel schedule so the override channel takes precedence. Restoration reinstates the saved schedule.
- **Preserve schedule:** Keeps the saved schedule associated with the player. An active schedule may determine what is actually displayed despite the new default channel.
- **Always restore the saved state:** Restores the snapshot even if another system changed the player's routing during the override.
- **Restore only if the override target is still the default:** Before restoring, checks whether the player's default channel still matches the temporary target. If another system changed it, the module leaves that newer routing in place and closes the override record.

Starting a second timed override on the same player keeps the first pre-override snapshot as the restore target and restarts the timer using the latest duration.

### Restore Timed Override Now

Cancels the selected player's timer and immediately restores the saved default channel and channel schedule. If no override is active, the action logs an error and makes no routing change.

### Refresh Players and Channels

Immediately refreshes player and channel names, action dropdowns, variables, feedback choices, and presets.

## Restart and failure behavior

Active override records are saved in the Companion connection configuration. They contain player/channel IDs, the routing snapshot, and the expiration time—not credentials.

After a module, connection, or Companion restart:

- An unexpired override resumes with its remaining time.
- An override that expired while stopped is restored after the API reconnects.
- A failed restore keeps its saved snapshot and retries every 30 seconds.

If applying an override fails, the module retains the snapshot because Carousel may have applied the write before the response was lost. The selected restoration policy still applies at expiry or manual restoration. For a failed replacement, conditional restoration also recognizes earlier possible override targets.

Recovery records are associated with the server URL. Restore pending overrides before changing servers; if the URL was changed while records existed, return to the previous URL to recover them. Recovery uses Companion's configuration storage; abrupt power loss before Companion saves that configuration cannot be made atomic with a Carousel write.

Use HTTPS for credential transport. HTTP remains available for installations that require it. Redirects are rejected; enter the final API server URL. Error logs contain status codes and failure categories, never server response bodies or arbitrary network error text.

Deleting the connection also deletes the configuration that holds its recovery records. Restore active overrides before deleting the connection.

## Feedbacks

- **Player Is On Channel:** True when Carousel reports that `CurrentChannelID` equals the selected channel. This reflects observed output, including schedule effects.
- **Player Has Active Timed Override:** True while the module retains a timed-override record for the player, including while a failed restore is awaiting retry.
- **Player Offline / Not Checking In:** True when the player's check-in age reaches the selected threshold. If no check-in age is available, the module falls back to Carousel's status value. A missing player is treated as offline.

## Variables

Global variables provide the player count, channel count, number of active overrides, last successful action, last error, and all player state as compact JSON.

For up to 20 players, sorted by name, the module also creates individual variables for:

- Current channel name
- Online state
- Active timed-override state
- Remaining override seconds

The `players_json` variable always includes every discovered player, even when more than 20 players exist.

## Presets

The module creates one restore preset per player. Its button changes from white-on-black to amber while that player has an active timed override.

Channel-routing presets are generated only when the number of players multiplied by the number of channels is 100 or fewer. Larger sites can create buttons with **Set Player Channel – Permanent** manually; this limit keeps the preset browser responsive.

## Troubleshooting

- **Authentication failure:** Check the API key/secret or username/password and the API key's Site Role.
- **Players appear but channels do not:** Grant channel-read access. On the tested Carousel Cloud site, adding **System Configuration** alongside **Manage Players** resolved this.
- **A preserved schedule prevents the selected channel from displaying:** Use **Override / remove schedule association** for permanent routing or **Suspend schedule** for a timed override.
- **Names are stale or a new player/channel is missing:** Run **Refresh Players and Channels**.
- **A timed restore failed:** Leave the connection running. The snapshot remains active and the module retries every 30 seconds; inspect the Companion log for the HTTP status or failure category.

# Emergency CAP controls (1.0.0)

Enable emergency CAP controls in the connection settings, enter the CAP token as a secret,
and configure two distinct, unique bulletin tags. HTTPS is required. These controls work
with API authentication and the emergency bulletin zone ID; they do not alter player channels.
The API account needs SetupSystemConfiguration for CAPLog and bulletin-read access in the
alert zone. CAP-only mode permits unverified clear requests but blocks activation.
Existing installations must enter the emergency zone ID before using the new build.

On the tested Carousel Cloud installation, bulletin reads required a Content Role with
**Create – Alert Bulletins** and **Create – Template Bulletins**, assigned directly to
the emergency zone. Assigning that same role through a zone tag did not permit the
required reads. Full Access was not needed. Confirm both list and individual-bulletin
access with the intended API key; permission names and behavior can vary by version.

Prepare two templated bulletins with your static graphics in a Full Screen Alert zone.
Leave Always Active selected but turn off every Daily Availability day. Give each bulletin
exactly its corresponding unique trigger tag. Only channels subscribed to the alert zone
will display the alerts. Verify the isolated test channel before subscribing production channels.
For dynamic CAP text, add matching Event and Description template blocks; static image
templates do not display the incoming text. Validate static-image activation on the server
before relying on it.

Use Emergency: Arm for 10 seconds followed by Emergency: Select or Clear Alert.
Alternatively, place the selection action in a three-second held group and disable its
Require ARM option. Never disable this option on an unprotected press action.

Selecting Shelter or Evacuate sends CLEAR to the opposite tag before requesting the selected
tag. A failed or uncertain clear prevents activation. Clear sends CLEAR to both tags and
attempts both even if one fails. Concurrent commands are rejected; there are no automatic
retries, startup activations, or expiry timers for alerts. Re-arm before retrying after checking
Carousel. A configuration change or shutdown drains pending work and cancels activation
if it occurs while clearing the opposite alert.

The emergency_request_state variable reports sending, verifying, shelter-verified,
evacuate-verified, clear-verified, or error. A verified result is a snapshot at command
completion, not continuous monitoring or proof of physical screen output. CAP-only clear
reports clear-requested. Existing requested-state feedbacks must be updated to the new
verified-state choices for API-authenticated commands.

Before activation, the module checks that each tag identifies one ready bulletin in the
configured zone and checks CAP-log read access. It correlates each posted message UUID
with CAPLog, rejects zero/extra/wrong targets and processing errors, and reads bulletin
Status. The opposite bulletin must be inactive before activation proceeds. The final
activation check requires the selected bulletin Current and the opposite inactive.
The verifier reads individual bulletin details because Carousel's list response can omit
tags. Current_Null is treated as upcoming/inactive, matching Carousel's bulletin manager.
An already-inactive clear may have Modified=false. Unknown/error statuses never count
as inactive. Verification reads retry up to five times with 500ms between attempts; each
API request uses the configured timeout. CAP writes themselves are never retried.

The emergency_error variable retains command errors independently of player polling.
After any failure or timeout, check Carousel before retrying. Tags must be unique across
all zones; a cross-zone duplicate detected in the CAP log fails verification but the CAP
write may already have affected it. External writers can change states after verification;
Carousel does not provide an atomic transaction across the two commands or displays.

Reference: https://support.carouselsignage.com/hc/en-us/articles/47274280401556-Carousel-Cloud-and-CAP-Common-Alerting-Protocol

Pending timed overrides require API authentication. If CAP-only mode reports pending overrides, restore API mode to resume recovery. Use HTTPS for regular API connections to protect credentials; CAP always requires HTTPS.
