import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

let enabled = false;

export function enableBVH() {
    if (enabled) return;
    enabled = true;

    // Patch prototypes once.
    THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
    THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

export function buildBVHForObject(root: THREE.Object3D) {
    root.traverse((obj) => {
        // Skip instanced meshes; BVH doesn't apply the same way and can be expensive.
        if (obj instanceof THREE.InstancedMesh) return;
        if (!(obj instanceof THREE.Mesh)) return;

        const geometry = obj.geometry as THREE.BufferGeometry | undefined;
        if (!geometry) return;

        // Already built
        if (geometry.boundsTree) return;

        // Some geometries might be non-indexed or tiny; still fine.
        // Build bounds tree for faster raycast.
        try {
            // three-mesh-bvh adds computeBoundsTree/disposeBoundsTree at runtime via prototype patch.
            geometry.computeBoundsTree?.();
        } catch {
            // If BVH build fails (rare), fall back to default raycast.
        }
    });
}
