/**
 * The answer of `help`: what the instance answers, written for an AI agent (e.g. ioBroker.pi-agent, or
 * the MCP server with `send_to`) and for script authors. Keep it in sync with `onMessage` in main.ts and the docs.
 */

/** The commands `onMessage` answers; `write`: the command has an effect beyond returning information */
export const COMMANDS: { command: string; write: boolean }[] = [
    { command: 'help', write: false },
    { command: 'frigate:getCameras', write: false },
    { command: 'snapshot', write: false },
    { command: 'frigate:getWebUrl', write: false },
    { command: 'restartContainer', write: true },
    { command: 'recreateContainer', write: true },
    { command: 'showLink', write: false },
    { command: 'readConfig', write: false },
];

export const HELP = `ioBroker.frigate: connects Frigate NVR (video surveillance with object detection) over MQTT and its
API. It reports per camera motion, the detected objects (person, car ...), their snapshots, events, reviews,
zones, recognized names, camera activity and statistics as states, switches detection, recording and
snapshots per camera, and gives the current picture of a camera. An agent can look at a camera, read what
was detected where and when, and switch these functions on the user's request.

Commands (sendTo frigate.0):
- frigate:getCameras: the cameras: [{value, label}], both the Frigate name of the camera (e.g. "driveway").
- snapshot {camera, height?, quality?, bbox?, timestamp?} (or just the camera name as a string): the current
  frame of a camera from Frigate: {data, contentType}; data = the JPEG as base64 (no "data:" prefix).
  camera (string, required): the Frigate name (letters, digits, _ and -). height (pixels, default the size of
  the camera; the width follows). quality (JPEG quality 1-100, default of Frigate). bbox (boolean): Frigate draws
  the boxes of the detected objects. timestamp (boolean): Frigate draws the time. Errors: {error} (invalid camera
  name, no Frigate URL set, Frigate not reachable).
- frigate:getWebUrl {hostname?}: where ioBroker.web serves the cameras: {url, route, reason?}, e.g. url
  "http://192.168.1.5:8082", route "frigate.0/"; <url>/<route><camera>/snapshot.jpg is the current picture and
  <url>/<route><camera>/stream.mjpeg the live stream. url "" with reason disabled, noInstance, noAddress or error.
  hostname = the host name the browser uses for ioBroker (picks the matching address).
- restartContainer: restarts the Frigate Docker container (only if the adapter runs Frigate in Docker):
  {result} or {error}. recreateContainer: deletes the container and restarts the instance, which creates it
  again: {result} or {error}.
- help: this text and the list of commands with their write flag.
- showLink, readConfig: for the settings, not for agents.

States (frigate.0.*), <cam> = the Frigate name of a camera, <zone> = a zone of Frigate:
- available: "online" / "offline" (Frigate).
- <cam>.motion (true while there is motion), <cam>.<label> (number of objects of that label now, e.g.
  <cam>.person, <cam>.car), <cam>.<label>_snapshot (the last picture of that label, "data:image/jpeg;base64,..."),
  <cam>.review_status (NONE, DETECTION, ALERT), <cam>.status_detect / status_record / status_audio (health).
- events.type (new, update, end) and events.before.* / events.after.*: the last event (after.camera, after.label,
  after.sub_label, after.top_score, after.start_time, after.end_time (seconds since 1970), after.current_zones,
  after.has_snapshot, after.has_clip). events.history.json: the last events of all cameras
  as JSON (id, camera, label, sub_label, start_time, end_time, zones, websnap, webclip, thumbnail); the same
  numbered in events.history.01.* and per camera in <cam>.history.01.*. websnap / webclip are URLs of Frigate.
- reviews.type, reviews.after.*: the last review item (camera, severity alert or detection, start_time,
  end_time, data.objects, data.zones). camera_activity.<cam>.*: the activity Frigate reports per camera.
- <zone>.<label> and <zone>.all (objects in the zone now), <zone>.active (anything in the zone),
  <zone>.<label>_active / _stationary, <zone>.total_objects, <zone>.sub_labels (names recognized there now).
- sub_labels.<name>: true while a running event carries this name (face or license plate recognized).
- tracked_objects.history: JSON of the last 10 updates of tracked objects (e.g. GenAI descriptions, faces).
- stats.*: Frigate statistics (stats.cameras.<cam>.camera_fps / detection_fps, stats.service.version,
  stats.service.storage.<mount>.used / free in MB, stats.detectors.<name>.inference_speed in ms).
- Writable (ack false): <cam>.<feature>_state for detect, recordings, snapshots, audio, motion, enabled,
  birdseye, improve_contrast, ptz_autotracker, review_alerts, review_detections, object_descriptions,
  review_descriptions (true = ON, false = OFF), <cam>.birdseye_mode_state (objects, continuous, motion),
  <cam>.motion_threshold_state, <cam>.motion_contour_area_state (numbers): the adapter sends them to Frigate;
  <cam>.remote.ptz (e.g. preset_<name>, MOVE_LEFT, MOVE_RIGHT, MOVE_UP, MOVE_DOWN, ZOOM_IN, ZOOM_OUT, STOP),
  <cam>.remote.createEvent (a label: creates a manual event, body from <cam>.remote.createEventBody),
  <cam>.remote.motionThreshold, motionContourArea, birdseyeMode, improveContrast,
  <cam>.remote.pauseNotificationsForTime / remote.pauseNotificationsForTime (minutes: pause the notifications
  of the adapter for a camera / for all), notifications.enabled and notifications.suspend (minutes): the
  notifications of Frigate itself; remote.restart (true restarts Frigate).
  A _state value exists only after Frigate reported it.

How to talk to the user:
- Name cameras and zones by their names as the user does ("driveway"), times in local time.
- Look at a snapshot and say what it shows: people, vehicles, animals, an open door or gate, packages, light and
  weather; say when it is too dark or blurred to tell. Get a new one for a question about now.
- Use height 720 or less: the whole JPEG comes back as base64 in the answer.
- Pictures of cameras are private: do not send them to other people (messenger, e-mail) or to another adapter
  unless the user asked for exactly that.
- Switching detection, recordings, snapshots or notifications off, PTZ moves, creating events, restarting
  Frigate (remote.restart, restartContainer) and recreateContainer: only on the user's explicit request; ask
  before turning off recording or detection of a camera.`;
