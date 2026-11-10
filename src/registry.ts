import type {
    MindContextSnapshot,
    MindActionFn,
    MindActionResult,
    MindActionValidator,
    MindActionOptions,
    MindContextRegistryOptions,
    MindActionInvoker,
    MindContextChangeListener,
    MindContextChangeEvent,
    MindContextKeyChangeListener,
    MindContextRegistry,
} from './types/types';

const WINDOW_KEY = '__DCP_MIND_CONTEXT__';
const ACTION_NOT_FOUND = 'ACTION_NOT_FOUND';
const ACTION_INVALID_INPUT = 'ACTION_INVALID_INPUT';
const ACTION_VALIDATION_FAILED = 'ACTION_VALIDATION_FAILED';
const ACTION_TIMEOUT = 'ACTION_TIMEOUT';
const ACTION_EXECUTION_FAILED = 'ACTION_EXECUTION_FAILED';

interface RegisteredAction {
    fn: MindActionFn;
    options?: MindActionOptions;
}

function createActionError(errorCode: string, message: string, data?: unknown): MindActionResult {
    return {
        success: false,
        errorCode,
        message,
        ...(data === undefined ? {} : { data }),
    };
}

function isMindActionResult(value: unknown): value is MindActionResult {
    return typeof value === 'object'
        && value !== null
        && 'success' in value
        && typeof (value as { success?: unknown }).success === 'boolean';
}

function normalizeActionResult(value: unknown): MindActionResult {
    if (isMindActionResult(value)) {
        return value;
    }

    return {
        success: true,
        ...(value === undefined ? {} : { data: value }),
    };
}

function isValidTimeout(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function toErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallback;
}

async function runWithTimeout<T>(run: () => Promise<T>, timeoutMs?: number): Promise<T> {
    if (timeoutMs === undefined) {
        return run();
    }

    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(ACTION_TIMEOUT)), timeoutMs);

        run()
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

function registerOnWindow(appName: string, registry: MindContextRegistry, actions: Map<string, RegisteredAction>): void {
    try {
        window[WINDOW_KEY] = window[WINDOW_KEY] || {};
        window[WINDOW_KEY][appName] = {
            snapshot: () => registry.snapshot(),
            subscribe: (listener) => registry.subscribe(listener),
            subscribeKey: (keys, listener) => registry.subscribeKey(keys, listener),
            listActions: () => registry.listActions(),
            invokeAction: (name, args) => registry.invokeAction(name, args),
            // proxy so registrations after init are always current
            actions: new Proxy({}, {
                get: (_target, prop: string | symbol) => {
                    if (typeof prop !== 'string') {
                        return undefined;
                    }

                    return (...args: unknown[]) => registry.invokeAction(prop, args);
                },
                has: (_target, prop: string | symbol) => {
                    if (typeof prop !== 'string') {
                        return false;
                    }
                    return actions.has(prop);
                },
                ownKeys: () => Array.from(actions.keys()),
                getOwnPropertyDescriptor: (_target, prop: string | symbol) => {
                    if (typeof prop !== 'string' || !actions.has(prop)) {
                        return undefined;
                    }
                    return {
                        configurable: true,
                        enumerable: true,
                        writable: false,
                        value: (...args: unknown[]) => registry.invokeAction(prop, args),
                    };
                },
            }) as Record<string, MindActionInvoker>,
        };
    } catch { /* never crash the host app */ }
}

function createNoopRegistry(): MindContextRegistry {
    console.warn('[mind-integration] Failed to create context registry. Integration is disabled.');
    return {
        set: () => { },
        clear: () => { },
        clearScope: () => { },
        clearAll: () => { },
        resetContext: () => { },
        snapshot: () => ({}),
        subscribe: () => () => { },
        subscribeKey: () => () => { },
        registerAction: () => { },
        unregisterAction: () => { },
        resetActions: () => { },
        resetAll: () => { },
        invokeAction: async () => createActionError(ACTION_EXECUTION_FAILED, 'Action registry is unavailable.'),
        listActions: () => [],
    };
}

export function createMindContextRegistry(appName: string, options: MindContextRegistryOptions = {}): MindContextRegistry {
    try {
        const store = new Map<string, unknown>();
        const scopeKeys = new Map<string, Set<string>>();
        const actionMap = new Map<string, RegisteredAction>();
        const actionScopes = new Map<string, Set<string>>();
        const changeListeners = new Set<MindContextChangeListener>();
        const keyChangeListeners = new Map<string, Set<MindContextKeyChangeListener>>();

        const notifyChange = (changedKeys: string[]) => {
            if (!changedKeys.length) return;
            const snapshot = registry.snapshot();

            if (changeListeners.size) {
                changeListeners.forEach((listener) => {
                    try {
                        listener(snapshot);
                    } catch { /* never crash the host app */ }
                });
            }

            if (!keyChangeListeners.size) return;
            const event: MindContextChangeEvent = { snapshot, changedKeys };
            changedKeys.forEach((key) => {
                keyChangeListeners.get(key)?.forEach((listener) => {
                    try {
                        listener(snapshot[key], event);
                    } catch { /* never crash the host app */ }
                });
            });
        };

        const removeFromScope = (key: string) => {
            scopeKeys.forEach((keys) => keys.delete(key));
        };

        const removeActionFromScopes = (name: string) => {
            actionScopes.forEach((names) => names.delete(name));
        };

        const validateActionInvocation = async (name: string, args: unknown[], action?: RegisteredAction): Promise<MindActionResult | null> => {
            if (!Array.isArray(args)) {
                return createActionError(ACTION_INVALID_INPUT, 'Action args must be provided as an array.');
            }

            if (!action) {
                return createActionError(ACTION_NOT_FOUND, `Action "${name}" is not registered.`);
            }

            const timeoutMs = action.options?.timeoutMs ?? options.defaultActionTimeoutMs;
            if (timeoutMs !== undefined && !isValidTimeout(timeoutMs)) {
                return createActionError(ACTION_INVALID_INPUT, `Action "${name}" has an invalid timeout configuration.`);
            }

            if (!action.options?.validate) {
                return null;
            }

            try {
                const validationResult = await action.options.validate(args);

                if (validationResult === true) {
                    return null;
                }

                if (validationResult === false) {
                    return createActionError(ACTION_VALIDATION_FAILED, `Action "${name}" validation failed.`);
                }

                if (typeof validationResult === 'string') {
                    return createActionError(ACTION_VALIDATION_FAILED, validationResult);
                }

                return createActionError(
                    validationResult.errorCode ?? ACTION_VALIDATION_FAILED,
                    validationResult.message ?? `Action "${name}" validation failed.`,
                );
            } catch (error) {
                return createActionError(
                    ACTION_VALIDATION_FAILED,
                    toErrorMessage(error, `Action "${name}" validation failed.`),
                );
            }
        };

        const registry: MindContextRegistry = {
            set(key, value, scope) {
                try {
                    store.set(key, value);
                    if (scope) {
                        if (!scopeKeys.has(scope)) scopeKeys.set(scope, new Set());
                        scopeKeys.get(scope)!.add(key);
                    }
                    notifyChange([key]);
                } catch { /* never crash the host app */ }
            },
            clear(key) {
                try {
                    store.delete(key);
                    removeFromScope(key);
                    notifyChange([key]);
                } catch { }
            },
            clearScope(scope) {
                try {
                    const keys = scopeKeys.get(scope);
                    if (keys) {
                        keys.forEach((key) => store.delete(key));
                        scopeKeys.delete(scope);
                        notifyChange(Array.from(keys));
                    }
                } catch { }
            },
            clearAll() {
                try {
                    const keys = Array.from(store.keys());
                    store.clear();
                    scopeKeys.clear();
                    notifyChange(keys);
                } catch { }
            },
            resetContext(scope) {
                try {
                    if (scope) {
                        registry.clearScope(scope);
                        return;
                    }

                    registry.clearAll();
                } catch { }
            },
            snapshot() {
                try {
                    return Object.fromEntries(store);
                } catch {
                    return {};
                }
            },
            subscribe(listener) {
                changeListeners.add(listener);
                return () => {
                    changeListeners.delete(listener);
                };
            },
            subscribeKey(keys, listener) {
                const keyList = Array.isArray(keys) ? keys : [keys];
                keyList.forEach((key) => {
                    if (!keyChangeListeners.has(key)) keyChangeListeners.set(key, new Set());
                    keyChangeListeners.get(key)!.add(listener);
                });
                return () => {
                    keyList.forEach((key) => {
                        const listeners = keyChangeListeners.get(key);
                        listeners?.delete(listener);
                        if (listeners && !listeners.size) keyChangeListeners.delete(key);
                    });
                };
            },
            registerAction(name, fn, actionOptions) {
                try {
                    actionMap.set(name, { fn, options: actionOptions });
                    removeActionFromScopes(name);

                    if (actionOptions?.scope) {
                        if (!actionScopes.has(actionOptions.scope)) {
                            actionScopes.set(actionOptions.scope, new Set());
                        }
                        actionScopes.get(actionOptions.scope)?.add(name);
                    }
                } catch { }
            },
            unregisterAction(name) {
                try {
                    actionMap.delete(name);
                    removeActionFromScopes(name);
                } catch { }
            },
            resetActions(scope) {
                try {
                    if (scope) {
                        const scopedActions = actionScopes.get(scope);
                        scopedActions?.forEach((name) => actionMap.delete(name));
                        actionScopes.delete(scope);
                        return;
                    }

                    actionMap.clear();
                    actionScopes.clear();
                } catch { }
            },
            resetAll() {
                try {
                    registry.resetContext();
                    registry.resetActions();
                } catch { }
            },
            async invokeAction(name, args = []) {
                try {
                    const action = actionMap.get(name);
                    const validationFailure = await validateActionInvocation(name, args, action);

                    if (validationFailure) {
                        return validationFailure;
                    }

                    const timeoutMs = action?.options?.timeoutMs ?? options.defaultActionTimeoutMs;

                    try {
                        const result = await runWithTimeout(
                            () => Promise.resolve(action!.fn(...args)),
                            timeoutMs,
                        );
                        return normalizeActionResult(result);
                    } catch (error) {
                        if (error instanceof Error && error.message === ACTION_TIMEOUT) {
                            return createActionError(
                                ACTION_TIMEOUT,
                                `Action "${name}" timed out${typeof timeoutMs === 'number' ? ` after ${timeoutMs}ms` : ''}.`,
                            );
                        }

                        return createActionError(
                            ACTION_EXECUTION_FAILED,
                            toErrorMessage(error, `Action "${name}" failed.`),
                        );
                    }
                } catch (error) {
                    return createActionError(
                        ACTION_EXECUTION_FAILED,
                        toErrorMessage(error, `Action "${name}" failed.`),
                    );
                }
            },
            listActions() {
                try {
                    return Array.from(actionMap.keys());
                } catch {
                    return [];
                }
            },
        };

        registerOnWindow(appName, registry, actionMap);
        return registry;
    } catch {
        return createNoopRegistry();
    }
}
