import assert from 'node:assert';
import fs from 'node:fs';
import { COMMANDS, HELP } from '../build/lib/help.js';

/** The commands of the if/else chain in `onMessage` of src/main.ts */
function commandsOfMain() {
    const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const start = source.indexOf('onMessage = (');
    const end = source.indexOf('async getSnapshot(', start);
    assert.ok(start > 0 && end > start, 'onMessage found');
    return [...source.slice(start, end).matchAll(/obj\?\.command === '([^']+)'/g)].map(m => m[1]);
}

describe('help', () => {
    it('lists exactly the commands onMessage answers, each once', () => {
        const names = COMMANDS.map(c => c.command);
        assert.strictEqual(new Set(names).size, names.length);
        assert.deepStrictEqual([...names].sort(), commandsOfMain().sort());
    });

    it('marks every command as write true or false', () => {
        for (const { command, write } of COMMANDS) {
            assert.strictEqual(typeof write, 'boolean', command);
        }
        // only the Docker commands have an effect
        const writing = COMMANDS.filter(c => c.write).map(c => c.command);
        assert.deepStrictEqual(writing.sort(), ['recreateContainer', 'restartContainer']);
    });

    it('names every command', () => {
        for (const { command } of COMMANDS) {
            assert.ok(HELP.includes(command), command);
        }
        assert.ok(HELP.includes('sendTo frigate.0'));
        assert.ok(HELP.includes('How to talk to the user:'));
    });

    it('keeps the lines short', () => {
        for (const line of HELP.split('\n')) {
            assert.ok(line.length <= 120, line);
        }
    });
});
