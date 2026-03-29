![Logo](../../admin/frigate.png)

# ioBroker.frigate — Dokumentation

Adapter für [Frigate NVR](https://frigate.video/) — ein quelloffenes, selbst gehostetes Videoüberwachungssystem mit KI-gestützter Objekterkennung.

## Inhaltsverzeichnis

- [Einrichtung](#einrichtung)
  - [Eingebauter MQTT-Broker](#eingebauter-mqtt-broker-standard)
  - [Externer MQTT-Broker](#externer-mqtt-broker)
  - [Frigate API-Authentifizierung](#frigate-api-authentifizierung)
- [States-Referenz](#states-referenz)
  - [Statistiken](#statistiken)
  - [Events](#events)
  - [Kamera-States](#kamera-states)
  - [Kamera-Fernsteuerung](#kamera-fernsteuerung)
  - [Zonen](#zonen)
  - [Frigate Benachrichtigungssteuerung](#frigate-benachrichtigungssteuerung)
  - [Automatisch verfügbare States](#automatisch-verfügbare-states)
- [Benachrichtigungen](#benachrichtigungen)
  - [Unterstützte Dienste](#unterstützte-dienste)
  - [Konfiguration](#benachrichtigungs-konfiguration)
  - [Textvorlage](#textvorlage-für-benachrichtigungen)
- [Integration](#integration)
  - [vis-Integration](#vis-integration)
  - [Skripte & Automatisierung](#skripte--automatisierung)
- [Voraussetzungen](#voraussetzungen)
- [FAQ](#faq)

---

## Einrichtung

Der Adapter unterstützt zwei MQTT-Modi zur Kommunikation mit Frigate.

### Eingebauter MQTT-Broker (Standard)

Der Adapter betreibt einen eigenen MQTT-Broker. Frigate verbindet sich direkt damit.

1. Frigate-URL in den Adapter-Einstellungen eingeben (z.B. `192.168.178.2:5000`)
2. MQTT-Port festlegen (Standard: `1883`)
3. In Frigates `config.yml` die Verbindung zu ioBroker konfigurieren:

```yaml
mqtt:
  host: <ioBroker IP-Adresse>
  port: 1883
```

4. Frigate und den Adapter starten. Im Adapter-Log sollte "New client" erscheinen.

### Externer MQTT-Broker

Wenn bereits ein MQTT-Broker (z.B. Mosquitto) läuft, kann der Adapter sich als Client damit verbinden.

1. **MQTT-Modus** auf `Externer MQTT-Broker` stellen
2. Broker-Host eingeben (z.B. `192.168.1.100` oder `mqtt://192.168.1.100:1883`)
3. Optional Benutzername und Passwort eingeben
4. **MQTT-Topic-Prefix** setzen falls Frigate einen eigenen verwendet (Standard: `frigate`)
5. Frigate-URL wie gewohnt eingeben

### Frigate API-Authentifizierung

Wenn deine Frigate-Instanz Authentifizierung aktiviert hat (typischerweise auf Port 8971 mit HTTPS), kannst du den Adapter so konfigurieren, dass er sich automatisch anmeldet.

1. Frigate-URL mit `https://` Prefix eingeben (z.B. `https://192.168.178.26:8971`)
2. **Frigate Benutzername** und **Frigate Passwort** eingeben
3. Der Adapter meldet sich über `POST /api/login` an und verwendet den JWT-Token für alle API-Aufrufe

Wenn die Felder leer bleiben, wird kein Login durchgeführt und der Adapter funktioniert wie bisher (unauthentifizierter Zugriff auf Port 5000).

Der Adapter aktualisiert den Token automatisch wenn er abläuft (bei 401-Antwort wird erneut eingeloggt und der Request wiederholt).

**Hinweis:** Selbstsignierte Zertifikate werden akzeptiert. Wenn kein HTTPS verwendet wird, die URL ohne Prefix eingeben (z.B. `192.168.178.26:5000`) — der Adapter verwendet standardmäßig HTTP.

---

## States-Referenz

### Statistiken

`frigate.0.stats.*` — Allgemeine Systeminformationen, alle paar Sekunden aktualisiert.

| State | Beschreibung | Einheit |
|-------|-------------|---------|
| `stats.cameras.<name>.camera_fps` | Bilder pro Sekunde vom Kamera-Feed | fps |
| `stats.cameras.<name>.process_fps` | Verarbeitete Bilder pro Sekunde | fps |
| `stats.cameras.<name>.skipped_fps` | Übersprungene Bilder (Verarbeitungsüberlastung) | fps |
| `stats.cameras.<name>.detection_fps` | Objekterkennung pro Sekunde | fps |
| `stats.cameras.<name>.detection_enabled` | Objekterkennung aktiv | — |
| `stats.cameras.<name>.audio_dBFS` | Audio-Pegel | dBFS |
| `stats.cameras.<name>.audio_rms` | Audio-RMS-Amplitude | — |
| `stats.detectors.<name>.inference_speed` | Zeit pro Inferenz | ms |
| `stats.service.uptime` | Laufzeit des Dienstes | s |
| `stats.service.version` | Frigate-Version | — |
| `stats.service.storage.<mount>.total` | Gesamtspeicher | MB |
| `stats.service.storage.<mount>.used` | Belegter Speicher | MB |
| `stats.service.storage.<mount>.free` | Freier Speicher | MB |

### Events

`frigate.0.events.*` — Letztes Event mit Vorher/Nachher-Informationen.

| State | Beschreibung |
|-------|-------------|
| `events.after.camera` | Kamera die das Event erkannt hat |
| `events.after.label` | Objekttyp (person, car, etc.) |
| `events.after.top_score` | Höchster Konfidenzwert |
| `events.after.has_snapshot` | Snapshot verfügbar |
| `events.after.has_clip` | Clip verfügbar |
| `events.history.json` | JSON-Array der letzten X Events |

Jedes Event in der History enthält URLs für Snapshots und Clips:
- `websnap` — Snapshot-URL
- `webclip` — Clip-URL (MP4)
- `webm3u8` — HLS-Stream-URL
- `thumbnail` — Base64-kodiertes Vorschaubild

### Kamera-States

`frigate.0.<kamera_name>.*` — Status und Erkennungs-States pro Kamera.

| State | Typ | Schreibbar | Beschreibung |
|-------|-----|-----------|-------------|
| `<cam>.motion` | boolean | nein | Bewegung erkannt |
| `<cam>.person` | number | nein | Anzahl erkannter Personen |
| `<cam>.car` | number | nein | Anzahl erkannter Autos |
| `<cam>.person_snapshot` | string | nein | Base64-JPEG der letzten Person |
| `<cam>.detect_state` | boolean | ja | Objekterkennung ein/aus |
| `<cam>.recordings_state` | boolean | ja | Aufnahmen ein/aus |
| `<cam>.snapshots_state` | boolean | ja | Snapshots ein/aus |
| `<cam>.audio_state` | boolean | ja | Audioerkennung ein/aus |
| `<cam>.birdseye_state` | boolean | ja | Birdseye-Ansicht ein/aus |
| `<cam>.birdseye_mode_state` | string | ja | Birdseye-Modus (objects/continuous/motion) |
| `<cam>.review_status` | string | nein | Aktivitätslevel (NONE/DETECTION/ALERT) |

### Kamera-Fernsteuerung

`frigate.0.<kamera_name>.remote.*` — Schreibbare States zur Kamerasteuerung.

| State | Typ | Beschreibung |
|-------|-----|-------------|
| `remote.ptz` | string | PTZ-Befehle (z.B. `preset_preset1`, `MOVE_LEFT`, `ZOOM_IN`, `STOP`) |
| `remote.createEvent` | string | Manuelles Event mit Label erstellen |
| `remote.createEventBody` | string | JSON-Body für manuelle Event-Erstellung |
| `remote.motionThreshold` | number | Bewegungserkennungs-Schwellwert (1-255) |
| `remote.motionContourArea` | number | Minimale Konturfläche für Bewegung |
| `remote.birdseyeMode` | string | Birdseye-Modus (objects, continuous, motion) |
| `remote.improveContrast` | boolean | Kontrastverbesserung für Erkennung |
| `remote.pauseNotifications` | boolean | Benachrichtigungen für diese Kamera pausieren |
| `remote.pauseNotificationsForTime` | number | Benachrichtigungen für X Minuten pausieren |
| `remote.notificationText` | string | Eigener Benachrichtigungstext für diese Kamera |
| `remote.notificationMinScore` | number | Eigener Mindest-Score für Benachrichtigungen |

### Zonen

Zonen-Geräte werden automatisch aus der Frigate-Konfiguration erstellt. Der Adapter aggregiert Objektzähler über alle Kameras die sich eine Zone teilen.

| State | Typ | Beschreibung |
|-------|-----|-------------|
| `<zone>.person` | number | Personen in der Zone gesamt (alle Kameras) |
| `<zone>.person_active` | number | Sich aktiv bewegende Personen |
| `<zone>.person_stationary` | number | Stehende Personen |
| `<zone>.car` | number | Autos in der Zone gesamt |
| `<zone>.total_objects` | number | Gesamtzahl aller Objekte |
| `<zone>.active` | boolean | Irgendein Objekt in der Zone erkannt |

Beispiel: Wenn die Kameras `klingel` und `vorgarten` beide die Zone `Vorgarten` haben und jede eine Person erkennt, dann ist `Vorgarten.person` = 2.

### Frigate Benachrichtigungssteuerung

`frigate.0.notifications.*` — Steuerung des Frigate-eigenen Benachrichtigungssystems.

| State | Typ | Schreibbar | Beschreibung |
|-------|-----|-----------|-------------|
| `notifications.enabled` | boolean | ja | Frigate-Benachrichtigungen ein/aus |
| `notifications.suspend` | number | ja | Für X Minuten unterbrechen |
| `notifications.suspended` | number | nein | UNIX-Zeitstempel wann Unterbrechung endet |

### Automatisch verfügbare States

Diese States werden automatisch erstellt wenn Frigate die entsprechenden MQTT-Topics publiziert:

| State | Beschreibung |
|-------|-------------|
| `<cam>.audio_dBFS` | Audio-Pegel in dBFS |
| `<cam>.audio_rms` | Audio-RMS-Pegel |
| `<cam>.audio_transcription` | Transkribierter Audio-Text |
| `<cam>.audio_<typ>` | Audio-Typ-Erkennung (speech, bark, etc.) |
| `<cam>.status_detect` | Zustand der Detect-Rolle (online/offline/disabled) |
| `<cam>.status_audio` | Zustand der Audio-Rolle |
| `<cam>.status_record` | Zustand der Record-Rolle |
| `<cam>.classification_<modell>` | Klassifizierungsergebnisse |
| `<cam>.ptz_autotracker_active` | PTZ-Autotracker aktiv |

---

## Benachrichtigungen

Der Adapter kann Snapshots und Clips von Events an Nachrichtendienste senden.

### Unterstützte Dienste

- Telegram
- Pushover (nur Snapshots, kein Video)
- Signal (signal-cmb)
- E-Mail (mail)
- Jeder andere ioBroker-Messaging-Adapter

### Benachrichtigungs-Konfiguration

1. Benachrichtigungen in den Adapter-Einstellungen aktivieren
2. Eine oder mehrere Benachrichtigungs-Instanzen eingeben (z.B. `telegram.0`)
3. Optional Benutzernamen/IDs für gezielte Zustellung eingeben
4. Mindest-Score-Schwellwert festlegen (0 = deaktiviert)

Clips werden nach der konfigurierten Wartezeit (Standard: 5 Sekunden) nach Event-Ende gesendet.

**Wichtig:** Die Benachrichtigungs-Instanz (z.B. telegram.0) und der Frigate-Adapter müssen auf dem gleichen Host laufen, da Dateien über das lokale Dateisystem übergeben werden.

### Textvorlage für Benachrichtigungen

Verwende Platzhalter in deinem Benachrichtigungstext:

| Platzhalter | Beschreibung |
|-------------|-------------|
| `{{source}}` | Kameraname |
| `{{type}}` | Objekttyp (person, car, etc.) |
| `{{state}}` | Event-Zustand (Event Before/Event After) |
| `{{status}}` | Event-Status (new/update/end) |
| `{{score}}` | Konfidenzwert |
| `{{zones}}` | Betretene Zonen (kommagetrennt) |

Beispiel: `{{source}}: {{type}} erkannt ({{score}}) in {{zones}}`

---

## Integration

### vis-Integration

**Snapshot:**
```
String img src → Object ID: frigate.0.kamera_name.person_snapshot
String img src → Object ID: frigate.0.events.history.01.thumbnail
```

**Clip:**
```html
<video width="100%" height="auto" src="{frigate.0.events.history.01.webclip}" autoplay muted></video>
```

**Personenanzahl:**
```
Value → Object ID: frigate.0.kamera_name.person
```

**Zonen-Aktivität:**
```
Indicator → Object ID: frigate.0.Vorgarten.active
Value → Object ID: frigate.0.Vorgarten.person
```

### Skripte & Automatisierung

Beispiel: Licht einschalten wenn Person in Zone erkannt wird:

```javascript
on({ id: 'frigate.0.Vorgarten.active', val: true }, () => {
    setState('hm-rpc.0.ABC1234567.1.STATE', true);
    log('Person im Vorgarten erkannt');
});
```

Beispiel: Benachrichtigung senden wenn Personenanzahl in Zone Schwellwert überschreitet:

```javascript
on({ id: 'frigate.0.Vorgarten.person', change: 'ne' }, (obj) => {
    if (obj.state.val >= 3) {
        sendTo('telegram.0', { text: `Warnung: ${obj.state.val} Personen im Vorgarten!` });
    }
});
```

---

## Voraussetzungen

| Komponente | Mindestversion |
|------------|---------------|
| Node.js | >= 20 |
| js-controller | >= 6.0.5 |
| Admin | >= 7.7.29 |
| Frigate | >= 0.14 |

---

## FAQ

**F: Der Adapter zeigt "cannot find start file" bei Installation von GitHub.**
A: Diese Version enthält das Build-Verzeichnis. Falls der Fehler trotzdem auftritt, führe `npm run build` im Adapter-Verzeichnis aus.

**F: Zonen-Geräte sind leer.**
A: Zonen-States werden erst erstellt wenn Frigate Objekte in diesen Zonen erkennt. Warte auf ein Event in der Zone.

**F: Ich bekomme ENOENT-Fehler bei Snapshots/Clips.**
A: Dieses Problem wurde in v2.3.0 behoben. Aktualisiere auf die neueste Version.

**F: Wie ändere ich den Bewegungserkennungs-Schwellwert?**
A: Setze `frigate.0.<kamera>.remote.motionThreshold` auf einen Wert zwischen 1-255.

**F: Benachrichtigungen werden nicht gesendet.**
A: Stelle sicher, dass die Benachrichtigungs-Instanz (z.B. telegram.0) auf dem gleichen Host wie der Frigate-Adapter läuft. Prüfe ob Benachrichtigungen in den Adapter-Einstellungen aktiviert sind.
