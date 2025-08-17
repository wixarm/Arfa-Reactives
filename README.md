# arfa-reactives

Tiny reactive hooks for Arfa-style components.

## Install

npm i arfa-reactives

## Exports

- `ref(initial?)` → `[getter, setter]` (getter is a zero-arg function; setter updates value)
- `onMounted(cb)` → register a mounted callback (must be called while a component is running)
- `onEffect(effect, deps?)` → register effect with deps array; returns cleanup remover
- `createComponentInstance()` → create instance id (renderer)
- `setCurrentInstance(id)` / `clearCurrentInstance()` → mark which instance is current during component execution
- `runMounted(instanceId)` → call after DOM insertion to run mounted callbacks and initial effects
- `cleanupComponentInstance(id)` → call before discarding instance to run effect cleanups
- `setGlobalRerender(fn)` → optional: set a global re-render function that `ref` will call on updates
