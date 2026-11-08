/**
 * Build helper for the device manager widgets and the web components.
 *
 * `src-devices` is a separate module-federation bundle that ioBroker.devices loads at runtime. The
 * built files go to admin/dm-widgets/, which ships with the adapter because admin/ is already listed
 * in "files" of package.json.
 *
 * `src-webcomponents` builds the web components (`@iobroker/web-components`) for Aura, vis-2, admin and
 * every other host: one module and one manifest per component, copied to admin/webcomponents/ and
 * listed in `common.webComponents` of io-package.json.
 *
 * Runs as TypeScript without a build step: node >= 22.19 strips the types itself, so this file must
 * stay in erasable syntax only - no enums, no parameter properties, no namespaces.
 */
import { existsSync, rmSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = import.meta.dirname;

/**
 * Copy a whole directory, creating the target as needed.
 *
 * @param from source directory
 * @param to target directory
 */
function copyDir(from: string, to: string): void {
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
function run(command: string, cwd: string): void {
    console.log(`> ${command}  (in ${cwd})`);
    execSync(command, { cwd, stdio: 'inherit' });
}

function devicesClean(): void {
    rmSync(join(root, 'src-devices/build'), { recursive: true, force: true });
    rmSync(join(root, 'admin/dm-widgets'), { recursive: true, force: true });
}

function devicesNpm(): void {
    if (!existsSync(join(root, 'src-devices/node_modules'))) {
        run('npm install', join(root, 'src-devices'));
    }
}

function devicesBuild(): void {
    run('npm run build', join(root, 'src-devices'));
}

function devicesCopy(): void {
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

function wcClean(): void {
    rmSync(join(root, 'src-webcomponents/build'), { recursive: true, force: true });
    rmSync(join(root, 'admin/webcomponents'), { recursive: true, force: true });
}

function wcNpm(): void {
    if (!existsSync(join(root, 'src-webcomponents/node_modules'))) {
        run('npm install', join(root, 'src-webcomponents'));
    }
}

/** One vite build per component, see src-webcomponents/vite.config.ts; each writes and checks its manifest */
function wcBuild(): void {
    run('npm run build', join(root, 'src-webcomponents'));
}

/** The module and the manifest of every component: `<name>.js` and `<name>.json` */
function wcCopy(): void {
    const build = join(root, 'src-webcomponents/build');
    const target = join(root, 'admin/webcomponents');
    const files = existsSync(build)
        ? readdirSync(build).filter(file => file.endsWith('.js') || file.endsWith('.json'))
        : [];
    if (!files.length) {
        throw new Error('src-webcomponents/build/ has no web components - run the build first');
    }
    mkdirSync(target, { recursive: true });
    for (const file of files) {
        copyFileSync(join(build, file), join(target, file));
    }
    console.log(`Copied ${files.join(', ')} to ${target}`);
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
} else if (process.argv.includes('--wc')) {
    wcClean();
    wcNpm();
    wcBuild();
    wcCopy();
} else {
    console.error('Usage: node tasks.ts --devices-build | --devices-0-clean | ... | --devices-3-copy | --wc');
    process.exit(1);
}
