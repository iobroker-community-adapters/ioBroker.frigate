# Older changes
## 3.2.2 (2026-10-07)
- (@GermanBluefox) Added a link to the web interface of Frigate, on the instance in admin and as a card on the intro page. It points at the address the adapter itself talks to (`friurl`); with the default `localhost:5000`, admin 8.0.24 and newer open it on the host the instance runs on instead of on the machine of the browser. With Frigate in a container of the adapter, the link follows the stored address and not the port of the container, where the two differ

## 3.2.1 (2026-09-28)
- (@GermanBluefox) In broker mode the adapter reports the port of its built-in MQTT broker to js-controller 8, which keeps a per-host registry of the occupied ports (`system.host.<name>.usedResources`). The default 1883 is also the default of the MQTT adapter, so the log now names the instance that already declared the port instead of only reporting "port is already in use". The port is taken from the running server and given back when it closes. In client mode nothing is reported: the broker is on another machine. An older js-controller is unaffected
- (@GermanBluefox) The fullscreen dialog of the camera widgets for `ioBroker.devices` opened as a bare strip with some cameras: the dialog takes its height from the picture in it, and a picture that has not arrived yet is zero pixels high. The dialog now keeps a place for it and shows that it is on its way. The live widget also stops the stream of the tile for as long as the dialog is open - a browser grants about six connections per server, every camera tile holds one of them for as long as its stream runs, and the stream of the dialog was therefore the one that never got a turn. A stream that still brings no frame within ten seconds is given up on, and the pictures come over the socket instead, as they already did when a stream reported an error

## 3.2.0 (2026-09-22)
- (@GermanBluefox) The live widget for `ioBroker.devices` still tried the stream relative to admin (port 8081) when the adapter did not report the address of the web instance in time. Without an address the widget now takes single pictures over the socket and tells the reason in the browser console; an address that arrives late still switches to the stream
- (@GermanBluefox) Added the names Frigate recognizes (face recognition, known license plates): `<zone>.sub_labels` lists the names in a zone right now, and `sub_labels.<name>` is `true` as long as a running event carries that name. With face recognition enabled, the names of the face library are created on start, so automations can be set up before somebody is recognized for the first time (#277)
- (@GermanBluefox) Fixed repochecker warnings: literal placeholders of the settings dialog are in the translation files, and dependabot also watches `src-devices`

## 3.1.5 (2026-09-22)
- (@GermanBluefox) The live widget for `ioBroker.devices` did not show the stream in admin: before the adapter had reported the address of the web instance, the widget already loaded the stream relative to admin (port 8081), and the error of that attempt stayed on the tile even after the right address had arrived. The widget now waits for the address, and if the stream still cannot be loaded (web instance not reachable, http stream inside an https admin), it switches to single pictures over the socket

## 3.1.4 (2026-09-14)
- (@GermanBluefox) The live widget for `ioBroker.devices` switches to single pictures over the socket by itself when the page is opened through the ioBroker cloud (iobroker.pro / iobroker.net): the cloud cannot relay the MJPEG stream, and the address of the web instance is not reachable from outside anyway

## 3.1.3 (2026-09-09)
- (@GermanBluefox) The camera name in the device manager tile moved below the picture: at the top of the tile the drag handle and the favourite star of the widget manager were drawn over it
- (@GermanBluefox) The build helper is written in TypeScript itself now.

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
