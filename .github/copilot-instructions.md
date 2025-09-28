# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

### Frigate Video Surveillance Integration

This adapter integrates ioBroker with Frigate (https://frigate.video/), an open-source Network Video Recorder (NVR) with real-time local object detection for IP cameras. Key functionality includes:

- **MQTT Communication**: Receives events and object detection data from Frigate via MQTT
- **Event Processing**: Handles motion detection, object recognition (person, car, etc.) events
- **Media Management**: Processes snapshots and video clips from camera events
- **Notification System**: Sends alerts to Telegram, Pushover, Signal-CBM with images/clips
- **Camera Control**: PTZ (Pan-Tilt-Zoom) camera controls via MQTT commands
- **State Management**: Tracks detected objects, camera statistics, and system status
- **Web Integration**: Provides URLs for clips and snapshots for visualization (vis integration)

#### Key Technical Patterns
- **MQTT Topics**: `frigate/+/+` for events, `frigate/available` for connection status
- **Event Structure**: JSON payloads with `before`, `after` object detection states
- **File Management**: Temporary storage of clips/snapshots with automatic cleanup
- **API Integration**: REST API calls to Frigate server for configuration and data retrieval
- **Async Processing**: Event notification delays (5s default) for clip generation completion

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();

                        // Configure adapter settings
                        await harness.objects.setObjectAsync("system.adapter.adapterName.0", {
                            type: "instance",
                            common: {
                                enabled: true,
                                name: "adapterName"
                            },
                            native: {
                                coordinates: TEST_COORDINATES
                            }
                        });

                        // Start adapter and wait for connection
                        await harness.startAdapterAndWait();
                        
                        // Wait for adapter to initialize properly
                        await wait(5000);

                        // Verify adapter state
                        const state = await harness.states.getStateAsync("system.adapter.adapterName.0.alive");
                        expect(state).to.be.ok;
                        expect(state.val).to.be.true;

                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });
            }).timeout(60000);
        });
    }
});
```

#### Critical Requirements
1. **Always use `@iobroker/testing`** - No direct adapter instantiation or custom mocking
2. **defineAdditionalTests structure** - Required for adapter-specific testing
3. **getHarness() pattern** - Use provided harness for all operations
4. **Proper timeouts** - Allow sufficient time for async operations (30-60+ seconds)
5. **State verification** - Use `harness.states.getStateAsync()` to verify results
6. **Object configuration** - Set adapter config via `harness.objects.setObjectAsync()`
7. **Clean lifecycle** - Start adapter with `harness.startAdapterAndWait()`

Integration tests should run ONLY after lint and adapter tests pass:

```yaml
integration-tests:
  needs: [check-and-lint, adapter-tests]
  runs-on: ubuntu-latest
  steps:
    - name: Run integration tests
      run: npx mocha test/integration-*.js --exit
```

#### What NOT to Do
❌ Direct API testing: `axios.get('https://api.example.com')`
❌ Mock adapters: `new MockAdapter()`  
❌ Direct internet calls in tests
❌ Bypassing the harness system

#### What TO Do
✅ Use `@iobroker/testing` framework
✅ Configure via `harness.objects.setObject()`
✅ Start via `harness.startAdapterAndWait()`
✅ Test complete adapter lifecycle
✅ Verify states via `harness.states.getState()`
✅ Allow proper timeouts for async operations

### API Testing with Credentials
For adapters that connect to external APIs requiring authentication, implement comprehensive credential testing:

#### Password Encryption for Integration Tests
When creating integration tests that need encrypted passwords (like those marked as `encryptedNative` in io-package.json):

1. **Read system secret**: Use `harness.objects.getObjectAsync("system.config")` to get `obj.native.secret`
2. **Apply XOR encryption**: Implement the encryption algorithm:
   ```javascript
   async function encryptPassword(harness, password) {
       const systemConfig = await harness.objects.getObjectAsync("system.config");
       if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
           throw new Error("Could not retrieve system secret for password encryption");
       }
       
       const secret = systemConfig.native.secret;
       let result = '';
       for (let i = 0; i < password.length; ++i) {
           result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
       }
       return result;
   }
   ```
3. **Store encrypted password**: Set the encrypted result in adapter config, not the plain text
4. **Result**: Adapter will properly decrypt and use credentials, enabling full API connectivity testing

#### Demo Credentials Testing Pattern
- Use provider demo credentials when available (e.g., `demo@api-provider.com` / `demo`)
- Create separate test file (e.g., `test/integration-demo.js`) for credential-based tests
- Add npm script: `"test:integration-demo": "mocha test/integration-demo --exit"`
- Implement clear success/failure criteria with recognizable log messages
- Expected success pattern: Look for specific adapter initialization messages
- Test should fail clearly with actionable error messages for debugging

#### Enhanced Test Failure Handling
```javascript
it("Should connect to API with demo credentials", async () => {
    // ... setup and encryption logic ...
    
    const connectionState = await harness.states.getStateAsync("adapter.0.info.connection");
    
    if (connectionState && connectionState.val === true) {
        console.log("✅ SUCCESS: API connection established");
        return true;
    } else {
        throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
            "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
    }
}).timeout(120000); // Extended timeout for API calls
```

## README Updates

### Required Sections
When updating README.md files, ensure these sections are present and well-documented:

1. **Installation** - Clear npm/ioBroker admin installation steps
2. **Configuration** - Detailed configuration options with examples
3. **Usage** - Practical examples and use cases
4. **Changelog** - Version history and changes (use "## **WORK IN PROGRESS**" section for ongoing changes following AlCalzone release-script standard)
5. **License** - License information (typically MIT for ioBroker adapters)
6. **Support** - Links to issues, discussions, and community support

### Documentation Standards
- Use clear, concise language
- Include code examples for configuration
- Add screenshots for admin interface when applicable
- Maintain multilingual support (at minimum English and German)
- When creating PRs, add entries to README under "## **WORK IN PROGRESS**" section following ioBroker release script standard
- Always reference related issues in commits and PR descriptions (e.g., "solves #xx" or "fixes #xx")

### Mandatory README Updates for PRs
For **every PR or new feature**, always add a user-friendly entry to README.md:

- Add entries under `## **WORK IN PROGRESS**` section before committing
- Use format: `* (author) **TYPE**: Description of user-visible change`
- Types: `BREAKING`, `NEW`, `FEATURE`, `FIX`, `REFACTOR`, `DOCS`
- Example: `* (mcm1957) **FEATURE**: Added support for multiple notification targets per event`

## Coding Standards and Best Practices

### ioBroker Adapter Structure
Follow the standard ioBroker adapter pattern:

```javascript
class AdapterName extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: 'adaptername',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    
    async onReady() {
        // Adapter startup logic
    }
    
    onUnload(callback) {
        try {
            // Cleanup code
            callback();
        } catch (e) {
            callback();
        }
    }
}
```

### State Management
- Use `this.setState()` and `this.setStateAsync()` for state updates
- Create states with proper ACL settings and data types
- Use channels and device structures for organizing states
- Always include proper state definitions with roles and types

### Error Handling
- Always use try-catch blocks for async operations
- Log errors appropriately: `this.log.error()`, `this.log.warn()`, `this.log.info()`, `this.log.debug()`
- Handle network timeouts and connection failures gracefully
- Implement retry mechanisms for critical operations

### Configuration
- Validate configuration in `onReady()`
- Use `this.config` to access adapter settings
- Check for required parameters and provide meaningful error messages
- Support both encrypted and plain text passwords where applicable

### Performance
- Use `this.setTimeout()` and `this.setInterval()` instead of native JavaScript timers
- Clean up timers and intervals in `onUnload()`
- Avoid blocking operations in the main thread
- Use appropriate polling intervals to prevent API rate limiting

### Memory Management
- Clean up event listeners in `onUnload()`
- Close database connections and network sockets
- Clear arrays and objects that hold references to prevent memory leaks
- Monitor memory usage in long-running operations

### API Integration Best Practices
- Always include proper error handling for API calls
- Implement exponential backoff for failed requests
- Use proper HTTP status code handling
- Include User-Agent headers identifying the ioBroker adapter
- Respect API rate limits and implement throttling
- Use connection pooling for frequent API calls

### MQTT Integration
- Handle connection state changes properly
- Implement message queuing for offline scenarios
- Use appropriate QoS levels for different message types
- Handle large message payloads efficiently
- Implement proper topic subscription patterns

### Security
- Never store passwords or API keys in plain text
- Use ioBroker's encryption for sensitive configuration data
- Validate and sanitize all external inputs
- Use secure communication protocols (TLS/SSL) where available
- Follow principle of least privilege for system access

### Localization
- Use translation functions for user-facing strings
- Support multiple languages (minimum English and German)
- Follow ioBroker translation standards
- Maintain translation files in `/admin/i18n/` directory

## GitHub Actions & CI/CD

### Standard Workflow Structure
Use the official ioBroker adapter template for GitHub Actions:

```yaml
name: Test and Release
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check-and-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Use Node.js 18.x
        uses: actions/setup-node@v3
        with:
          node-version: 18.x
      - run: npm ci
      - run: npm run check
      - run: npm run lint

  adapter-tests:
    runs-on: ubuntu-latest
    needs: [check-and-lint]
    steps:
      - uses: actions/checkout@v3
      - name: Use Node.js 18.x
        uses: actions/setup-node@v3
        with:
          node-version: 18.x
      - run: npm ci
      - run: npm test
```

### Required Checks
- Linting with ESLint
- TypeScript compilation check
- Unit tests
- Integration tests (where applicable)
- Package validation

### Release Process
- Use semantic versioning (MAJOR.MINOR.PATCH)
- Follow conventional commit messages
- Automated releases via GitHub Actions
- Update CHANGELOG.md and README.md for each release
- Tag releases properly in Git

## Admin Interface Development

### React Components
When working with React-based admin interfaces:

```javascript
import React from 'react';
import { withStyles } from '@mui/styles';

class Settings extends React.Component {
    render() {
        return (
            <div>
                {/* Admin interface components */}
            </div>
        );
    }
}

export default withStyles(styles)(Settings);
```

### Configuration Forms
- Use proper form validation
- Provide helpful tooltips and descriptions
- Support different input types (text, number, boolean, select)
- Implement proper state management
- Handle configuration changes reactively

### Material-UI Integration
- Use Material-UI components consistently
- Follow ioBroker admin interface design patterns
- Ensure responsive design for different screen sizes
- Implement proper theming support

## Database and State Structure

### Object Structure
```javascript
await this.setObjectNotExistsAsync('devices.camera1', {
    type: 'device',
    common: {
        name: 'Camera 1',
        statusStates: {
            onlineId: 'devices.camera1.info.connection'
        }
    },
    native: {}
});

await this.setObjectNotExistsAsync('devices.camera1.events', {
    type: 'channel',
    common: {
        name: 'Camera Events'
    },
    native: {}
});

await this.setObjectNotExistsAsync('devices.camera1.events.person', {
    type: 'state',
    common: {
        name: 'Person detected',
        type: 'boolean',
        role: 'sensor.motion',
        read: true,
        write: false
    },
    native: {}
});
```

### State Naming Conventions
- Use descriptive, hierarchical naming: `device.channel.state`
- Follow ioBroker role conventions
- Use appropriate data types (boolean, number, string, object)
- Include proper units where applicable

## External Library Integration

### Dependency Management
- Minimize external dependencies
- Use well-maintained, popular libraries
- Specify exact versions to avoid breaking changes
- Regular security audits with `npm audit`

### Common Libraries for ioBroker Adapters
- `@iobroker/adapter-core` - Core adapter functionality
- `axios` - HTTP client for API calls
- `mqtt` - MQTT client communication
- `node-schedule` - Task scheduling
- `crypto` - Cryptographic operations

## Troubleshooting and Debugging

### Common Issues
- Connection timeouts: Implement proper retry logic
- Memory leaks: Monitor and clean up resources
- State synchronization: Use proper async/await patterns
- Configuration validation: Provide clear error messages

### Debugging Techniques
- Use debug logging extensively: `this.log.debug()`
- Implement verbose mode for troubleshooting
- Use Node.js debugging tools when necessary
- Monitor adapter performance metrics

### Log Levels
- `error`: Critical errors that prevent operation
- `warn`: Issues that don't stop operation but need attention
- `info`: Important operational information
- `debug`: Detailed information for troubleshooting

## Performance Optimization

### Best Practices
- Batch state updates when possible
- Use appropriate polling intervals
- Implement caching for frequently accessed data
- Optimize database queries and object operations
- Monitor memory and CPU usage patterns

### Monitoring
- Track adapter performance metrics
- Monitor state change frequency
- Log performance-critical operations
- Implement health checks for external services

## Community and Support

### Documentation Standards
- Maintain comprehensive README files
- Include setup and configuration guides
- Provide troubleshooting sections
- Document all configuration options

### Issue Tracking
- Use GitHub Issues for bug reports
- Provide issue templates for users
- Maintain clear reproduction steps
- Label issues appropriately for tracking

### Community Engagement
- Respond to user questions promptly
- Maintain forum presence for adapter support
- Share knowledge with other developers
- Contribute to ioBroker ecosystem improvements