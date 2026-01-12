import * as THREE from "three";
import { MeshBasicNodeMaterial, type StorageBufferAttribute } from "three/webgpu";
import {
    storage,
    instanceIndex,
    positionLocal,
    vec2,
    vec3,
    float,
    floor,
    sin,
    cos,
    atan,
    mix,
    smoothstep,
    select,
    uniform,
    clamp,
} from "three/tsl";

import type { System, FrameContext } from "../core/engine/System";
import type { RuntimeSettingsSource } from "../core/settings/RuntimeSettings";

export type FlowFieldDebugSystemDeps = {
    scene: THREE.Scene;
    settings: RuntimeSettingsSource;
    gpuCompute: {
        getNavDebugView(): {
            gridSize: number;
            cellSize: number;
            offset: number;
            cellCount: number;
            dirBuffer: StorageBufferAttribute;
            walkableBuffer: StorageBufferAttribute;
            costBuffer: StorageBufferAttribute;
        };
    };
};

export class FlowFieldDebugSystem implements System {
    public readonly name = "flow-field-debug";

    private static readonly BUILD_TAG = 'ffdebug-dir+cost-v1-20260113';

    private readonly scene: THREE.Scene;
    private readonly settings: RuntimeSettingsSource;
    private readonly gpuCompute: FlowFieldDebugSystemDeps["gpuCompute"];

    private enabled = false;
    private lastEnabled = false;
    private logTimer = 0;

    private dirMesh: THREE.InstancedMesh | null = null;
    private costMesh: THREE.InstancedMesh | null = null;
    private meshCellCount = 0;

    // Sanity marker: helps debug "mesh exists but nothing is visible".
    private marker: THREE.Mesh | null = null;
    private axes: THREE.AxesHelper | null = null;

    // Runtime-tunable
    private stride = 2;
    private radius = 70;
    private height = 0.12;
    private alpha = 0.85;
    private readonly costAlpha = 0.65;

    // uniforms for shader-side culling
    private readonly playerPos = uniform(new THREE.Vector3());
    private readonly gridSize = uniform(1);
    private readonly cellSize = uniform(1);
    private readonly offset = uniform(0);
    private readonly strideU = uniform(2);
    private readonly radiusU = uniform(70);
    private readonly heightU = uniform(0.12);
    private readonly alphaU = uniform(0.85);
    private readonly maxCostU = uniform(200);

    constructor(deps: FlowFieldDebugSystemDeps) {
        this.scene = deps.scene;
        this.settings = deps.settings;
        this.gpuCompute = deps.gpuCompute;
    }

    public update(frame: FrameContext): void {
        // Read settings every frame (cheap) so UI changes apply immediately.
        this.refreshFromRuntimeSettings();

        // Throttled diagnostics: helps confirm the overlay is actually being built/rendered.
        this.logTimer += frame.delta;
        if (this.enabled !== this.lastEnabled) {
            this.lastEnabled = this.enabled;
            try {
                console.info('[flowFieldDebug]', this.enabled ? 'enabled' : 'disabled', {
                    build: FlowFieldDebugSystem.BUILD_TAG,
                    stride: this.stride,
                    radius: this.radius,
                    height: this.height,
                    alpha: this.alpha,
                });
            } catch {
                // ignore
            }
        }

        if (!this.enabled) {
            if (this.dirMesh) this.setMeshVisible(this.dirMesh, false);
            if (this.costMesh) this.setMeshVisible(this.costMesh, false);
            this.setMarkerVisible(false);
            return;
        }

        this.ensureMarker();
        this.updateMarker(frame);
        this.setMarkerVisible(true);

        const view = this.gpuCompute.getNavDebugView();

        if (this.logTimer >= 2.0) {
            this.logTimer = 0;
            try {
                console.info('[flowFieldDebug] tick', {
                    dirMesh: !!this.dirMesh,
                    costMesh: !!this.costMesh,
                    meshCellCount: this.meshCellCount,
                    marker: !!this.marker,
                    axes: !!this.axes,
                    sceneChildren: (this.scene as any)?.children?.length,
                    nav: {
                        gridSize: view.gridSize,
                        cellSize: view.cellSize,
                        offset: view.offset,
                        cellCount: view.cellCount,
                    },
                    settings: {
                        stride: this.stride,
                        radius: this.radius,
                        height: this.height,
                        alpha: this.alpha,
                    },
                });
            } catch {
                // ignore
            }
        }
        this.gridSize.value = view.gridSize;
        this.cellSize.value = view.cellSize;
        this.offset.value = view.offset;

        this.strideU.value = this.stride;
        this.radiusU.value = this.radius;
        this.heightU.value = this.height;
        this.alphaU.value = this.alpha;
        // A reasonable upper bound for visualization: roughly "cells within radius".
        // This doesn't need to be exact to be useful.
        this.maxCostU.value = Math.max(1, Math.floor(this.radius * 1.25));

        this.playerPos.value.set(frame.playerPos.x, frame.playerPos.y, frame.playerPos.z);

        if (!this.dirMesh || !this.costMesh || this.meshCellCount !== view.cellCount) {
            this.rebuildMesh(view);
        }

        if (this.dirMesh) this.setMeshVisible(this.dirMesh, true);
        if (this.costMesh) this.setMeshVisible(this.costMesh, true);
    }

    private refreshRuntimeToggles(): void {
        // kept for compatibility
    }

    private refreshFromRuntimeSettings(): void {
        const s = this.settings.getRuntimeSettings();
        this.enabled = !!s.flowFieldDebugEnabled;
        this.stride = Math.max(1, Math.floor(s.flowFieldDebugStride || 1));
        this.radius = Math.max(0, s.flowFieldDebugRadius);
        this.height = s.flowFieldDebugHeight;
        this.alpha = Math.min(1, Math.max(0, s.flowFieldDebugAlpha));
    }

    private setMeshVisible(mesh: THREE.Object3D, visible: boolean): void {
        mesh.visible = visible;
    }

    private setMarkerVisible(visible: boolean): void {
        if (this.marker) this.marker.visible = visible;
        if (this.axes) this.axes.visible = visible;
    }

    private ensureMarker(): void {
        if (!this.marker) {
            const geo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
            const mat = new THREE.MeshBasicMaterial({
                color: 0xff00ff,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 1.0,
            });
            const marker = new THREE.Mesh(geo, mat);
            marker.frustumCulled = false;
            marker.renderOrder = 1000;
            this.scene.add(marker);
            this.marker = marker;
        }

        if (!this.axes) {
            const axes = new THREE.AxesHelper(10);
            axes.frustumCulled = false;
            axes.renderOrder = 1000;
            this.scene.add(axes);
            this.axes = axes;
        }
    }

    private updateMarker(frame: FrameContext): void {
        // Put the marker slightly offset from the player/camera so it's not inside the camera.
        if (this.marker) {
            this.marker.position.set(frame.playerPos.x + 2.0, frame.playerPos.y, frame.playerPos.z);
        }
        // Keep axes at origin; player spawns near (0,0,0) so it should be easy to spot.
        if (this.axes) {
            this.axes.position.set(0, 0, 0);
        }
    }

    private rebuildMesh(view: {
        gridSize: number;
        cellSize: number;
        offset: number;
        cellCount: number;
        dirBuffer: StorageBufferAttribute;
        walkableBuffer: StorageBufferAttribute;
        costBuffer: StorageBufferAttribute;
    }): void {
        this.disposeMesh();

        try {
            console.info('[flowFieldDebug] rebuildMesh', {
                gridSize: view.gridSize,
                cellSize: view.cellSize,
                offset: view.offset,
                cellCount: view.cellCount,
            });
        } catch {
            // ignore
        }

        // (1) Direction glyphs: a vertical quad in the X/Y plane (faces +Z). Visible from FPS camera.
        // We rotate around Y in the shader to point along the flow direction.
        const dirGeometry = new THREE.PlaneGeometry(1.0, 1.0);

        // (2) Cost heatmap: a horizontal quad (XZ) so you can see the scalar field at a glance.
        const costGeometry = new THREE.PlaneGeometry(1.0, 1.0);
        costGeometry.rotateX(-Math.PI / 2);

        const dirStorage = storage(view.dirBuffer, "vec2", view.cellCount);
        const walkableStorage = storage(view.walkableBuffer, "float", view.cellCount);
        const costStorage = storage(view.costBuffer, "float", view.cellCount);

        const gridSize = this.gridSize;
        const cellSize = this.cellSize;
        const offset = this.offset;
        const stride = this.strideU;
        const radius = this.radiusU;
        const height = this.heightU;
        const baseAlpha = this.alphaU;
        const maxCost = this.maxCostU;

        const index = instanceIndex;

        // IMPORTANT: keep coordinate math in float space.
        // Some TSL integer ops (`mod`/`div` on `instanceIndex`) can end up as u32 WGSL and interact poorly
        // with float uniforms on some drivers. Derive (gx,gz) from float + floor instead.
        const idxF = float(index);
        const gSizeF = float(gridSize);
        const gz = floor(idxF.div(gSizeF));
        const gx = idxF.sub(gz.mul(gSizeF));

        const stepOkX = gx.mod(stride).lessThan(0.5);
        const stepOkZ = gz.mod(stride).lessThan(0.5);
        const stepOk = select(stepOkX, float(1.0), float(0.0)).mul(select(stepOkZ, float(1.0), float(0.0)));

        // Cell center in world space (matches gx = floor(x/cellSize + offset)).
        const worldX = gx.sub(offset).add(0.5).mul(cellSize);
        const worldZ = gz.sub(offset).add(0.5).mul(cellSize);

        const dx = this.playerPos.x.sub(worldX);
        const dz = this.playerPos.z.sub(worldZ);
        const dist = dx.mul(dx).add(dz.mul(dz));
        const inRadius = dist.lessThan(radius.mul(radius));

        const show = stepOk.mul(select(inRadius, float(1.0), float(0.0)));

        const walkable = walkableStorage.element(index);
        const isWalkable = walkable.greaterThan(0.5);
        const walkT = select(isWalkable, float(1.0), float(0.0));

        const dir = dirStorage.element(index);
        const angle = atan(dir.y, dir.x);
        const s = sin(angle);
        const c = cos(angle);

        const local = positionLocal;

        // Scale arrow to the nav cell.
        const scaleX = cellSize.mul(0.85);
        const scaleY = cellSize.mul(0.35);
        const p = local.mul(vec3(scaleX, scaleY, 1.0));

        // Rotate around Y.
        const rx = p.x.mul(c).sub(p.z.mul(s));
        const rz = p.x.mul(s).add(p.z.mul(c));

        const hiddenY = float(-9999.0);
        // Place the overlay at a player-relative height to avoid being buried under uneven terrain.
        const overlayY = this.playerPos.y.add(height);
        const y = mix(hiddenY, overlayY, show);

        // Include local Y so the quad has height.
        const worldPos = vec3(worldX, y, worldZ).add(vec3(rx, p.y, rz));

        // ---------- Direction material ----------
        const dirMaterial = new MeshBasicNodeMaterial();
        dirMaterial.transparent = true;
        dirMaterial.depthWrite = false;
        // Depth test ON so these don't paint over the entire screen and hide the heatmap.
        dirMaterial.depthTest = true;
        dirMaterial.side = THREE.DoubleSide;
        dirMaterial.fog = false;
        dirMaterial.toneMapped = false;

        // Fade gently near the debug radius edge.
        const r2 = radius.mul(radius);
        const edge = smoothstep(r2.mul(0.75), r2, dist);
        const edgeFade = float(1.0).sub(edge);
        // Keep glyphs readable but not overwhelming.
        const opacity = baseAlpha.mul(0.35).mul(show).mul(edgeFade);

        // Direction-colored glyphs:
        // - Walkable cells: hue encodes direction angle; brightness encodes inverse cost
        // - Blocked cells: neutral gray
        // - Invalid/INF cost: magenta
        // - Near-zero direction: magenta
        const blockedColor = vec3(0.25, 0.25, 0.25);
        const infMagenta = vec3(1.0, 0.0, 1.0);

        const dirLen = dir.x.mul(dir.x).add(dir.y.mul(dir.y)).sqrt();
        const hasDir = dirLen.greaterThan(0.05);
        const hasDirT = select(hasDir, float(1.0), float(0.0));

        // Direction hue (very cheap pseudo-HSV):
        // R varies with cos, G varies with sin, B constant.
        const hue = vec3(cos(angle).mul(0.5).add(0.5), sin(angle).mul(0.5).add(0.5), float(0.55));

        const cost = costStorage.element(index);
        const costValid = cost.lessThan(1.0e8);
        const validT = select(costValid, float(1.0), float(0.0));
        const costT = clamp(cost.div(maxCost), 0.0, 1.0);
        const brightness = float(1.0).sub(costT).mul(0.85).add(0.15);

        const walkHue = hue.mul(brightness);
        const walkDirOrMagenta = mix(infMagenta, walkHue, validT.mul(hasDirT));
        const walkOrBlocked = mix(blockedColor, walkDirOrMagenta, walkT);

        dirMaterial.colorNode = walkOrBlocked;
        dirMaterial.opacityNode = opacity;
        dirMaterial.positionNode = worldPos;

        // ---------- Cost material ----------
        const costMaterial = new MeshBasicNodeMaterial();
        costMaterial.transparent = true;
        costMaterial.depthWrite = false;
        costMaterial.depthTest = false;
        costMaterial.side = THREE.DoubleSide;
        costMaterial.fog = false;
        costMaterial.toneMapped = false;

        // NOTE: cost is already read above for the glyph coloring. Reuse the same `costT/validT` by
        // recomputing here (TSL nodes are immutable; this keeps the code straightforward).
        const cost2 = costStorage.element(index);
        const costT2 = clamp(cost2.div(maxCost), 0.0, 1.0);

        // If cost is still INF-ish, paint magenta so it's obvious the field hasn't propagated there yet.
        const costValid2 = cost2.lessThan(1.0e8);
        const validT2 = select(costValid2, float(1.0), float(0.0));

        // Simple 2-segment gradient: blue -> green -> red.
        const low = vec3(0.05, 0.3, 1.0);
        const mid = vec3(0.0, 1.0, 0.3);
        const high = vec3(1.0, 0.25, 0.05);

        const firstHalf = costT2.lessThan(0.5);
        const t01 = costT2.mul(2.0);
        const t12 = costT2.sub(0.5).mul(2.0);
        const grad01 = mix(low, mid, t01);
        const grad12 = mix(mid, high, t12);
        const costColor = mix(grad12, grad01, select(firstHalf, float(1.0), float(0.0)));
        const invalidColor = vec3(1.0, 0.0, 1.0);
        const finalCostColor = mix(invalidColor, costColor, validT2);

        // Put tiles near the ground (camera-relative). Using camera/playerPos.y directly puts tiles at eye level.
        const tileY = this.playerPos.y.sub(2.0).add(height.mul(0.25));
        const costWorldPos = vec3(worldX, tileY, worldZ).add(
            positionLocal.mul(vec3(cellSize.mul(0.98), 1.0, cellSize.mul(0.98)))
        );

        // Hide blocked cells and out-of-radius tiles. Add a subtle checker so this is obviously the heatmap.
        const checker = gx.add(gz).mod(2.0).lessThan(0.5);
        const checkerT = select(checker, float(0.85), float(1.0));
        const costOpacity = float(this.costAlpha).mul(show).mul(walkT).mul(edgeFade).mul(checkerT);
        costMaterial.colorNode = finalCostColor;
        costMaterial.opacityNode = costOpacity;
        costMaterial.positionNode = costWorldPos;

        const dirMesh = new THREE.InstancedMesh(dirGeometry, dirMaterial, view.cellCount);
        const costMesh = new THREE.InstancedMesh(costGeometry, costMaterial, view.cellCount);

        // WebGPU instancing relies on `instanceMatrix`. If matrices are left uninitialized, some paths end up
        // with zero/garbage transforms and nothing shows up. Keep them identity and do all positioning in the shader.
        const identity = new THREE.Matrix4();
        for (let i = 0; i < view.cellCount; i++) {
            dirMesh.setMatrixAt(i, identity);
            costMesh.setMatrixAt(i, identity);
        }
        dirMesh.instanceMatrix.needsUpdate = true;
        costMesh.instanceMatrix.needsUpdate = true;

        dirMesh.frustumCulled = false;
        dirMesh.castShadow = false;
        dirMesh.receiveShadow = false;
        dirMesh.renderOrder = 999;

        costMesh.frustumCulled = false;
        costMesh.castShadow = false;
        costMesh.receiveShadow = false;
        // Draw heatmap last so it remains visible even with many glyphs.
        costMesh.renderOrder = 1001;

        this.scene.add(dirMesh);
        this.scene.add(costMesh);
        this.dirMesh = dirMesh;
        this.costMesh = costMesh;
        this.meshCellCount = view.cellCount;

        try {
            console.info('[flowFieldDebug] mesh added', {
                instances: view.cellCount,
                dirVisible: dirMesh.visible,
                costVisible: costMesh.visible,
                dirRenderOrder: dirMesh.renderOrder,
                costRenderOrder: costMesh.renderOrder,
            });
        } catch {
            // ignore
        }
    }

    private disposeMesh(): void {
        if (this.dirMesh) {
            this.scene.remove(this.dirMesh);
            (this.dirMesh.geometry as THREE.BufferGeometry).dispose();
            (this.dirMesh.material as THREE.Material).dispose();
            this.dirMesh = null;
        }
        if (this.costMesh) {
            this.scene.remove(this.costMesh);
            (this.costMesh.geometry as THREE.BufferGeometry).dispose();
            (this.costMesh.material as THREE.Material).dispose();
            this.costMesh = null;
        }
        this.meshCellCount = 0;
    }

    private disposeMarker(): void {
        if (this.marker) {
            this.scene.remove(this.marker);
            (this.marker.geometry as THREE.BufferGeometry).dispose();
            (this.marker.material as THREE.Material).dispose();
            this.marker = null;
        }
        if (this.axes) {
            this.scene.remove(this.axes);
            // AxesHelper uses LineSegments + BufferGeometry internally.
            (this.axes.geometry as THREE.BufferGeometry).dispose();
            (this.axes.material as THREE.Material).dispose();
            this.axes = null;
        }
    }

    public dispose(): void {
        this.disposeMesh();
        this.disposeMarker();
    }
}
