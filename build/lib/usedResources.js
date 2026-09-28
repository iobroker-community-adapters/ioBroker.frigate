/*
 * Reports the TCP port the built-in MQTT broker listens on to the per-host registry of exclusive
 * resources js-controller 8 keeps (`system.host.<hostname>.usedResources.<type>`).
 *
 * The registry answers "which port is already spoken for on this host". That matters here: in broker
 * mode this adapter binds 1883 by default - the same port the MQTT adapter serves on - and the
 * failure is an EADDRINUSE that does not say who got there first. js-controller derives an entry for
 * an adapter that declares nothing, but only from `native.port`, and this adapter keeps its port in
 * `native.mqttPort`, so nothing would be listed at all.
 *
 * In client mode nothing is reported: the broker is somewhere else, this host occupies nothing.
 *
 * Nothing in this module is required for the adapter to work - every failure is logged and swallowed.
 */
/** Feature a js-controller announces once it maintains the registry. Since js-controller 8. */
const USED_RESOURCES_FEATURE = 'CONTROLLER_USED_RESOURCES';
/**
 * Addresses that stand for every interface. A socket bound to one of them occupies the port in both
 * address families (a wildcard listener is dual-stack), so the family must not be reported for it.
 */
const WILDCARD_ADDRESSES = ['0.0.0.0', '::', '*', ''];
/**
 * Log without ever throwing.
 *
 * A free arrives while the adapter is being torn down, at which point its logger can already be
 * gone. A throwing log statement in one of these calls would end up as a rejection nobody listens
 * to, which terminates the adapter - a lot of damage for a line that only says a port was reported.
 *
 * @param adapter the ioBroker adapter
 * @param level the log level to write with
 * @param message what to write
 */
function log(adapter, level, message) {
    try {
        adapter.log[level](message);
    }
    catch {
        // There is nothing left that could report this
    }
}
/**
 * How a port is named in the log. An IPv6 address is bracketed, otherwise its own colons run into
 * the one before the port (`:::1883`).
 *
 * @param data the port and the address it is bound to
 */
function describe(data) {
    if (!data.bind) {
        return `${data.port}`;
    }
    return data.bind.includes(':') ? `[${data.bind}]:${data.port}` : `${data.bind}:${data.port}`;
}
/**
 * Whether this instance may report its used resources to the host.
 *
 * All three reasons against it are perfectly normal - an older controller, an adapter built against
 * an older `@iobroker/adapter-core`, an instance that leaves the registry to the controller - so
 * none is worth more than a debug line. A host that knows no `registerUsedResource` does not refuse
 * the call, it simply never answers it, so every single one would first sit out the five second
 * timeout of the adapter API. That is why the feature is asked for before anything is sent.
 *
 * @param adapter the ioBroker adapter
 */
function canReportUsedResources(adapter) {
    const api = adapter;
    if (typeof api.registerUsedResource !== 'function' || typeof api.freeUsedResource !== 'function') {
        // Told apart from the feature below only to name the half that is missing: this one can be
        // fixed by the adapter, by updating its @iobroker/adapter-core
        log(adapter, 'debug', 'Used resources are not reported: @iobroker/adapter-core is older than js-controller 8');
        return false;
    }
    if (typeof api.supportsFeature !== 'function' || !api.supportsFeature(USED_RESOURCES_FEATURE)) {
        log(adapter, 'debug', `Used resources are not reported: js-controller keeps no registry of used resources (feature "${USED_RESOURCES_FEATURE}")`);
        return false;
    }
    if (adapter.common?.declareUsedResources !== true) {
        // The host would refuse the registration in this case, and asking it first only to be told
        // so costs a message round-trip
        log(adapter, 'debug', 'Used resources are not reported: "common.declareUsedResources" is not true in io-package.json');
        return false;
    }
    return true;
}
/**
 * Report a TCP port as occupied by this instance.
 *
 * The host drops what this instance registered before whenever it starts, so a stale registration of
 * a previous configuration cannot survive a restart.
 *
 * @param adapter the ioBroker adapter
 * @param data the port, and the address it is bound to if it is not every interface
 * @returns whether the host accepted the registration
 */
export async function registerUsedPort(adapter, data) {
    if (!canReportUsedResources(adapter)) {
        return false;
    }
    try {
        await adapter.registerUsedResource('tcpPort', data);
        log(adapter, 'debug', `Registered TCP port ${describe(data)} as used by this instance`);
        return true;
    }
    catch (e) {
        log(adapter, 'warn', `Could not register TCP port ${describe(data)} as used: ${e.message}`);
        return false;
    }
}
/**
 * Take a previously reported TCP port back.
 *
 * `data` is a filter and not the exact payload: every field it names has to match, fields it leaves
 * out are ignored - so omitting it frees every TCP port of this instance. Freeing on shutdown is not
 * needed, the host marks the entries of a stopped instance as no longer held by itself.
 *
 * @param adapter the ioBroker adapter
 * @param data the fields identifying the ports to free; every TCP port of this instance without it
 * @returns whether the host accepted the request
 */
export async function freeUsedPort(adapter, data) {
    if (!canReportUsedResources(adapter)) {
        return false;
    }
    try {
        await adapter.freeUsedResource('tcpPort', data);
        log(adapter, 'debug', `Freed TCP port ${data ? describe(data) : 'registrations'} of this instance`);
        return true;
    }
    catch (e) {
        log(adapter, 'warn', `Could not free TCP port ${data ? describe(data) : 'registrations'}: ${e.message}`);
        return false;
    }
}
/**
 * Say in the log which other instance holds a port this adapter is about to open.
 *
 * Asked before the port is opened: afterwards the operating system has already decided the conflict,
 * and all this could do is improve the wording of the EADDRINUSE. The answer is a hint and not a
 * permission - the registry knows what adapters declare, so an empty result does not promise the
 * port is free, and a program outside ioBroker holding it is not in the registry at all.
 *
 * @param adapter the ioBroker adapter
 * @param data the port that is about to be opened
 * @param what which part of this adapter wants it, for the log line
 */
export async function reportPortConflict(adapter, data, what) {
    if (!canReportUsedResources(adapter)) {
        return [];
    }
    let holders;
    try {
        holders = (await adapter.checkUsedResource('tcpPort', data)) || [];
    }
    catch (e) {
        log(adapter, 'debug', `Could not ask which instance uses TCP port ${describe(data)}: ${e.message}`);
        return [];
    }
    if (holders.length) {
        const running = holders.filter(holder => holder.isBlocked);
        log(adapter, 'warn', `TCP port ${describe(data)} for ${what} is declared by ${holders
            .map(holder => holder.instance)
            .join(', ')}${running.length ? '' : ' (not running at the moment)'}`);
    }
    return holders;
}
/**
 * What a listening server occupies, as the registry wants it.
 *
 * @param server the server to look at
 * @returns the payload, or undefined when the server holds no TCP port
 */
function listeningPort(server) {
    const address = server.address();
    if (!address || typeof address === 'string') {
        // A pipe or a UNIX socket - no port, and no resource type the registry knows for it
        return undefined;
    }
    const data = { port: address.port, bind: address.address };
    if (!WILDCARD_ADDRESSES.includes(address.address)) {
        // Named only for a concrete address: on a wildcard one the port is occupied in both families,
        // and the host treats a family it is not told about as "every family", which is exactly that.
        data.family = address.family === 'IPv6' ? 6 : 4;
    }
    return data;
}
/**
 * Report the port a server listens on for as long as it listens.
 *
 * The port is registered when the server starts listening - only then is it known, and a port taken
 * from the configuration may not be the one that was really bound - and freed when it closes again.
 *
 * @param adapter the ioBroker adapter
 * @param server the server whose port is reported
 * @returns a function that stops reporting and frees a port still registered
 */
export function trackUsedPort(adapter, server) {
    /** What was reported, so the same port can be taken back - the server has no address by then */
    let reported;
    /** Both calls go to the host, and a free must not arrive before the register it undoes */
    let queue = Promise.resolve();
    const enqueue = (task) => {
        // The tasks report their own failures, so nothing is expected here - but a rejected promise
        // nobody listens to terminates the adapter, which no port registration is worth.
        queue = queue.then(task, task).catch((e) => {
            log(adapter, 'warn', `Could not report the used TCP port: ${e?.message}`);
        });
    };
    const onListening = () => {
        const data = listeningPort(server);
        if (!data) {
            return;
        }
        reported = data;
        enqueue(() => registerUsedPort(adapter, data));
    };
    const onClose = () => {
        const data = reported;
        if (!data) {
            return;
        }
        reported = undefined;
        // Filtered by port and address only: the family was derived from the address, and a filter
        // naming a field the entry does not have matches nothing.
        enqueue(() => freeUsedPort(adapter, { port: data.port, bind: data.bind }));
    };
    server.on('listening', onListening);
    server.on('close', onClose);
    if (server.listening) {
        // Attached to a server that is already up, so its `listening` event is long gone
        onListening();
    }
    return () => {
        server.off('listening', onListening);
        server.off('close', onClose);
        onClose();
    };
}
//# sourceMappingURL=usedResources.js.map