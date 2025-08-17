type Cleanup = void | (() => void);
type EffectRecord = {
  effect: () => Cleanup;
  deps: any[] | undefined;
  lastDeps?: any[];
  cleanup?: (() => void) | void;
};

type InstanceRecord = {
  mounted: Array<() => void>;
  effects: EffectRecord[];
};

const instances = new Map<symbol, InstanceRecord>();
let currentInstance: symbol | null = null;
let globalRerender: (() => void) | null = null;

export function setGlobalRerender(fn: (() => void) | null) {
  globalRerender = fn;
}

export function createComponentInstance(): symbol {
  const id = Symbol("comp");
  instances.set(id, { mounted: [], effects: [] });
  return id;
}

export function setCurrentInstance(id: symbol | null) {
  currentInstance = id;
}

export function clearCurrentInstance() {
  currentInstance = null;
}

export function cleanupComponentInstance(id: symbol) {
  const rec = instances.get(id);
  if (!rec) return;
  // run effect cleanups
  for (const e of rec.effects) {
    if (typeof e.cleanup === "function") {
      try {
        e.cleanup();
      } catch {}
    }
  }
  instances.delete(id);
}

export function runMounted(id: symbol) {
  const rec = instances.get(id);
  if (!rec) return;
  // call mounted callbacks
  for (const cb of rec.mounted) {
    try {
      cb();
    } catch (err) {
      console.error(err);
    }
  }
  // run effects initial
  runEffectsForInstance(id);
}

function getDepValue(dep: any) {
  try {
    if (typeof dep === "function" && (dep as any)._isRefGetter) {
      return dep();
    }
  } catch {}
  return dep;
}

function depsChanged(last?: any[], next?: any[]) {
  if (!last) return true;
  if (!next) return true;
  if (last.length !== next.length) return true;
  for (let i = 0; i < next.length; i++) {
    if (!Object.is(last[i], next[i])) return true;
  }
  return false;
}

function runEffectsForInstance(id: symbol) {
  const rec = instances.get(id);
  if (!rec) return;
  for (const eff of rec.effects) {
    const nextDeps = eff.deps?.map(getDepValue);
    const changed = depsChanged(eff.lastDeps, nextDeps);
    if (changed) {
      if (typeof eff.cleanup === "function") {
        try {
          eff.cleanup();
        } catch {}
      }
      try {
        const possibleCleanup = eff.effect();
        eff.cleanup =
          typeof possibleCleanup === "function" ? possibleCleanup : undefined;
      } catch (err) {
        console.error(err);
        eff.cleanup = undefined;
      }
      eff.lastDeps = nextDeps;
    }
  }
}

export function triggerEffectsForAllInstances() {
  for (const id of instances.keys()) {
    runEffectsForInstance(id);
  }
}

export function onMounted(cb: () => void) {
  if (!currentInstance) {
    throw new Error(
      "onMounted must be called during component render (set current instance with setCurrentInstance)."
    );
  }
  const rec = instances.get(currentInstance)!;
  rec.mounted.push(cb);
}

export function onEffect(effect: () => Cleanup, deps?: any[]) {
  if (!currentInstance) {
    throw new Error(
      "onEffect must be called during component render (set current instance with setCurrentInstance)."
    );
  }
  const rec = instances.get(currentInstance)!;
  const record: EffectRecord = {
    effect,
    deps: deps ? deps.slice() : undefined,
    lastDeps: undefined,
    cleanup: undefined,
  };
  rec.effects.push(record);
  // return cleanup runner
  return () => {
    if (typeof record.cleanup === "function") {
      try {
        record.cleanup();
      } catch {}
      record.cleanup = undefined;
    }
    // remove effect from list
    const idx = rec.effects.indexOf(record);
    if (idx >= 0) rec.effects.splice(idx, 1);
  };
}

export function ref<T = any>(
  initial?: T
): [
  (() => T) & { _isRefGetter?: true },
  (val: T | ((prev: T | undefined) => T)) => void
] {
  let value = initial as T | undefined;
  const subs = new Set<() => void>();
  const getter = (() => value) as any;
  getter._isRefGetter = true;
  function setter(val: T | ((prev: T | undefined) => T)) {
    const next = typeof val === "function" ? (val as any)(value) : val;
    const changed = !Object.is(value, next);
    value = next;
    if (changed) {
      for (const s of subs) {
        try {
          s();
        } catch {}
      }
      if (globalRerender) {
        try {
          globalRerender();
        } catch {}
      } else {
        // if no globalReRender is set, still run effects for instances
        triggerEffectsForAllInstances();
      }
    }
  }
  (getter as any).__subscribe = (cb: () => void) => subs.add(cb);
  (getter as any).__unsubscribe = (cb: () => void) => subs.delete(cb);
  return [getter, setter];
}
