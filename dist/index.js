const instances = new Map();
let currentInstance = null;
let globalRerender = null;
function setGlobalRerender(fn) {
  globalRerender = fn;
}
function createComponentInstance() {
  const id = Symbol("comp");
  instances.set(id, { mounted: [], effects: [] });
  return id;
}
function setCurrentInstance(id) {
  currentInstance = id;
}
function clearCurrentInstance() {
  currentInstance = null;
}
function cleanupComponentInstance(id) {
  const rec = instances.get(id);
  if (!rec) return;
  for (const e of rec.effects) {
    if (typeof e.cleanup === "function") {
      try {
        e.cleanup();
      } catch {}
    }
  }
  instances.delete(id);
}
function runMounted(id) {
  const rec = instances.get(id);
  if (!rec) return;
  for (const cb of rec.mounted) {
    try {
      cb();
    } catch (err) {
      console.error(err);
    }
  }
  runEffectsForInstance(id);
}
function getDepValue(dep) {
  try {
    if (typeof dep === "function" && dep._isRefGetter) {
      return dep();
    }
  } catch {}
  return dep;
}
function depsChanged(last, next) {
  if (!last) return true;
  if (!next) return true;
  if (last.length !== next.length) return true;
  for (let i = 0; i < next.length; i++) {
    if (!Object.is(last[i], next[i])) return true;
  }
  return false;
}
function runEffectsForInstance(id) {
  const rec = instances.get(id);
  if (!rec) return;
  for (const eff of rec.effects) {
    const nextDeps = eff.deps ? eff.deps.map(getDepValue) : undefined;
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
function triggerEffectsForAllInstances() {
  for (const id of instances.keys()) {
    runEffectsForInstance(id);
  }
}
function onMounted(cb) {
  if (!currentInstance) {
    throw new Error(
      "onMounted must be called during component render (set current instance with setCurrentInstance)."
    );
  }
  const rec = instances.get(currentInstance);
  rec.mounted.push(cb);
}
function onEffect(effect, deps) {
  if (!currentInstance) {
    throw new Error(
      "onEffect must be called during component render (set current instance with setCurrentInstance)."
    );
  }
  const rec = instances.get(currentInstance);
  const record = {
    effect,
    deps: deps ? deps.slice() : undefined,
    lastDeps: undefined,
    cleanup: undefined,
  };
  rec.effects.push(record);
  return () => {
    if (typeof record.cleanup === "function") {
      try {
        record.cleanup();
      } catch {}
      record.cleanup = undefined;
    }
    const idx = rec.effects.indexOf(record);
    if (idx >= 0) rec.effects.splice(idx, 1);
  };
}
function ref(initial) {
  let value = initial;
  const subs = new Set();
  const getter = () => value;
  getter._isRefGetter = true;
  function setter(val) {
    const next = typeof val === "function" ? val(value) : val;
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
        triggerEffectsForAllInstances();
      }
    }
  }
  getter.__subscribe = (cb) => subs.add(cb);
  getter.__unsubscribe = (cb) => subs.delete(cb);
  return [getter, setter];
}
export {
  cleanupComponentInstance,
  clearCurrentInstance,
  createComponentInstance,
  onEffect,
  onMounted,
  ref,
  runMounted,
  setCurrentInstance,
  setGlobalRerender,
  triggerEffectsForAllInstances,
};
export default null;
