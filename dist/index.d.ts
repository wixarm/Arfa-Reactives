type Cleanup = void | (() => void);
export declare function setGlobalRerender(fn: (() => void) | null): void;
export declare function registerInstanceRerender(id: symbol, fn: () => void): void;
export declare function unregisterInstanceRerender(id: symbol): void;
export declare function createComponentInstance(): symbol;
export declare function setCurrentInstance(id: symbol | null): void;
export declare function clearCurrentInstance(): void;
export declare function cleanupComponentInstance(id: symbol): void;
export declare function runMounted(id: symbol): void;
export declare function triggerEffectsForAllInstances(): void;
export declare function onMounted(cb: () => void): void;
export declare function onUnmounted(cb: () => void): void;
export declare function onEffect(effect: () => Cleanup, deps?: any[]): () => void;
type PersistOptions<T> = {
    key: string;
    version?: number;
    keyPrefix?: string;
    serialize?: (v: T) => string;
    deserialize?: (s: string) => T;
    sync?: boolean;
};
type RefOptions<T> = {
    persist?: PersistOptions<T>;
};
export declare function ref<T = any>(initial?: T): [
    (() => T) & {
        _isRefGetter?: true;
    },
    (val: T | ((prev: T | undefined) => T)) => void
];
export declare function ref<T = any>(initial: T | undefined, options: RefOptions<T>): [
    (() => T) & {
        _isRefGetter?: true;
    },
    (val: T | ((prev: T | undefined) => T)) => void
];
type Getter<T> = (() => T) & {
    _isRefGetter?: true;
    __subscribe?: (cb: () => void) => void;
    __unsubscribe?: (cb: () => void) => void;
};
export type Context<T> = {
    _id: symbol;
    _defaultGetter: Getter<T>;
    _stack: Getter<T>[];
};
export declare function createContext<T>(defaultValue: T): Context<T>;
/**
 * useContext(ctx)
 * - Reads the nearest provided value (or default).
 * - Subscribes this component instance to updates from the underlying ref getter,
 *   so a ref.set(...) in the provider re-renders the consumer.
 */
export declare function useContext<T>(ctx: Context<T>): T;
/**
 * withContext(ctx, valueOrGetter, render)
 * A minimal Provider helper you can use in your renderer:
 *
 * withContext(MyCtx, someRefGetter /* or constant * /, () => {
 *   // render children under this context
 * });
 *
 * - Pushes the provider getter for the duration of render()
 * - If the binding changed (different getter identity vs. previously at this stack level),
 *   it triggers a global re-run so consumers can resubscribe to the new getter.
 */
export declare function withContext<T, R>(ctx: Context<T>, valueOrGetter: T | Getter<T>, render: () => R): R;
export declare function onMemo<T>(factory: () => T, deps?: any[]): T;
export declare function onComputed<T>(factory: () => T, deps: any[]): (() => T) & {
    _isRefGetter?: true;
};
export {};
