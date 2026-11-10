import type { MindActionFn, MindActionOptions, MindContextRegistry } from '../index';

export interface AngularMindContextOptions {
    scope?: string;
}

/**
 * Registers a cleanup callback with Angular's DestroyRef and returns an update
 * function the component/service calls whenever the value changes.
 *
 * Usage (Angular 16+ with inject()):
 *   const update = bindMindContext(registry, 'selectedWebId', inject(DestroyRef));
 *   effect(() => update(mySignal()));
 *
 * Usage with RxJS:
 *   observable$.pipe(takeUntilDestroyed(destroyRef)).subscribe(v => update(v));
 */
export function bindMindContext(
    registry: MindContextRegistry,
    key: string,
    destroyRef: { onDestroy(fn: () => void): void },
    options: AngularMindContextOptions = {},
): (value: unknown) => void {
    try {
        destroyRef.onDestroy(() => registry.clear(key));
        return (value: unknown) => registry.set(key, value, options.scope);
    } catch {
        return () => {};
    }
}

/**
 * Registers an action and automatically unregisters it when the Angular host is destroyed.
 */
export function bindMindAction(
    registry: MindContextRegistry,
    name: string,
    destroyRef: { onDestroy(fn: () => void): void },
    fn: MindActionFn,
    options?: MindActionOptions,
): void {
    try {
        registry.registerAction(name, fn, options);
        destroyRef.onDestroy(() => registry.unregisterAction(name));
    } catch { /* never crash the host app */ }
}
