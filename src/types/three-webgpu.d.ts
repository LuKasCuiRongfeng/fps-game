import type * as THREE from 'three';

declare module 'three/webgpu' {
    export interface WebGPURenderer {
        computeAsync(computeNode: unknown): Promise<void>;
        compileAsync(scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
    }

    export interface PostProcessing {
        render(): Promise<void>;
        dispose(): void;
    }

    export class StorageBufferAttribute extends THREE.BufferAttribute {
        constructor(array: ArrayLike<number>, itemSize: number);
        dispose(): void;
    }
}
