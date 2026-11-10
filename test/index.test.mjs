import test from 'node:test';
import assert from 'node:assert/strict';

import { createMindContextRegistry } from '../dist/index.js';
import { bindMindAction } from '../dist/adapters/angular.js';

test.beforeEach(() => {
    globalThis.window = {};
});

test.after(() => {
    delete globalThis.window;
});

test('registers and unregisters actions across lifecycle helpers', async () => {
    const registry = createMindContextRegistry('lifecycle-app');

    registry.registerAction('core:echo', (value) => value, { scope: 'core' });
    assert.deepEqual(registry.listActions(), ['core:echo']);

    const directResult = await registry.invokeAction('core:echo', ['hello']);
    assert.deepEqual(directResult, { success: true, data: 'hello' });

    registry.unregisterAction('core:echo');
    assert.deepEqual(registry.listActions(), []);

    let destroy = () => { };
    bindMindAction(
        registry,
        'core:auto-cleanup',
        { onDestroy(fn) { destroy = fn; } },
        () => 'ok',
        { scope: 'core' },
    );

    assert.deepEqual(registry.listActions(), ['core:auto-cleanup']);
    destroy();
    assert.deepEqual(registry.listActions(), []);
});

test('wraps legacy results and preserves standardized results on window actions', async () => {
    const registry = createMindContextRegistry('result-app');

    registry.registerAction('value:return', () => 42);
    registry.registerAction('value:standard', () => ({ success: false, errorCode: 'ALREADY_STANDARD', message: 'kept' }));

    const app = globalThis.window.__DCP_MIND_CONTEXT__['result-app'];
    const rawResult = await app.actions['value:return']();
    const standardResult = await app.invokeAction('value:standard');

    assert.deepEqual(rawResult, { success: true, data: 42 });
    assert.deepEqual(standardResult, { success: false, errorCode: 'ALREADY_STANDARD', message: 'kept' });
});

test('applies global and per-action timeouts deterministically', async () => {
    const registry = createMindContextRegistry('timeout-app', { defaultActionTimeoutMs: 10 });

    registry.registerAction('slow:default', () => new Promise((resolve) => {
        setTimeout(() => resolve('late'), 30);
    }));

    registry.registerAction('slow:override', () => new Promise((resolve) => {
        setTimeout(() => resolve('done'), 20);
    }), { timeoutMs: 50 });

    const timeoutResult = await registry.invokeAction('slow:default');
    const overrideResult = await registry.invokeAction('slow:override');

    assert.equal(timeoutResult.success, false);
    assert.equal(timeoutResult.errorCode, 'ACTION_TIMEOUT');
    assert.equal(overrideResult.success, true);
    assert.equal(overrideResult.data, 'done');
});

test('reset helpers clear scoped context and actions safely', async () => {
    const registry = createMindContextRegistry('reset-app');

    registry.set('core:selectedWebId', '123', 'core');
    registry.set('shell:theme', 'dark', 'shell');
    registry.registerAction('core:refresh', () => 'refreshed', { scope: 'core' });
    registry.registerAction('shell:open', () => 'opened', { scope: 'shell' });

    registry.resetContext('core');
    registry.resetActions('core');

    assert.deepEqual(registry.snapshot(), { 'shell:theme': 'dark' });
    assert.deepEqual(registry.listActions(), ['shell:open']);

    registry.resetAll();
    registry.resetAll();

    assert.deepEqual(registry.snapshot(), {});
    assert.deepEqual(registry.listActions(), []);
});

test('subscribe notifies listeners on context changes and supports unsubscribe', () => {
    const registry = createMindContextRegistry('subscribe-app');
    const received = [];
    const unsubscribe = registry.subscribe((snapshot) => received.push(snapshot));

    registry.set('core:selectedWebId', '123', 'core');
    registry.set('shell:theme', 'dark', 'shell');
    registry.clearScope('shell');
    registry.clear('core:selectedWebId');
    registry.clearAll(); // no-op notification: store is already empty

    assert.equal(received.length, 4);
    assert.deepEqual(received[0], { 'core:selectedWebId': '123' });
    assert.deepEqual(received.at(-1), {});

    unsubscribe();
    registry.set('core:selectedWebId', '456', 'core');
    assert.equal(received.length, 4);

    const app = globalThis.window.__DCP_MIND_CONTEXT__['subscribe-app'];
    const windowReceived = [];
    const windowUnsubscribe = app.subscribe((snapshot) => windowReceived.push(snapshot));
    registry.set('core:selectedWebId', '789', 'core');
    assert.equal(windowReceived.length, 1);
    windowUnsubscribe();
});

test('subscribeKey notifies only for the requested keys and reports changedKeys', () => {
    const registry = createMindContextRegistry('subscribe-key-app');
    const webIdChanges = [];
    const multiKeyChanges = [];

    const unsubscribeWebId = registry.subscribeKey('core:selectedWebId', (value, event) => {
        webIdChanges.push({ value, changedKeys: event.changedKeys });
    });
    const unsubscribeMulti = registry.subscribeKey(
        ['core:selectedWebId', 'shell:theme'],
        (value) => multiKeyChanges.push(value),
    );

    registry.set('core:selectedWebId', '123', 'core');
    registry.set('shell:theme', 'dark', 'shell');

    assert.equal(webIdChanges.length, 1);
    assert.deepEqual(webIdChanges[0], { value: '123', changedKeys: ['core:selectedWebId'] });
    assert.equal(multiKeyChanges.length, 2);
    assert.deepEqual(multiKeyChanges, ['123', 'dark']);

    unsubscribeWebId();
    registry.set('core:selectedWebId', '456', 'core');
    assert.equal(webIdChanges.length, 1);
    assert.equal(multiKeyChanges.length, 3);

    unsubscribeMulti();

    const app = globalThis.window.__DCP_MIND_CONTEXT__['subscribe-key-app'];
    const windowChanges = [];
    const windowUnsubscribe = app.subscribeKey('shell:theme', (value) => windowChanges.push(value));
    registry.set('shell:theme', 'light', 'shell');
    registry.set('core:selectedWebId', '789', 'core');
    assert.deepEqual(windowChanges, ['light']);
    windowUnsubscribe();
});

test('returns standardized failures for missing actions, invalid input, invalid timeout, validation, and thrown errors', async () => {
    const registry = createMindContextRegistry('error-app', { defaultActionTimeoutMs: Number.NaN });
    let called = false;

    registry.registerAction('checked:action', () => {
        called = true;
        return 'unexpected';
    }, {
        timeoutMs: 15,
        validate: () => ({ errorCode: 'INVALID_PAYLOAD', message: 'Payload rejected.' }),
    });

    registry.registerAction('broken:action', () => {
        throw new Error('boom');
    });

    const missing = await registry.invokeAction('missing:action');
    const invalidArgs = await registry.invokeAction('broken:action', 'not-an-array');
    const invalidTimeout = await registry.invokeAction('broken:action');

    const validRegistry = createMindContextRegistry('validation-app');
    validRegistry.registerAction('checked:action', () => {
        called = true;
        return 'unexpected';
    }, {
        validate: () => ({ errorCode: 'INVALID_PAYLOAD', message: 'Payload rejected.' }),
    });

    const validation = await validRegistry.invokeAction('checked:action', []);
    const thrown = await validRegistry.invokeAction('missing:action', []);
    validRegistry.registerAction('broken:action', () => {
        throw new Error('boom');
    });
    const thrownError = await validRegistry.invokeAction('broken:action', []);

    assert.equal(missing.errorCode, 'ACTION_NOT_FOUND');
    assert.equal(invalidArgs.errorCode, 'ACTION_INVALID_INPUT');
    assert.equal(invalidTimeout.errorCode, 'ACTION_INVALID_INPUT');
    assert.equal(validation.errorCode, 'INVALID_PAYLOAD');
    assert.equal(called, false);
    assert.equal(thrown.errorCode, 'ACTION_NOT_FOUND');
    assert.equal(thrownError.errorCode, 'ACTION_EXECUTION_FAILED');
    assert.equal(thrownError.message, 'boom');
});