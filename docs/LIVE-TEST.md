# Live Carousel validation checklist

Automated tests use a local mock server and do not modify Carousel's public demonstration system. Complete these write checks on a non-critical player before using the module for show-critical control.

## Prerequisites

- A supported Companion version capable of loading the module's Node 26/API 2.1 runtime.
- A Carousel API key with **Manage Players** and channel-read access, or a non-MFA username/password account with equivalent rights.
- One test player whose current default channel and channel schedule are known.
- Two harmless test channels.
- Debug logging disabled unless request-path diagnostics are needed.

## Record the baseline

In Carousel, record the test player's default channel and channel schedule. The module takes its own fresh snapshot immediately before the first timed override; the manual record is an independent safety reference.

Do not proceed if the player is operationally critical or its original routing cannot be restored confidently.

## Permanent routing

1. Run **Set Player Channel – Permanent** with **Preserve schedule association**.
2. Confirm Carousel reports the selected default channel.
3. If a schedule is active, confirm the actual current channel follows the site's intended schedule behavior.
4. Run the action with **Override / remove schedule association** and confirm the schedule becomes None/null.
5. Restore the baseline before continuing.

The narrow update sent to Carousel has this shape:

```json
{
	"IDs": [90],
	"Properties": {
		"DefaultChannelID": "8",
		"ChannelScheduleID": null
	}
}
```

Player and channel IDs above are illustrative. Select resources through Companion's dropdowns.

## Timed restoration

1. Start a short timed override with **Suspend schedule**.
2. Confirm the temporary channel becomes the default, the schedule becomes None/null, the active-override feedback turns on, and the countdown decreases.
3. Before expiration, start another short override to a different channel.
4. Confirm the countdown restarts while the original pre-override state remains the restoration target.
5. At expiration, confirm both the original default channel and original channel schedule are restored.
6. Repeat once and use **Restore Timed Override Now** before expiration.

## Restart recovery

1. Start a timed override and restart only its Companion connection. Confirm the active feedback and remaining-time variable recover.
2. Start another short override, stop the connection until after expiry, and start it again.
3. Confirm the saved routing is restored as soon as the API reconnects.

If restoration fails, the module must retain the saved snapshot, log the player ID and failure category, and retry every 30 seconds. It must not silently clear the override.

## Emergency bulletin acceptance

Use an isolated alert zone subscribed only to the observed test channel, or an explicitly
scheduled site-wide test. A test player on its own does not isolate a shared alert zone.
Use dedicated Carousel test buttons if the production buttons also control other equipment.

1. Confirm the API key has CAP-log access and the two content permissions described in
   HELP, scoped directly to the intended zone. Confirm both bulletin tags are globally
   unique and both bulletins are initially inactive.
2. Select Shelter. Confirm `shelter-verified`, an empty emergency error and a fresh
   verification timestamp. Confirm only the shelter graphic appears on the observed screen.
3. Select Evacuate. Confirm `evacuate-verified` and that the screen changes to evacuation,
   with no rotation between the two graphics.
4. Clear both. Confirm `clear-verified`, both bulletins inactive and normal screen content
   restored. Check Carousel directly if any command fails or times out before retrying.
5. Record the module version, player type, observed results and any delay. Server-side
   verification alone does not complete the physical screen checks.

## Evidence for an API discrepancy

Provide only:

- Carousel product/server version and player type/version.
- HTTP method and path.
- Sanitized JSON request body.
- HTTP status and sanitized response body.
- `DefaultChannelID`, `CurrentChannelID`, and `ChannelScheduleID` before and after.

Never include passwords, API secrets, bearer tokens, cookies, authorization headers, private server addresses, or unrelated player data.
