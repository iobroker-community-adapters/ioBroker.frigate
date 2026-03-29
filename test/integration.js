import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tests } from '@iobroker/testing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
tests.integration(path.join(__dirname, '..'));
