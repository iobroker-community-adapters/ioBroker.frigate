# Older changes
## 3.1.2 (2026-08-28)
- (@GermanBluefox) The Frigate directory can no longer be left empty by accident: the validator complained but did not stop the dialog from being saved. With an empty directory the plugin mounts named volumes instead of the chosen directory, while the adapter writes `config.yml` into the ioBroker data directory - Frigate then starts without its configuration
- (@GermanBluefox) Removed the `iobBackup=frigate_data` label: no volume of that name exists, so it never marked anything. The label works for named volumes only, and everything worth keeping lives in the bind-mounted Frigate directory - `config.yml` is generated from the instance settings, which an ioBroker backup contains anyway, and recordings and clips are far too large for one

## 3.1.1 (2026-08-24)
- (@GermanBluefox) Fixed the clip download failing with `Request failed with status code 400`: Frigate answers that while the recording segments of the event are not written yet, so the download is now retried with a growing delay and the message Frigate sent is written to the log instead of only the status code. The default wait time after the event end was raised from 5 to 10 seconds
- (@GermanBluefox) Added the missing translations for the LPR settings, the go2rtc restream column and the event history header, and corrected translations where the product name `Frigate`, state IDs and the `{{source}}`/`{{type}}` placeholders had been translated as words
- (@GermanBluefox) Fixed stale `.jpg` / `.mp4` files in the tmp folder: the cleanup no longer depends on `notificationActive`, aborted downloads and failed notifications no longer leave files behind, and every instance now uses its own tmp folder (`iobroker-frigate.<instance>`)
- (@GermanBluefox) Added a web extension: every camera is now served under `/frigate.0/<camera>/snapshot.jpg` and `/frigate.0/<camera>/stream.mjpeg` of the web adapter, behind the ioBroker authentication and without exposing Frigate itself
- (@GermanBluefox) Added two widgets for ioBroker.devices: a snapshot tile that works everywhere, and a live MJPEG tile
- (@GermanBluefox) Added the `snapshot` message, which returns the current picture of a camera as base64
- (Eistee82) Fixed zone object counters (e.g. `<zone>.person`) staying at their last value after the object left the zone. Per-zone object counts are now sourced solely from the Frigate MQTT occupancy topics, and the zone aggregator resets its active/stationary states to 0 and uses `current_zones` instead of the cumulative `entered_zones`.

## 3.0.3 (2026-06-09)
- (@GermanBluefox) Added a button to re-create the docker container

## 3.0.2 (2026-05-30)
- (@GermanBluefox) Replaced the track of objects with a drop down menu

## 3.0.0 (2026-05-16)
- (copilot) Adapter requires node.js >= 22 now
- (copilot) Added re-streaming support for live video feeds (experimental)
- (copilot) Added support for license plate recognition events from Frigate

## 2.3.2 (2026-04-14)
- (@GermanBluefox) Added support of shm_size

## 2.3.1 (2026-03-29)
- (Eistee82) Added Frigate API authentication support for port 8971 (username/password login with JWT)
- (Eistee82) Automatic token refresh on 401 responses

## 2.3.0 (2026-03-29)
- (Eistee82) Many new features, improvements, and bug fixes in development for the next major release (see 2.2.2)

## 2.3.0 (2026-03-29)
- (Eistee82) Many new features, improvements, and bug fixes in development for the next major release (see 2.2.2)

## 2.2.2 (2026-03-29)

**New Features:**
- (Eistee82) Added per-camera motion threshold control (`remote.motionThreshold`)
- (Eistee82) Added per-camera motion contour area control (`remote.motionContourArea`)
- (Eistee82) Added per-camera birdseye mode control (`remote.birdseyeMode`)
- (Eistee82) Added per-camera improve contrast toggle (`remote.improveContrast`)
- (Eistee82) Added Frigate notification control via MQTT (`notifications.enabled`, `notifications.suspend`)
- (Eistee82) Added automatic zone device creation from Frigate config
- (Eistee82) Audio details (dBFS, RMS, transcription, audio types) are now automatically available
- (Eistee82) Camera health status (detect/audio/record role status) is now automatically available
- (Eistee82) Classification states and review status are now automatically available

**Modernization:**
- (Eistee82) Migrated adapter to ESM (ECMAScript Modules) — requires js-controller >= 6.0.5
- (Eistee82) Upgraded aedes MQTT broker from 0.51 to 1.x
- (Eistee82) Replaced uuid dependency with built-in `crypto.randomUUID()`
- (Eistee82) Replaced json-bigint dependency with native `JSON.parse`
- (Eistee82) Refactored monolithic main.ts into focused modules
- (Eistee82) Include build directory in the repository for direct GitHub installation

**Bug Fixes:**
- (Eistee82) Fixed a critical bug: motion ON was always parsed as false due to operator precedence
- (Eistee82) Fixed snapshot notification missing image parameter
- (Eistee82) Fixed duplicate MQTT message processing in built-in broker mode
- (Eistee82) Fixed tmp directory cleanup deleting files from other programs
- (Eistee82) Converted synchronous filesystem operations to async
- (Eistee82) Debounced event history fetching to prevent excessive API calls
- (Eistee82) Improved error logging consistency across all catch blocks

## 2.2.1 (2026-03-29)
- (Eistee82) Added support for connecting to an external MQTT broker (e.g. Mosquitto) as an alternative to the built-in broker
- (Eistee82) Added configurable MQTT topic prefix
- (Eistee82) Added i18n translations for new MQTT configuration fields
- (mcm1957) dependencies have been updated

## 2.1.3 (2026-03-19)
- (@GermanBluefox) Remove a wrong log message about missing docker
- (@GermanBluefox) Send on connection the topic onConnect to receive camera_activity topic

## 2.1.2 (2026-03-14)
- (@GermanBluefox) Corrected the writing of ON/OFF states

## 2.1.1 (2026-03-08)
- (@GermanBluefox) Added threshold for person detection in notifications

## 2.1.0 (2026-03-07)
- (@GermanBluefox) Code optimizations and refactoring
- (copilot) missing jsonConfig sizes have been added
- (mcm1957) dependencies have been updated

## 2.0.2 (2026-02-16)
- (@GermanBluefox) Removed gpu_usages

## 2.0.0 (2026-02-16)
- (@GermanBluefox) Adapter was migrated to TypeScript
- (@GermanBluefox) Breaking change: All states with value ON/OFF were changed to boolean true/false
- (@GermanBluefox) Better handling of complex objects and arrays
- (@GermanBluefox) `path_data` is not parsed anymore
- (@GermanBluefox) Added еру possibility to start and manage docker with frigate from the adapter

## 1.4.0 (2026-01-26)

- (mcm1957) Adapter requires node.js 20 as minimum now.
- (TA2k) Remove path_data objects to prevent too many objects generated by the adapter

## 1.3.3 (2026-01-26)

- (copilot) Adapter requires js-controller >= 6.0.11 now
- (copilot) Adapter requires admin >= 7.6.17 now

- (mcm1957) Adapter requires admin 6.17.14 as minimum now.

## 1.3.2 (2025-05-06)

- (TA2k) remove path_data from v0.16
- (TA2k) move clip url from mp4 to m3u8
- (mcm1957) Adapter requires js-controller 5.0.19 as minimum now.
- (mcm1957) Several issues reported by the adapter checker have been fixed.

## 1.3.2 (2025-05-06)

- (TA2k) remove path_data from v0.16
- (TA2k) move clip url from mp4 to m3u8
- (mcm1957) Adapter requires js-controller 5.0.19 as minimum now.
- (mcm1957) Several issues reported by the adapter checker have been fixed.

## 1.3.1 (2024-08-30)

- fixed too many states

## 1.3.0 (2024-07-29)

- fix for frigate v0.14

## 1.2.1 (2024-06-06)

- add remote to restart frigate

## 1.2.0 (2024-04-10)

- add new notifications sending
- add pauseNotifications For Time

## 1.1.0 (2024-03-11)

- fix deleting of notification files
- add notification settings

## 1.0.2 (2024-01-29)

- reduce memory usage for clip notifications

## 1.0.1 (2024-01-28)

- fix frigate v12 camera fetching
- fix pushover notifications

## 1.0.0 (2024-01-26)

- New Version with new state structure. Please check you vis and scripts. The new version doesn't need the mqtt adapter and can send directly notification to telegram.
