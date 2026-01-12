import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { storage, instanceIndex, positionLocal, vec3, float, mix, sin, time } from 'three/tsl';
import type { System, FrameContext } from '../core/engine/System';
import { Enemy } from '../enemy/Enemy';
import { EnemyTypesConfig, EnemyConfig, EffectConfig, LevelConfig } from '../core/GameConfig';
import type { EnemyType } from '../core/GameConfig';
import type { GameServices } from '../core/services/GameServices';
import type { GameEventBus } from '../core/events/GameEventBus';
import { getRandomEnemyWeaponId } from '../weapon/WeaponDefinitions';
import type { WeaponId } from '../weapon/WeaponTypes';
import type { Level } from '../level/Level';
import type { PhysicsSystem } from '../core/PhysicsSystem';
import type { Pathfinding } from '../core/Pathfinding';
import type { EnemyComputeSimulation, ParticleSimulation, GpuSimulationFacade } from '../core/gpu/GpuSimulationFacade';
import type { EnemyTrailSystem } from './EnemyTrailSystem';
import { getUserData } from '../types/GameUserData';

export class EnemySystem implements System {
    public readonly name = 'enemies';

    private readonly scene: THREE.Scene;
    private readonly camera: THREE.PerspectiveCamera;
    private readonly objects: THREE.Object3D[];
    private readonly level: Level;
    private readonly physicsSystem: PhysicsSystem;
    private readonly pathfinding: Pathfinding;
    private readonly enemiesSim: EnemyComputeSimulation;
    private readonly particles: ParticleSimulation;
    private readonly trails: EnemyTrailSystem;
    private readonly services: GameServices;
    private readonly events: GameEventBus;

    private enemies: Enemy[] = [];
    private enemyPool: Map<string, Enemy[]> = new Map();
    private readonly enemyPoolMaxPerKey = 6;

    // GPU impostor rendering (true GPU-driven instancing)
    private enemyImpostorMesh: THREE.InstancedMesh | null = null;
    private gpuEnemyByIndex: Array<Enemy | null>;

    private static enemyImpostorGeometry: THREE.BufferGeometry | null = null;

    private readonly maxGpuEnemies: number;
    private nextGpuIndex = 0;
    private freeGpuIndices: number[] = [];

    private readonly tmpPlayerPos = new THREE.Vector3();
    private readonly tmpGpuPos = new THREE.Vector3();

    private tmpMuzzlePos = new THREE.Vector3();
    private tmpTrailEnd = new THREE.Vector3();

    constructor(opts: {
        services: GameServices;
        events: GameEventBus;
        scene: THREE.Scene;
        camera: THREE.PerspectiveCamera;
        objects: THREE.Object3D[];
        level: Level;
        physicsSystem: PhysicsSystem;
        pathfinding: Pathfinding;
        simulation: GpuSimulationFacade;
        trails: EnemyTrailSystem;
        maxGpuEnemies: number;
    }) {
        this.services = opts.services;
        this.events = opts.events;
        this.scene = opts.scene;
        this.camera = opts.camera;
        this.objects = opts.objects;
        this.level = opts.level;
        this.physicsSystem = opts.physicsSystem;
        this.pathfinding = opts.pathfinding;
        this.enemiesSim = opts.simulation.enemies;
        this.particles = opts.simulation.particles;
        this.trails = opts.trails;
        this.maxGpuEnemies = opts.maxGpuEnemies;

        this.gpuEnemyByIndex = new Array(this.maxGpuEnemies).fill(null);
        this.initGpuEnemyImpostors();
    }

    private initGpuEnemyImpostors(): void {
        if (!EnemyConfig.gpuCompute.enabled) return;

        // One drawcall for all far enemies: instance position comes from GPU storage buffer.
        // Visual quality: use a low-poly humanoid silhouette (not a cylinder).
        const geometry = EnemySystem.enemyImpostorGeometry ?? (EnemySystem.enemyImpostorGeometry = this.createEnemyImpostorGeometry());

        const posBuffer = this.enemiesSim.getEnemyPositionBuffer();
        const stateBuffer = this.enemiesSim.getEnemyStateBuffer();
        const colorBuffer = this.enemiesSim.getEnemyColorBuffer();
        const maxEnemies = this.enemiesSim.getMaxEnemies();

        const positionStorage = storage(posBuffer, 'vec3', maxEnemies);
        const stateStorage = storage(stateBuffer, 'vec4', maxEnemies);
        const colorStorage = storage(colorBuffer, 'vec3', maxEnemies);

        const material = new MeshStandardNodeMaterial({
            roughness: 0.75,
            metalness: 0.05,
        });

        const index = instanceIndex;
        const p = positionStorage.element(index);
        const s = stateStorage.element(index);
        const baseColor = colorStorage.element(index);

        // Match the perceived look of EnemyMaterials.createArmorMaterial():
        // slight pulse + emissive lift so dark colors don't go black under low ambient.
        const t = time;
        const pulse = sin(t.mul(3)).mul(0.1).add(0.9);
        const highlight = baseColor.mul(1.5).add(vec3(0.1, 0.1, 0.1)).min(1.0);
        const pulseT = pulse.sub(0.9).mul(2.0).clamp(0.0, 1.0);
        const pulsedColor = mix(baseColor, highlight, pulseT);
        const visibleColor = pulsedColor.max(vec3(0.12, 0.12, 0.12));

        // s.w = active (0/1), s.z = renderMode (0=cpu rig, 1=gpu impostor)
        const visible = s.w.mul(s.z);
        const hiddenY = float(-9999);
        const y = mix(hiddenY, p.y, visible);
        const worldPos = vec3(p.x, y, p.z);

        material.positionNode = positionLocal.add(worldPos);
        material.colorNode = visibleColor;
        material.emissiveNode = mix(vec3(0.05, 0.1, 0.2).mul(pulse), visibleColor, float(0.15));

        const mesh = new THREE.InstancedMesh(geometry, material, maxEnemies);
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        // Raycast support: weapons can map instanceId -> Enemy via this array.
        const ud = getUserData(mesh);
        ud.isEnemyImpostorMesh = true;
        ud._enemyByInstanceId = this.gpuEnemyByIndex;

        this.scene.add(mesh);
        this.enemyImpostorMesh = mesh;
    }

    private createEnemyImpostorGeometry(): THREE.BufferGeometry {
        const merge = (geometries: THREE.BufferGeometry[]): THREE.BufferGeometry => {
            const positions: number[] = [];
            const normals: number[] = [];
            const uvs: number[] = [];
            const indices: number[] = [];

            let vertexOffset = 0;

            for (const geo of geometries) {
                const posAttr = geo.attributes.position;
                const normAttr = geo.attributes.normal;
                const uvAttr = geo.attributes.uv;
                const indexAttr = geo.index;

                if (!uvAttr) {
                    for (let k = 0; k < posAttr.count; k++) uvs.push(0, 0);
                }

                for (let i = 0; i < posAttr.count; i++) {
                    positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                    normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
                    if (uvAttr) uvs.push(uvAttr.getX(i), uvAttr.getY(i));
                }

                if (indexAttr) {
                    for (let i = 0; i < indexAttr.count; i++) indices.push(indexAttr.getX(i) + vertexOffset);
                } else {
                    for (let i = 0; i < posAttr.count; i++) indices.push(i + vertexOffset);
                }

                vertexOffset += posAttr.count;
                geo.dispose();
            }

            const out = new THREE.BufferGeometry();
            out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            out.setIndex(indices);
            out.computeBoundingSphere();
            out.computeBoundingBox();
            return out;
        };

        // Build a simplified enemy silhouette in the same coordinate space as real enemies:
        // feet at y=0, torso/head around y~1-2.
        const geos: THREE.BufferGeometry[] = [];

        // Torso armor
        const torso = new THREE.BoxGeometry(0.62, 0.85, 0.36);
        torso.translate(0, 1.2, 0);
        geos.push(torso);

        // Abdomen
        const abdomen = new THREE.BoxGeometry(0.52, 0.32, 0.30);
        abdomen.translate(0, 0.70, 0);
        geos.push(abdomen);

        // Head + helmet cap (very low poly)
        const head = new THREE.SphereGeometry(0.22, 8, 6);
        head.scale(1, 1.1, 1);
        head.translate(0, 1.75, 0);
        geos.push(head);

        const helmet = new THREE.SphereGeometry(0.25, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.65);
        helmet.translate(0, 1.80, 0);
        geos.push(helmet);

        // Arms (upper+lower as a single box each side)
        const armL = new THREE.BoxGeometry(0.18, 0.72, 0.18);
        armL.translate(-0.55, 1.05, 0.02);
        geos.push(armL);
        const armR = new THREE.BoxGeometry(0.18, 0.72, 0.18);
        armR.translate(0.55, 1.05, 0.02);
        geos.push(armR);

        // Legs
        const legL = new THREE.BoxGeometry(0.20, 0.82, 0.22);
        legL.translate(-0.17, 0.40, 0);
        geos.push(legL);
        const legR = new THREE.BoxGeometry(0.20, 0.82, 0.22);
        legR.translate(0.17, 0.40, 0);
        geos.push(legR);

        // Weapon block (helps silhouette a lot at distance)
        const gun = new THREE.BoxGeometry(0.12, 0.12, 0.55);
        gun.translate(0.40, 0.95, 0.38);
        geos.push(gun);

        return merge(geos);
    }

    get all(): Enemy[] {
        return this.enemies;
    }

    /** Remove all active enemies from the scene and return them to the pool. */
    clearAll(): void {
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            this.scene.remove(enemy.mesh);

            if (EnemyConfig.gpuCompute.enabled && enemy.gpuIndex >= 0) {
                this.enemiesSim.setEnemyActive(enemy.gpuIndex, false);
                this.freeGpuIndices.push(enemy.gpuIndex);
            }

            this.returnEnemyToPool(enemy);
        }
        this.enemies = [];
    }

    private enemyPoolKey(type: EnemyType, weaponId: WeaponId): string {
        return `${type}:${weaponId}`;
    }

    private getEnemyPool(key: string): Enemy[] {
        const existing = this.enemyPool.get(key);
        if (existing) return existing;
        const created: Enemy[] = [];
        this.enemyPool.set(key, created);
        return created;
    }

    takeEnemyFromPool(type: EnemyType, weaponId: WeaponId): Enemy | null {
        const key = this.enemyPoolKey(type, weaponId);
        const pool = this.enemyPool.get(key);
        if (!pool || pool.length === 0) return null;
        return pool.pop() ?? null;
    }

    returnEnemyToPool(enemy: Enemy): void {
        const prevGpuIndex = enemy.gpuIndex;

        enemy.release();
        enemy.gpuIndex = -1;

        if (prevGpuIndex >= 0 && prevGpuIndex < this.gpuEnemyByIndex.length) {
            this.gpuEnemyByIndex[prevGpuIndex] = null;
        }

        const key = enemy.getPoolKey();
        const pool = this.getEnemyPool(key);
        if (pool.length < this.enemyPoolMaxPerKey) {
            pool.push(enemy);
        } else {
            enemy.dispose();
        }
    }

    recycle(enemy: Enemy): void {
        this.returnEnemyToPool(enemy);
    }

    private allocateGpuIndex(): number {
        const idx = this.freeGpuIndices.pop();
        if (idx !== undefined) return idx;
        return this.nextGpuIndex++;
    }

    update(frame: FrameContext): void {
        const playerPos = this.tmpPlayerPos.set(
            frame.playerPos.x,
            frame.playerPos.y,
            frame.playerPos.z
        );

        const targetUpdateDist = EnemyConfig.gpuCompute.targetUpdateDistance;
        const targetUpdateDistSq = targetUpdateDist * targetUpdateDist;
        const meleeRangeSq = 1.0 * 1.0;

        // GPU-driven rendering threshold (impostor): beyond this, render via instanced mesh in one drawcall.
        // Keep close enemies on CPU rigs for quality + accurate per-bone hit tests.
        const impostorDistance = Math.max(EnemyConfig.ai.limbLodDistance, 40);
        const impostorDistanceSq = impostorDistance * impostorDistance;

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            const distSq = enemy.mesh.position.distanceToSquared(playerPos);

            const gpuEnabled = EnemyConfig.gpuCompute.enabled && enemy.gpuIndex >= 0;
            const useImpostor = gpuEnabled && distSq > impostorDistanceSq;

            // True GPU-driven render: the impostor mesh reads positions/state on GPU.
            // We still keep CPU sim authoritative for gameplay; just upload positions + render mode.
            if (gpuEnabled) {
                this.enemiesSim.setEnemyRenderMode(enemy.gpuIndex, useImpostor ? 1 : 0);
                this.enemiesSim.setEnemyPosition(enemy.gpuIndex, enemy.mesh.position);
            }

            // Avoid duplicate rendering: hide the CPU rig when impostor is active.
            // (Raycasts will hit the impostor InstancedMesh instead.)
            enemy.mesh.visible = !useImpostor;

            if (gpuEnabled) {
                if (distSq <= targetUpdateDistSq) {
                    this.enemiesSim.setEnemyTarget(enemy.gpuIndex, playerPos);
                }
            }

            const shootResult = enemy.update(playerPos, frame.delta, this.objects, this.pathfinding, {
                movement: 'cpu',
            });

            if (shootResult.fired) {
                const muzzlePos = enemy.getMuzzleWorldPosition(this.tmpMuzzlePos);
                const trailEnd = this.tmpTrailEnd;
                if (shootResult.hit) {
                    trailEnd.copy(playerPos);
                } else {
                    trailEnd.copy(muzzlePos).addScaledVector(enemy.lastShotDirection, 50);
                }

                this.trails.spawnTrail(muzzlePos, trailEnd);

                if (shootResult.hit) {
                    this.events.emit({ type: 'state:updateHealth', delta: -shootResult.damage });
                    this.events.emit({ type: 'fx:damageFlash', intensity: EffectConfig.damageFlash.intensity });
                    this.events.emit({ type: 'sound:play', sound: 'damage' });

                    this.particles.emit({
                        type: 'spark',
                        position: playerPos.clone().add(new THREE.Vector3(0, 1, 0)),
                        direction: enemy.lastShotDirection.clone().negate(),
                        count: 5,
                        speed: { min: 1, max: 3 },
                        spread: 0.5,
                        color: {
                            start: new THREE.Color(1, 0.1, 0.05),
                            end: new THREE.Color(0.3, 0.02, 0.01),
                        },
                        size: { start: 0.03, end: 0.01 },
                        lifetime: { min: 0.2, max: 0.4 },
                        gravity: -5,
                        drag: 0.95,
                    });
                }
            }

            if (distSq < meleeRangeSq) {
                this.events.emit({ type: 'state:updateHealth', delta: -10 * frame.delta });
                if (Math.random() < 0.1) {
                    this.events.emit({ type: 'fx:damageFlash', intensity: EffectConfig.damageFlash.intensity * 0.7 });
                    this.events.emit({ type: 'sound:play', sound: 'damage' });
                }
            }

            if (enemy.isDead) {
                this.particles.emitBlood(enemy.mesh.position, new THREE.Vector3(0, 1, 0), 20);
                this.scene.remove(enemy.mesh);

                if (EnemyConfig.gpuCompute.enabled && enemy.gpuIndex >= 0) {
                    this.enemiesSim.setEnemyActive(enemy.gpuIndex, false);
                    this.freeGpuIndices.push(enemy.gpuIndex);
                }

                this.returnEnemyToPool(enemy);
                this.enemies.splice(i, 1);
            }
        }
    }

    spawnEnemy(): void {
        const angle = Math.random() * Math.PI * 2;
        const minRadius = Math.max(
            LevelConfig.enemySpawn.spawnRadius.min,
            LevelConfig.safeZoneRadius + 5
        );
        const radius =
            minRadius +
            Math.random() * (LevelConfig.enemySpawn.spawnRadius.max - minRadius);

        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        const types = Object.keys(EnemyTypesConfig) as EnemyType[];
        const type = types[Math.floor(Math.random() * types.length)];

        const enemyWeapon = getRandomEnemyWeaponId();
        const pooled = this.takeEnemyFromPool(type, enemyWeapon);
        const enemy = pooled ?? new Enemy(new THREE.Vector3(x, 0, z), type, enemyWeapon, this.services, this.events);
        if (pooled) {
            enemy.respawn(new THREE.Vector3(x, 0, z));
        }

        enemy.onGetGroundHeight = (hx, hz) => this.level.getTerrainHeight(hx, hz);
        enemy.setPhysicsSystem(this.physicsSystem);

        const gpuIndex = this.allocateGpuIndex();
        if (EnemyConfig.gpuCompute.enabled && gpuIndex >= this.maxGpuEnemies) {
            // Should not happen (spawn cap should stay below GPU capacity).
            // Fail-safe: don't spawn if we'd index out of bounds.
            this.returnEnemyToPool(enemy);
            return;
        }

        enemy.gpuIndex = gpuIndex;

        if (gpuIndex >= 0 && gpuIndex < this.gpuEnemyByIndex.length) {
            this.gpuEnemyByIndex[gpuIndex] = enemy;
        }

        this.scene.add(enemy.mesh);
        this.enemies.push(enemy);

        if (EnemyConfig.gpuCompute.enabled) {
            this.enemiesSim.setEnemyData(
                enemy.gpuIndex,
                enemy.mesh.position,
                this.camera.position,
                enemy.getMoveSpeed(),
                enemy.getMaxHealth()
            );

            // Keep impostor colors identical to the real enemy type.
            const c = new THREE.Color(EnemyTypesConfig[type].color);
            this.enemiesSim.setEnemyColor(enemy.gpuIndex, c);
        }
    }

    dispose(): void {
        for (const e of this.enemies) {
            this.scene.remove(e.mesh);
            e.dispose();
        }
        this.enemies = [];

        for (const pool of this.enemyPool.values()) {
            for (const e of pool) {
                this.scene.remove(e.mesh);
                e.dispose();
            }
        }
        this.enemyPool.clear();
    }
}
