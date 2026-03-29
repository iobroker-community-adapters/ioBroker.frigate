import { ON_OFF_STATES } from './constants.js';
export async function handleStateChange(ctx, id, state) {
    if (!state || state.ack) {
        return;
    }
    ctx.adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
    if (id.endsWith('_state')) {
        id = id.replace(`${ctx.adapter.namespace}.`, '');
        id = id.replace('_state', '');
        const idArray = id.split('.');
        if (ON_OFF_STATES.includes(idArray[idArray.length - 1])) {
            if (state.val === 'true' ||
                state.val === true ||
                state.val === 'ON' ||
                state.val === 'on' ||
                state.val === '1' ||
                state.val === 1) {
                state.val = 'ON';
            }
            else {
                state.val = 'OFF';
            }
        }
        const pathArray = [ctx.adapter.config.mqttTopicPrefix || 'frigate', ...idArray, 'set'];
        const topic = pathArray.join('/');
        ctx.adapter.log.debug(`publish sending to "${topic}" ${state.val}`);
        ctx.publishMqtt(topic, String(state.val ?? ''), err => {
            if (err) {
                ctx.adapter.log.error(err.toString());
            }
            else {
                ctx.adapter.log.info(`published "${topic}" ${state.val}`);
            }
        });
    }
    else if (id.endsWith('remote.createEvent')) {
        const cameraId = id.split('.')[2];
        const label = state.val;
        let body = '';
        const createEventBodyState = await ctx.adapter.getStateAsync(id.replace('createEvent', 'createEventBody'));
        if (createEventBodyState?.val) {
            try {
                body = JSON.parse(createEventBodyState.val);
            }
            catch (error) {
                ctx.adapter.log.error('Cannot parse createEventBody. Please use valid JSON https://docs.frigate.video/integrations/api/#post-apieventscamera_namelabelcreate');
                ctx.adapter.log.error(error instanceof Error ? error.message : String(error));
            }
        }
        const encodedCameraId = encodeURIComponent(cameraId);
        const encodedLabel = encodeURIComponent(label != null ? label.toString() : '');
        ctx.requestClient({
            url: `http://${ctx.adapter.config.friurl}/api/events/${encodedCameraId}/${encodedLabel}/create`,
            method: 'post',
            data: body,
        })
            .then(response => {
            ctx.adapter.log.info(`Create event for ${cameraId} with label ${label}`);
            ctx.adapter.log.info(JSON.stringify(response.data));
        })
            .catch(error => {
            ctx.adapter.log.warn(`createEvent error from http://${ctx.adapter.config.friurl}/api/events`);
            ctx.adapter.log.error(error instanceof Error ? error.message : String(error));
        });
    }
    else if (id.endsWith('remote.restart') && state.val) {
        const restartTopic = `${ctx.adapter.config.mqttTopicPrefix || 'frigate'}/restart`;
        ctx.publishMqtt(restartTopic, '', err => {
            if (err) {
                ctx.adapter.log.error(err.toString());
            }
            else {
                ctx.adapter.log.info(`published ${restartTopic}`);
            }
        });
    }
    else if (id.endsWith('remote.ptz') && state.val !== null) {
        const cameraId = id.split('.')[2];
        const command = state.val.toString();
        const ptzTopic = `${ctx.adapter.config.mqttTopicPrefix || 'frigate'}/${cameraId}/ptz`;
        ctx.publishMqtt(ptzTopic, command, err => {
            if (err) {
                ctx.adapter.log.error(err.toString());
            }
            else {
                ctx.adapter.log.info(`published ${ptzTopic} ${command}`);
            }
        });
    }
    else if (id.endsWith('remote.motionThreshold') && state.val !== null) {
        const cameraId = id.split('.')[2];
        const prefix = ctx.adapter.config.mqttTopicPrefix || 'frigate';
        const topic = `${prefix}/${cameraId}/motion_threshold/set`;
        ctx.publishMqtt(topic, String(state.val), err => {
            if (err) {
                ctx.adapter.log.error(err.toString());
            }
            else {
                ctx.adapter.log.info(`published ${topic} ${state.val}`);
            }
        });
    }
    else if (id.endsWith('remote.motionContourArea') && state.val !== null) {
        const cameraId = id.split('.')[2];
        const prefix = ctx.adapter.config.mqttTopicPrefix || 'frigate';
        const topic = `${prefix}/${cameraId}/motion_contour_area/set`;
        ctx.publishMqtt(topic, String(state.val), err => {
            if (err) {
                ctx.adapter.log.error(err.toString());
            }
            else {
                ctx.adapter.log.info(`published ${topic} ${state.val}`);
            }
        });
    }
    else if (id.endsWith('remote.birdseyeMode') && state.val !== null) {
        const cameraId = id.split('.')[2];
        const prefix = ctx.adapter.config.mqttTopicPrefix || 'frigate';
        const topic = `${prefix}/${cameraId}/birdseye_mode/set`;
        ctx.publishMqtt(topic, String(state.val), err => {
            if (err) {
                ctx.adapter.log.error(err.toString());
            }
            else {
                ctx.adapter.log.info(`published ${topic} ${state.val}`);
            }
        });
    }
    else if (id.endsWith('remote.improveContrast')) {
        const cameraId = id.split('.')[2];
        const prefix = ctx.adapter.config.mqttTopicPrefix || 'frigate';
        const topic = `${prefix}/${cameraId}/improve_contrast/set`;
        const val = state.val === true || state.val === 'true' || state.val === 1 ? 'ON' : 'OFF';
        ctx.publishMqtt(topic, val, err => {
            if (err) {
                ctx.adapter.log.error(err.toString());
            }
            else {
                ctx.adapter.log.info(`published ${topic} ${val}`);
            }
        });
    }
    else if (id.endsWith('notifications.enabled')) {
        const prefix = ctx.adapter.config.mqttTopicPrefix || 'frigate';
        const topic = `${prefix}/notifications/set`;
        const val = state.val === true || state.val === 'true' || state.val === 1 ? 'ON' : 'OFF';
        ctx.publishMqtt(topic, val, err => {
            if (err) {
                ctx.adapter.log.error(err.toString());
            }
            else {
                ctx.adapter.log.info(`published ${topic} ${val}`);
            }
        });
    }
    else if (id.endsWith('notifications.suspend') && state.val !== null) {
        const prefix = ctx.adapter.config.mqttTopicPrefix || 'frigate';
        const topic = `${prefix}/notifications/suspend`;
        ctx.publishMqtt(topic, String(state.val), err => {
            if (err) {
                ctx.adapter.log.error(err.toString());
            }
            else {
                ctx.adapter.log.info(`published ${topic} ${state.val}`);
            }
        });
    }
    else if (id.endsWith('remote.pauseNotificationsForTime')) {
        const pauseTime = parseInt(state.val, 10) || 10;
        const pauseId = id
            .replace('pauseNotificationsForTime', 'pauseNotifications')
            .replace(`${ctx.adapter.name}.${ctx.adapter.instance}.`, '');
        await ctx.adapter.setStateAsync(pauseId, true, true);
        let deviceId = id.split('.')[2];
        if (deviceId === 'remote') {
            deviceId = 'all';
        }
        ctx.adapter.log.info(`Pause ${deviceId} notifications for ${pauseTime} minutes`);
        ctx.adapter.setTimeout(async () => {
            await ctx.adapter.setState(pauseId, false, true);
            ctx.adapter.log.info('Pause All notifications ended');
        }, pauseTime * 60 * 1000);
    }
}
//# sourceMappingURL=stateHandler.js.map