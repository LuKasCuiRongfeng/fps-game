# Copilot instructions (fps-game)

## Big picture
- This is a Tauri app: React/Vite frontend in `src/`, Rust backend in `src-tauri/`.
- The game runtime is composed from `src/game/core/Game.ts` (composition root). React mostly mounts a container and displays UI overlays; do not put game logic in React components.
- Rendering is **Three.js WebGPU** (no compatibility fallback) and shaders should be written in **TSL** (Three Shading Language) whenever possible.

## Dev workflows (Windows)
- Frontend dev (browser/Vite): `pnpm dev` (fixed port `1420`, see `vite.config.ts`).
- Tauri dev/build: `pnpm tauri dev` / `pnpm tauri build` (uses `src-tauri/tauri.conf.json` which calls `pnpm dev` / `pnpm build`).
- Lint: `pnpm lint` (eslint runs on `src`).
- Local data server: `pnpm -C server install` then `node server/index.js` (serves `server/public` on `http://localhost:12345`).

## Runtime architecture conventions
- Prefer adding features as **Systems** (update loop units) instead of wiring logic directly into `Game`.
  - System interface: `src/game/core/engine/System.ts` (`update(frame)` + optional `dispose`).
  - Systems are registered in a fixed order via `createAndRegisterSystemGraph` in `src/game/core/composition/SystemGraphFactory.ts`.
  - To extend the update loop without coupling, use the `extendPhases` hook in `createAndRegisterSystemGraph`.
- GPU simulation is a first-class dependency:
  - Compute + particles are created in `src/game/core/composition/GpuSystemsFactory.ts`.
  - The façade used by systems is `src/game/core/gpu/GpuSimulationFacade.ts`.
- Initialization is staged and progress-aware:
  - `Game` runs an init pipeline (`src/game/core/init/*`) to avoid long blocking work and to support loading progress UI.

## Shaders / materials (project-specific)
- Centralize TSL materials/uniforms in `src/game/shaders/TSLMaterials.ts`.
  - `UniformManager` is a singleton used across systems; update it via `UniformUpdateSystem` rather than ad-hoc per-frame mutations.
- Prefer GPU compute for simulation/particles (see `src/game/shaders/GPUCompute.ts`, `src/game/shaders/GPUParticles.ts`).
- When adding new visual effects, prefer a TSL material/node graph or compute pipeline over CPU-side geometry updates.

## Services, events, UI
- Shared cross-cutting services live behind `GameServices` (`src/game/core/services/GameServices.ts`).
  - Game state updates are pushed to React via `services.state.subscribe(...)` (see `src/App.tsx`).
- Use the game event bus for decoupled gameplay reactions: `src/game/core/events/GameEventBus` + `DefaultGameEventHandlers`.

## Assets & Tauri integration
- Packaged static assets belong under `src-tauri/resources/`.
  - Audio is loaded through Rust (`src-tauri/src/lib.rs` command `load_audio_asset`) and bundled via `src-tauri/tauri.conf.json` resources.
  - If you add a new audio file, place it in `src-tauri/resources/audio/` and load it via `SoundManager` (`src/game/core/SoundManager.ts`).

## Config + tuning
- Gameplay tuning constants are centralized in `src/game/core/GameConfig.ts`; extend config there rather than scattering literals.

## PR-style guardrails for agents
- Keep `Game` as a composition root; add new functionality via new systems, factories, or shader modules.
- Avoid per-frame allocations in hot paths (systems receive a small `FrameContext` by design).
- 尽量使用 GPU 加速：能使用 GPU 加速就使用 GPU 加速，并且不考虑 CPU 回退。
- Do not introduce CPU fallback paths for rendering/simulation; WebGPU/TSL is the assumed baseline.
