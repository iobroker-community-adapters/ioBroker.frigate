/**
 * Build helper for the device manager widgets.
 *
 * `src-devices` is a separate module-federation bundle that ioBroker.devices loads at runtime. The
 * built files go to admin/dm-widgets/, which ships with the adapter because admin/ is already listed
 * in "files" of package.json.
 */
import { existsSync, rmSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Copy a whole directory, creating the target as needed.
 *
 * @param from source directory
 * @param to target directory
 */
function copyDir(from, to) {
    if (!existsSync(from)) {
        return;
    }
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) {
        const source = join(from, entry);
        const target = join(to, entry);
        if (statSync(source).isDirectory()) {
            copyDir(source, target);
        } else {
            copyFileSync(source, target);
        }
    }
}

/**
 * Run a command in a sub directory and let its output through.
 *
 * @param command the command line
 * @param cwd directory to run it in
 */
function run(command, cwd) {
    console.log(`> ${command}  (in ${cwd})`);
    execSync(command, { cwd, stdio: 'inherit' });
}

function devicesClean() {
    rmSync(join(root, 'src-devices/build'), { recursive: true, force: true });
    rmSync(join(root, 'admin/dm-widgets'), { recursive: true, force: true });
}

function devicesNpm() {
    if (!existsSync(join(root, 'src-devices/node_modules'))) {
        run('npm install', join(root, 'src-devices'));
    }
}

function devicesBuild() {
    run('npm run build', join(root, 'src-devices'));
}

function devicesCopy() {
    const build = join(root, 'src-devices/build');
    const target = join(root, 'admin/dm-widgets');
    if (!existsSync(join(build, 'customDevices.js'))) {
        throw new Error('src-devices/build/customDevices.js is missing - run the build first');
    }
    mkdirSync(target, { recursive: true });
    copyFileSync(join(build, 'customDevices.js'), join(target, 'customDevices.js'));
    copyDir(join(build, 'assets'), join(target, 'assets'));
    copyDir(join(root, 'src-devices/img'), target);
    console.log(`Copied device widgets to ${target}`);
}

if (process.argv.includes('--devices-0-clean')) {
    devicesClean();
} else if (process.argv.includes('--devices-1-npm')) {
    devicesNpm();
} else if (process.argv.includes('--devices-2-build')) {
    devicesBuild();
} else if (process.argv.includes('--devices-3-copy')) {
    devicesCopy();
} else if (process.argv.includes('--devices-build')) {
    devicesClean();
    devicesNpm();
    devicesBuild();
    devicesCopy();
} else {
    console.error('Usage: node tasks --devices-build | --devices-0-clean | ... | --devices-3-copy');
    process.exit(1);
}
