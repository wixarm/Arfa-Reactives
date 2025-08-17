type Cleanup = void | (() => void);
export declare function setGlobalRerender(fn: (() => void) | null): void;
export declare function createComponentInstance(): symbol;
export declare function setCurrentInstance(id: symbol | null): void;
export declare function clearCurrentInstance(): void;
export declare function cleanupComponentInstance(id: symbol): void;
export declare function runMounted(id: symbol): void;
export declare function triggerEffectsForAllInstances(): void;
export declare function onMounted(cb: () => void): void;
export declare function onEffect(effect: () => Cleanup, deps?: any[]): () => void;
export declare function ref<T = any>(initial?: T): [
    (() => T) & {
        _isRefGetter?: true;
    },
    (val: T | ((prev: T | undefined) => T)) => void
];
export {};
