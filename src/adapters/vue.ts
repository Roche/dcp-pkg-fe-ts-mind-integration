import { watch, onUnmounted, type WatchSource } from 'vue';
import type { MindActionFn, MindActionOptions, MindContextRegistry } from '../index';

export interface UseMindContextOptions {
    scope?: string;
    /** Set the current value immediately on mount. Defaults to true. */
    immediate?: boolean;
}

/**
 * Watches a reactive source, writes it to the registry, and clears on unmount.
 * Must be called inside a Vue component setup context.
 */
export function useMindContext(
    registry: MindContextRegistry,
    key: string,
    source: WatchSource,
    options: UseMindContextOptions = {},
): void {
    try {
        const stop = watch(
            source,
            (value) => registry.set(key, value, options.scope),
            { immediate: options.immediate ?? true },
        );
        onUnmounted(() => {
            registry.clear(key);
            stop();
        });
    } catch { /* never crash the host app */ }
}

/**
 * Registers an action for the lifetime of the current Vue setup context.
 * Must be called inside a Vue component or composable setup context.
 */
export function useMindAction(
    registry: MindContextRegistry,
    name: string,
    fn: MindActionFn,
    options?: MindActionOptions,
): void {
    try {
        registry.registerAction(name, fn, options);
        onUnmounted(() => {
            registry.unregisterAction(name);
        });
    } catch { /* never crash the host app */ }
}
