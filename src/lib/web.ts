/**
 * This file is a web extension for a global server, and it runs in the context of ioBroker.web.
 * It will be started by ioBroker.web and called by it.
 *
 * Frigate serves snapshots and MJPEG streams itself, but its URLs are of little use in a
 * visualization:
 *  - the API is usually bound to 127.0.0.1, so the URL is dead on every other machine,
 *  - port 8971 wants a JWT that the browser does not have,
 *  - an http Frigate embedded into an https ioBroker.web is blocked as mixed content,
 *  - and nothing of it is covered by the ioBroker authentication.
 *
 * Everything is therefore proxied through here: the routes inherit the authentication and the
 * http/https scheme of ioBroker.web, and no additional port has to be opened.
 */
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { Agent } from 'node:https';
import type { Readable } from 'node:stream';
import type { Express, Request, Response } from 'express';
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import type { FrigateAdapterConfig } from '../types.js';

/**
 * Frigate camera names are configuration keys and never contain a slash or a dot. Anything else is
 * rejected instead of being passed on, so a crafted name cannot walk out of `/api/<camera>/` into
 * another Frigate endpoint.
 */
const CAMERA_NAME = /^[A-Za-z0-9_-]+$/;

/** Query parameters of `/api/<camera>/latest.jpg` that are safe to pass through */
const SNAPSHOT_PARAMS = ['height', 'quality', 'bbox', 'timestamp', 'zones', 'mask', 'motion', 'regions', 'paths'];

/** Query parameters of the MJPEG endpoint `/api/<camera>` */
const STREAM_PARAMS = ['fps', 'height', 'bbox', 'timestamp', 'zones', 'mask', 'motion'];

export default class ProxyFrigate {
    private readonly app: Express;
    private readonly adapter: ioBroker.Adapter;
    private readonly config: FrigateAdapterConfig;
    private readonly namespace: string;
    private readonly requestClient: AxiosInstance;
    private readonly frigateBaseUrl: string;

    /** Running MJPEG streams, so that `unload()` can stop pulling from Frigate */
    private readonly streams = new Set<Readable>();

    /** A single login is shared by all requests that run into a 401 at the same time */
    private loginPromise: Promise<boolean> | null = null;

    constructor(
        server: HttpServer | HttpsServer,
        webSettings: {
            secure: boolean;
            port: number;
            defaultUser?: string;
            auth?: boolean;
            language?: ioBroker.Languages;
        },
        adapter: ioBroker.Adapter,
        instanceSettings: ioBroker.InstanceObject,
        app: Express,
    ) {
        this.app = app;
        this.adapter = adapter;
        this.config = instanceSettings
            ? (instanceSettings.native as FrigateAdapterConfig)
            : ({} as FrigateAdapterConfig);
        this.namespace = instanceSettings ? instanceSettings._id.substring('system.adapter.'.length) : 'frigate';

        this.config.route = this.config.route || `${this.namespace}/`;
        if (this.config.route[0] === '/') {
            this.config.route = this.config.route.substring(1);
        }

        this.frigateBaseUrl = ProxyFrigate.buildBaseUrl(this.config);

        this.requestClient = axios.create({
            withCredentials: true,
            headers: { 'User-Agent': 'ioBroker.frigate', accept: '*/*' },
            timeout: 30000,
            // Frigate on 8971 normally presents a self-signed certificate
            httpsAgent: new Agent({ rejectUnauthorized: false }),
        });

        this.installRoutes();
    }

    /**
     * Assemble the Frigate base URL exactly like the adapter does, so both talk to the same server.
     *
     * @param config native part of the instance object
     */
    static buildBaseUrl(config: FrigateAdapterConfig): string {
        let friurl = config.friurl;
        if (config.dockerFrigate?.enabled) {
            friurl = `${config.dockerFrigate.bind}:${config.dockerFrigate.port || 5000}`;
        }
        if (!friurl) {
            return '';
        }
        return friurl.startsWith('http') ? friurl : `http://${friurl}`;
    }

    installRoutes(): void {
        if (!this.frigateBaseUrl) {
            this.adapter.log.warn(`No Frigate URL configured for ${this.namespace}, cameras are not proxied`);
            return;
        }

        const route = `/${this.config.route}`;

        // Deliberately exact paths instead of a prefix: everything else below /<namespace>/ stays with
        // the normal file handling of ioBroker.web
        this.app.get(`${route}:camera/snapshot.jpg`, (req: Request, res: Response): void => {
            void this.snapshot(req, res);
        });

        this.app.get(`${route}:camera/stream.mjpeg`, (req: Request, res: Response): void => {
            void this.stream(req, res);
        });

        this.adapter.log.info(
            `Install extension on ${route}<camera>/snapshot.jpg and ${route}<camera>/stream.mjpeg -> ${this.frigateBaseUrl}`,
        );
    }

    unload(): Promise<void> {
        for (const stream of this.streams) {
            stream.destroy();
        }
        this.streams.clear();
        return Promise.resolve();
    }

    // --- Frigate API access -------------------------------------------------------------------

    /**
     * Log in and remember the bearer token.
     *
     * Frigate answers the login with a `frigate_token` cookie; the adapter turns it into an
     * Authorization header and so do we. This class cannot reuse the axios instance of the adapter,
     * because it lives in the ioBroker.web process.
     */
    async login(): Promise<boolean> {
        // Collapse concurrent logins into one request
        this.loginPromise ||= (async (): Promise<boolean> => {
            try {
                const response = await this.requestClient.post(`${this.frigateBaseUrl}/api/login`, {
                    user: this.config.frigateUsername,
                    password: this.config.frigatePassword,
                });
                const cookies = response.headers['set-cookie'] || [];
                for (const cookie of cookies) {
                    const match = cookie.match(/frigate_token=([^;]+)/);
                    if (match) {
                        this.requestClient.defaults.headers.common.Authorization = `Bearer ${match[1]}`;
                        this.adapter.log.debug(`Authenticated with Frigate for ${this.namespace}`);
                        return true;
                    }
                }
                this.adapter.log.warn(`Frigate login for ${this.namespace} returned no token`);
            } catch (e) {
                this.adapter.log.warn(`Frigate login for ${this.namespace} failed: ${e}`);
            } finally {
                this.loginPromise = null;
            }
            return false;
        })();

        return this.loginPromise;
    }

    /**
     * GET from the Frigate API, logging in once if the token is missing or has expired.
     *
     * @param path path below the Frigate base URL, already encoded
     * @param responseType `arraybuffer` for a snapshot, `stream` for the endless MJPEG response
     */
    async get(path: string, responseType: 'arraybuffer' | 'stream'): Promise<AxiosResponse> {
        const request = (): Promise<AxiosResponse> =>
            this.requestClient.get(`${this.frigateBaseUrl}${path}`, { responseType });

        try {
            return await request();
        } catch (e: any) {
            const canLogin = !!(this.config.frigateUsername && this.config.frigatePassword);
            if (e?.response?.status === 401 && canLogin && (await this.login())) {
                return request();
            }
            throw e;
        }
    }

    // --- Routes -------------------------------------------------------------------------------

    /**
     * Copy the whitelisted query parameters of the incoming request.
     *
     * @param req the express request
     * @param allowed names that Frigate understands on this endpoint
     */
    static query(req: Request, allowed: string[]): string {
        const params = new URLSearchParams();
        for (const name of allowed) {
            const value = req.query[name];
            if (typeof value === 'string' && value !== '') {
                params.append(name, value);
            }
        }
        const query = params.toString();
        return query ? `?${query}` : '';
    }

    /**
     * Read the camera name from the route, or answer 400 if it is not a plain Frigate camera name.
     *
     * @param req the express request
     * @param res the express response
     */
    private cameraName(req: Request, res: Response): string | null {
        const camera = Array.isArray(req.params.camera) ? req.params.camera[0] : req.params.camera;
        if (!camera || !CAMERA_NAME.test(camera)) {
            res.status(400).send('Invalid camera name');
            return null;
        }
        return camera;
    }

    /**
     * A still image: `/api/<camera>/latest.jpg`
     *
     * @param req the express request
     * @param res the express response
     */
    async snapshot(req: Request, res: Response): Promise<void> {
        const camera = this.cameraName(req, res);
        if (!camera) {
            return;
        }

        try {
            const response = await this.get(
                `/api/${camera}/latest.jpg${ProxyFrigate.query(req, SNAPSHOT_PARAMS)}`,
                'arraybuffer',
            );
            res.setHeader('Content-Type', (response.headers['content-type'] as string) || 'image/jpeg');
            // Always a freshly grabbed frame - never let a browser reuse the previous one
            res.setHeader('Cache-Control', 'no-store, private');
            res.status(200).send(Buffer.from(response.data));
        } catch (e) {
            this.fail(res, `Cannot get snapshot of "${camera}"`, e);
        }
    }

    /**
     * The continuous MJPEG feed: `/api/<camera>`. Usable in a plain `<img src="...">`.
     *
     * @param req the express request
     * @param res the express response
     */
    async stream(req: Request, res: Response): Promise<void> {
        const camera = this.cameraName(req, res);
        if (!camera) {
            return;
        }

        try {
            const response = await this.get(`/api/${camera}${ProxyFrigate.query(req, STREAM_PARAMS)}`, 'stream');
            const stream = response.data as Readable;

            res.setHeader('Content-Type', (response.headers['content-type'] as string) || 'multipart/x-mixed-replace');
            res.setHeader('Cache-Control', 'no-store, private');

            this.streams.add(stream);

            // Frigate encodes the MJPEG per client, so stop it as soon as the browser is gone
            res.on('close', () => {
                this.streams.delete(stream);
                stream.destroy();
            });
            stream.on('error', () => {
                this.streams.delete(stream);
                res.end();
            });

            stream.pipe(res);
        } catch (e) {
            this.fail(res, `Cannot stream "${camera}"`, e);
        }
    }

    /**
     * Report a failed request without ever writing to a response that is already on its way.
     *
     * @param res the express response
     * @param message what was attempted
     * @param error the caught error
     */
    private fail(res: Response, message: string, error: unknown): void {
        const status = (error as { response?: { status?: number } })?.response?.status;
        this.adapter.log.debug(`${message}: ${error instanceof Error ? error.message : String(error)}`);
        if (!res.headersSent) {
            res.status(status === 401 || status === 404 ? status : 502).send(message);
        } else if (!res.writableEnded) {
            res.end();
        }
    }
}
