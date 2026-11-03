# Carousel API implementation notes

## Swagger findings

Reviewed against the [public Carousel OpenAPI specification](https://support.demo.carouselsignage.net/CarouselAPI/swagger/v1/swagger.json) and [API authentication guide](https://support.carouselsignage.com/hc/en-us/articles/360040951231-Carousel-Cloud-API-General-Information) on September 9, 2026. Player pagination is optional: omitting `page_size` returns all players. Channels are returned as an array without pagination parameters.

API-key authentication sends `grant_type=client_credentials`, `client_id`, and `client_secret` in the form body, as the current guide specifies. Both this format and the earlier HTTP Basic client-authentication format authenticated successfully during read-only live checks on November 2, 2026.

The Carousel Swagger document identifies these operations and access requirements:

| Purpose        | Operation                                 | Notes                                                                                                                                       |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Password token | `POST /CarouselAPI/v1/Auth/token`         | `application/x-www-form-urlencoded`; `grant_type=password`; username is the Carousel email address. MFA-enabled users cannot use this flow. |
| API key token  | `POST /CarouselAPI/v1/Auth/token`         | OAuth 2 client-credentials flow using a Site Administrator-created key and secret.                                                          |
| Players        | `GET /CarouselAPI/v1/Players`             | Requires `System ManagePlayers`; response is a JSON array.                                                                                  |
| One player     | `GET /CarouselAPI/v1/Players/{id}`        | Used to take the routing snapshot immediately before a timed override.                                                                      |
| Channels       | `GET /CarouselAPI/v1/Channels`            | Requires one of `SetupSystemConfiguration`, `ManagePlayers`, or `SetupZone`; response is a JSON array.                                      |
| Routing update | `POST /CarouselAPI/v1/Players/bulkupdate` | Requires `ManagePlayers`; allowed properties explicitly include `DefaultChannelID` and `ChannelScheduleID`.                                 |

The generic player `PUT` schema includes runtime properties such as check-in status and transaction data. Because the bulk-update route explicitly supports the two routing properties, this module does not round-trip the generic player model.

## Schedule semantics implemented

Live testing established that routing values inside `Properties` must be strings (for example, `"DefaultChannelID": "2"`), while `IDs` remains an array of numbers. Numeric property values caused HTTP 500 with an Int64-to-String cast error. Schedule clearing uses JSON `null`. The client now serializes non-null routing property values as strings.

For the tested API key, player and channel discovery succeeded with a Site Role containing **Manage Players** and **System Configuration** permissions. Manage Players alone did not permit channel discovery on that installation. Permission labels and groupings can differ between Carousel versions.

- **Permanent / preserve schedule:** set `DefaultChannelID` only.
- **Permanent / remove schedule:** set `DefaultChannelID` and clear `ChannelScheduleID`.
- **Timed / preserve schedule:** set `DefaultChannelID` and keep (or reapply, after a repeated override) the original `ChannelScheduleID`.
- **Timed / suspend schedule:** set `DefaultChannelID` and clear `ChannelScheduleID` until restoration.
- **Restore:** set both `DefaultChannelID` and `ChannelScheduleID` back to the pre-override snapshot.

Repeated timed overrides retain the first pre-override snapshot. A second override changes the temporary channel and expiration time but never turns the first temporary channel into the restore target.

## Installation-dependent behavior

Swagger defines the accepted properties but not every player type's timing behavior. The string-valued routing payload, JSON-null schedule removal, API-key authentication, and schedule restoration were verified against one Carousel Cloud installation. Validate these points on other Carousel products or versions before show-critical use:

1. A `Players/bulkupdate` request with `{ "DefaultChannelID": <channel> }` causes each deployed player type to adopt the selected channel promptly.
2. A JSON `null` for `ChannelScheduleID` removes the schedule association on the installed Carousel version.
3. With an active `ChannelScheduleID`, changing only `DefaultChannelID` has the desired site-specific meaning. A running schedule may legitimately keep `CurrentChannelID` on the schedule-selected channel.
4. The token endpoint returns an `access_token`; `expires_in` is used when present and otherwise the token is conservatively cached for five minutes.
5. The API-key flow accepts the documented form-body client credentials.
6. The API account has `ManagePlayers` and sufficient channel-read access.

The module's debug logs report the HTTP method/path, status, player ID, and operation category without logging credentials, tokens, request authorization, or token bodies.

## Bulletin verification (1.0.0)

Verified against the installation's OpenAPI schema on November 2, 2026. `GET /CAPLog`
requires SetupSystemConfiguration and returns MessageID plus Bulletins entries containing
PageID, Error and Modified. The UUID in the submitted CAP identifier is used for correlation;
unrelated historical log entries cannot satisfy a new command.

`GET /Bulletins?zoneID=<id>` requires bulletin access in the specified zone. Live checks
found that its partial records omit Tags. The verifier therefore reads each record through
`GET /Bulletins/<id>`, with at most four detail requests in flight. It rejects partial detail
responses, mismatched identifiers and duplicate identifiers before using their tags.

Tags contain TagName; Status uses the documented TRMSPageStatus strings. Current is
active; Queued, Current_Null, Hold, Saved, Old and Disabled count as inactive. The installed
Carousel client's bulletin-management code places Current_Null in the upcoming group,
and the inactive emergency bulletins were observed with that status. Current_Error and
unrecognized states still fail closed. Verification requires exactly one tagged target per
alert and checks the log's PageID against that target. The module does not infer success
from the undocumented CAP POST response body.

On November 3, 2026, fresh-session live reads passed with **Create – Alert Bulletins**
and **Create – Template Bulletins** assigned directly to the emergency zone, with Full
Access off. The same role through a zone-tag assignment did not permit these reads on
that installation. The existing site role supplied System Configuration for CAP-log
access and Manage Players for routing. Prefer a direct content-role assignment to the
intended zone and verify both list and detail reads with the actual credentials.

Schema and observed response behavior are covered by fixtures and command-sequencing
tests. Live preflight and verification against historical clear commands passed; no new
production emergency commands were sent for these checks. A supervised acceptance
test must still establish new-command processing and physical screen output.
