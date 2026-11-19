/** Where the jobs of Frigate (exports, motion search, debug replay, ...) are written */
export const JOB_STATE = 'job_state';
/**
 * Removes objects and arrays that are empty, also those that become empty because their content was
 * empty. Otherwise a channel would be created for them that has no state below it.
 *
 * @param value the parsed payload, changed in place
 * @returns true if the value itself is an empty object or array
 */
function removeEmpty(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
            if (removeEmpty(value[i])) {
                value.splice(i, 1);
            }
        }
        return value.length === 0;
    }
    const obj = value;
    for (const key of Object.keys(obj)) {
        if (removeEmpty(obj[key])) {
            delete obj[key];
        }
    }
    return Object.keys(obj).length === 0;
}
/**
 * Writes the MQTT topic `job_state` and deletes the objects of jobs that are not in it any more.
 *
 * Frigate sends the complete state with each change: per job type the jobs that are queued or running
 * at that moment (`{ export: { status, results: { jobs: [...] } } }`). A finished job is not in it any
 * more. The objects are named after the id of the job (`job_state.export.results.<camera>_<id>`), so
 * without deleting them every export left 12 objects behind for good - and a motion search one state
 * per result.
 *
 * @param ctx adapter and the parser
 * @param data the payload of `job_state`
 */
export async function handleJobState(ctx, data) {
    removeEmpty(data);
    const written = new Set();
    await ctx.json2iob.parse(JOB_STATE, data, { writtenIds: written });
    const deleted = await ctx.json2iob.deleteObjectsNotWritten(JOB_STATE, written);
    if (deleted) {
        ctx.adapter.log.debug(`Deleted ${deleted} objects of finished jobs in ${JOB_STATE}`);
    }
}
/**
 * Deletes the job states at the start of the adapter.
 *
 * Frigate sends `job_state` only when a job changes and not again when a client connects, so the
 * states from before the start show jobs that have long finished, e.g. an export at 97 % for good.
 * The next change of a job writes them again.
 *
 * @param adapter the adapter
 */
export async function deleteJobState(adapter) {
    try {
        if (await adapter.getObjectAsync(JOB_STATE)) {
            await adapter.delObjectAsync(JOB_STATE, { recursive: true });
        }
    }
    catch (error) {
        adapter.log.warn(`Cannot delete ${JOB_STATE}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
//# sourceMappingURL=jobState.js.map