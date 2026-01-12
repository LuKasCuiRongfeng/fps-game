import type * as THREE from 'three';
import type { StorageBufferAttribute } from 'three/webgpu';

import type { GPUComputeSystem } from '../../shaders/GPUCompute';
import type { GPUParticleSystem, EmitterConfig } from '../../shaders/GPUParticles';

export interface EnemyComputeSimulation {
    updateEnemies(delta: number, playerPos: THREE.Vector3): void;
    setEnemyData(index: number, position: THREE.Vector3, target: THREE.Vector3, speed: number, health: number): void;
    /** Sync current CPU position into the GPU storage buffer (keeps hybrid sim stable). */
    setEnemyPosition(index: number, position: THREE.Vector3): void;
    setEnemyTarget(index: number, target: THREE.Vector3): void;
    setEnemyActive(index: number, active: boolean): void;

    /** 0 = render CPU rig, 1 = render GPU impostor instance */
    setEnemyRenderMode(index: number, mode: 0 | 1): void;

    /** Read back last simulated position (may be 1 frame delayed depending on backend). */
    readEnemyPosition(index: number, out: THREE.Vector3): THREE.Vector3;

    /** GPU storage buffers for vertex-stage access (GPU-driven rendering). */
    getEnemyPositionBuffer(): StorageBufferAttribute;
    getEnemyStateBuffer(): StorageBufferAttribute;
    getEnemyColorBuffer(): StorageBufferAttribute;
    getMaxEnemies(): number;

    /** Per-enemy base color for GPU-driven rendering (rgb in 0..1). */
    setEnemyColor(index: number, color: THREE.Color): void;
}

export interface ParticleSimulation {
    update(delta: number): void;
    emit(config: EmitterConfig): void;
    emitBlood(position: THREE.Vector3, direction: THREE.Vector3, count: number): void;
    emitSparks(position: THREE.Vector3, normal: THREE.Vector3, count: number): void;
    emitMuzzleFlash(position: THREE.Vector3, direction: THREE.Vector3): void;
}

export type GpuSimulationFacade = {
    enemies: EnemyComputeSimulation;
    particles: ParticleSimulation;
};

export function createWebGpuSimulationFacade(opts: {
    gpuCompute: GPUComputeSystem;
    particleSystem: GPUParticleSystem;
}): GpuSimulationFacade {
    return {
        enemies: opts.gpuCompute,
        particles: opts.particleSystem,
    };
}
