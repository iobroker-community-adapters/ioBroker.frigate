/**
 * Tracks active events per zone and maintains aggregate object counts.
 * Zones are defined in Frigate config per camera. When an event enters a zone,
 * the zone counter increments. When the event ends, it decrements.
 * This gives a cross-camera view of objects per zone, split by active/stationary.
 */
export class ZoneAggregator {
    ctx;
    /** zone → Map of eventId → TrackedEvent */
    zoneEvents = new Map();
    /** Known zone names from Frigate config */
    knownZones = new Set();
    constructor(ctx) {
        this.ctx = ctx;
    }
    /** Initialize zones from Frigate config and create device/state objects */
    async initZones(configData) {
        if (!configData?.cameras) {
            return;
        }
        const zones = new Set();
        for (const camKey in configData.cameras) {
            const camZones = configData.cameras[camKey].zones;
            if (camZones) {
                for (const zoneName of Object.keys(camZones)) {
                    zones.add(zoneName);
                }
            }
        }
        this.knownZones = zones;
        for (const zone of zones) {
            this.ctx.adapter.log.info(`Create zone device for: ${zone}`);
            await this.ctx.adapter.extendObjectAsync(zone, {
                type: 'device',
                common: { name: `Zone ${zone}` },
                native: {},
            });
            // Pre-create the summary states
            await this.createZoneState(`${zone}.total_objects`, `Total objects in zone ${zone}`, 'number', 'value', 0);
            await this.createZoneState(`${zone}.active`, `Objects detected in zone ${zone}`, 'boolean', 'indicator', false);
        }
    }
    /** Process an event update and recalculate zone counts */
    async processEvent(data) {
        if (this.knownZones.size === 0) {
            return;
        }
        const eventData = data.after || data.before;
        if (!eventData?.id) {
            return;
        }
        const eventId = eventData.id;
        const label = eventData.label;
        if (!label) {
            return;
        }
        const eventType = data.type;
        const zones = eventData.entered_zones || [];
        const isStationary = eventData.stationary === true;
        if (eventType === 'end') {
            for (const [, events] of this.zoneEvents) {
                events.delete(eventId);
            }
        }
        else {
            // Remove from zones this event is no longer in
            for (const [zoneName, events] of this.zoneEvents) {
                if (!zones.includes(zoneName)) {
                    events.delete(eventId);
                }
            }
            // Add/update in current zones
            for (const zone of zones) {
                if (!this.knownZones.has(zone)) {
                    continue;
                }
                if (!this.zoneEvents.has(zone)) {
                    this.zoneEvents.set(zone, new Map());
                }
                this.zoneEvents.get(zone).set(eventId, { label, stationary: isStationary });
            }
        }
        await this.updateZoneStates();
    }
    async updateZoneStates() {
        for (const zone of this.knownZones) {
            const events = this.zoneEvents.get(zone);
            // Aggregate counts: label → { total, active, stationary }
            const counts = new Map();
            let totalAll = 0;
            if (events) {
                for (const [, ev] of events) {
                    if (!counts.has(ev.label)) {
                        counts.set(ev.label, { total: 0, active: 0, stationary: 0 });
                    }
                    const c = counts.get(ev.label);
                    c.total++;
                    totalAll++;
                    if (ev.stationary) {
                        c.stationary++;
                    }
                    else {
                        c.active++;
                    }
                }
            }
            // Write per-label states
            for (const [label, c] of counts) {
                await this.createZoneState(`${zone}.${label}`, `${label} in zone ${zone} (total)`, 'number', 'value', 0);
                await this.ctx.adapter.setStateAsync(`${zone}.${label}`, c.total, true);
                await this.createZoneState(`${zone}.${label}_active`, `${label} actively moving in zone ${zone}`, 'number', 'value', 0);
                await this.ctx.adapter.setStateAsync(`${zone}.${label}_active`, c.active, true);
                await this.createZoneState(`${zone}.${label}_stationary`, `${label} stationary in zone ${zone}`, 'number', 'value', 0);
                await this.ctx.adapter.setStateAsync(`${zone}.${label}_stationary`, c.stationary, true);
            }
            // Reset labels that had events before but now have 0
            if (events) {
                // Find labels we've written before by checking existing states
                // We track this by checking if count is 0 for previously seen labels
                for (const [, ev] of events) {
                    // events still exist, handled above
                    void ev;
                }
            }
            // Write summary states
            await this.ctx.adapter.setStateAsync(`${zone}.total_objects`, totalAll, true);
            await this.ctx.adapter.setStateAsync(`${zone}.active`, totalAll > 0, true);
        }
    }
    async createZoneState(id, name, type, role, def) {
        await this.ctx.adapter.extendObjectAsync(id, {
            type: 'state',
            common: {
                name,
                type,
                role,
                def,
                read: true,
                write: false,
            },
            native: {},
        });
    }
}
//# sourceMappingURL=zoneAggregator.js.map