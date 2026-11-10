export type MindContextSnapshot = Record<string, unknown>;
export type MindActionFn = (...args: unknown[]) => unknown | Promise<unknown>;

export interface MindActionResult {
    success: boolean;
    errorCode?: string;
    message?: string;
    data?: unknown;
}

export interface MindActionValidationFailure {
    errorCode?: string;
    message?: string;
}

export type MindActionValidatorResult = boolean | string | MindActionValidationFailure;
export type MindActionValidator = (args: unknown[]) => MindActionValidatorResult | Promise<MindActionValidatorResult>;

export interface MindActionOptions {
    scope?: string;
    timeoutMs?: number;
    validate?: MindActionValidator;
}

export interface MindContextRegistryOptions {
    defaultActionTimeoutMs?: number;
}

export type MindActionInvoker = (...args: unknown[]) => Promise<MindActionResult>;

export type MindContextChangeListener = (snapshot: MindContextSnapshot) => void;

export interface MindContextChangeEvent {
    snapshot: MindContextSnapshot;
    changedKeys: string[];
}

export type MindContextKeyChangeListener = (value: unknown, event: MindContextChangeEvent) => void;

export interface MindContextRegistry {
    set(key: string, value: unknown, scope?: string): void;
    clear(key: string): void;
    clearScope(scope: string): void;
    clearAll(): void;
    resetContext(scope?: string): void;
    snapshot(): MindContextSnapshot;
    /** Notified whenever the context store changes (set/clear/clearScope/clearAll). Returns an unsubscribe function. */
    subscribe(listener: MindContextChangeListener): () => void;
    /** Notified only when the given key(s) are affected by a change. Returns an unsubscribe function. */
    subscribeKey(keys: string | string[], listener: MindContextKeyChangeListener): () => void;
    registerAction(name: string, fn: MindActionFn, options?: MindActionOptions): void;
    unregisterAction(name: string): void;
    resetActions(scope?: string): void;
    resetAll(): void;
    invokeAction(name: string, args?: unknown[]): Promise<MindActionResult>;
    listActions(): string[];
}

declare global {
    interface Window {
        __DCP_MIND_CONTEXT__: Record<string, {
            snapshot: () => MindContextSnapshot;
            subscribe: (listener: MindContextChangeListener) => () => void;
            subscribeKey: (keys: string | string[], listener: MindContextKeyChangeListener) => () => void;
            invokeAction: (name: string, args?: unknown[]) => Promise<MindActionResult>;
            actions: Record<string, MindActionInvoker>;
            listActions: () => string[];
        }>;
    }
}
