![Logo](admin/frigate.png)

# ioBroker.frigate

[![NPM version](https://img.shields.io/npm/v/iobroker.frigate.svg)](https://www.npmjs.com/package/iobroker.frigate)
[![Downloads](https://img.shields.io/npm/dm/iobroker.frigate.svg)](https://www.npmjs.com/package/iobroker.frigate)
![Number of Installations](https://iobroker.live/badges/frigate-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/frigate-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.frigate.png?downloads=true)](https://nodei.co/npm/iobroker.frigate/)

**Tests:** ![Test and Release](https://github.com/iobroker-community-adapters/ioBroker.frigate/workflows/Test%20and%20Release/badge.svg)

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.** For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## frigate adapter for ioBroker

Adapter for Frigate Tool [Frigate Video](https://frigate.video/)

## Setup

- Enter Frigate url e.g. localhost:5000 or 192.168.178.2:5000
- Enter MQTT port: 1883 from the frigate config
- Enter host or ip of iobroker sytem in the frigate config under
  ```
  mqtt:
    host: ioBrokerIP
  ```
  After Starting Frigate and the Adapter you should see a new client conntected in the log

## Usage

#### stats

General Information about the system and cameras

#### events

Last Event with before and after information

History of the last X events

History event has a thumbnail of the event and url to the snapshot and clip

#### camera

Status and settings of the camera

Change state State to change the settings of the camera

[Detailed Information about all states](https://docs.frigate.video/integrations/mqtt/)

frigate.0.camera.motion:

Whether camera_name is currently detecting motion. Expected values are ON and OFF. NOTE: After motion is initially detected, ON will be set until no motion has been detected for mqtt_off_delay seconds (30 by default).

frigate.0.camera.person_snapshot:

Publishes a jpeg encoded frame of the detected object type. When the object is no longer detected, the highest confidence image is published or the original image is published again.
The height and crop of snapshots can be configured in the config.

## Notifcations

The adapter can send snapshots and clips from events and object detection to instances like telegram, pushover and signal-cbm

You can specify multiple instance or user to send snapshots or clips

Active the notification in the settings to receive the snapshots or clips

## Integrate in vis

You can integrate snapshots and clips in the vis:

Snapshot:

Add a `String img src` and use as Object Id: `frigate.0.camera.person_snapshot`

Add a `String img src` and use as Object Id: `frigate.0.events.history.01.thumbnail`

Clips:

Add a `HTML` add as HTML:

```
<video width="100%" height="auto" src="{frigate.0.events.history.01.webclip}" autoplay muted>
</video>
```

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- (TA2k) initial release

## License

MIT License

Copyright (c) 2024 TA2k <tombox2020@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
