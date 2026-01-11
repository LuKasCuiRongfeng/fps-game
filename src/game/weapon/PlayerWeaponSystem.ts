import * as THREE from 'three';
import { PhysicsSystem } from '../core/PhysicsSystem';
import type { GameServices } from '../core/services/GameServices';
import { Enemy } from '../enemy/Enemy';
import type { ParticleSimulation } from '../core/gpu/GpuSimulationFacade';
import { GrenadeHand } from '../entities/GrenadeTSL';
import { getWeaponDefinition, getDefaultPlayerLoadout } from './WeaponDefinitions';
import { IPlayerWeapon, WeaponContext, WeaponId } from './WeaponTypes';
import { PlayerHitscanWeapon } from './PlayerHitscanWeapon';
import { PlayerMeleeWeapon } from './PlayerMeleeWeapon';
import { PlayerGrenadeWeapon } from './PlayerGrenadeWeapon';
import type { GameEventBus } from '../core/events/GameEventBus';

export class PlayerWeaponSystem {
    private camera: THREE.Camera;
    private scene: THREE.Scene;
    private physicsSystem: PhysicsSystem;
    private services: GameServices;
    private events: GameEventBus;

    private weapons: WeaponId[];
    private weaponInstances: Map<WeaponId, IPlayerWeapon> = new Map();

    private currentIndex: number = 0;

    private enemies: Enemy[] = [];
    private particleSystem: ParticleSimulation | null = null;
    private onGetGroundHeight: ((x: number, z: number) => number) | null = null;

    private onGrenadeThrow: ((position: THREE.Vector3, direction: THREE.Vector3) => void) | null = null;

    // 共享的手榴弹手部动画（weapon 实例里复用）
    private grenadeHand: GrenadeHand;

    constructor(
        camera: THREE.Camera,
        scene: THREE.Scene,
        physicsSystem: PhysicsSystem,
        services: GameServices,
        events: GameEventBus,
        initialWeapons?: WeaponId[]
    ) {
        this.camera = camera;
        this.scene = scene;
        this.physicsSystem = physicsSystem;
        this.services = services;
        this.events = events;
        this.weapons = initialWeapons ?? getDefaultPlayerLoadout();
        this.grenadeHand = new GrenadeHand(camera);

        // Pre-create all weapons in the loadout to avoid hitches on first switch.
        for (const id of this.weapons) {
            this.ensureWeaponInstance(id);
        }

        // 初始化第一把
        this.setCurrentWeapon(this.weapons[this.currentIndex]);
    }

    /**
     * Warmup helper: temporarily show all weapon viewmodels so the renderer can compile pipelines.
     * Caller is expected to restore visibility via `endWarmupVisible()`.
     */
    public beginWarmupVisible() {
        for (const id of this.weapons) {
            this.ensureWeaponInstance(id).show();
        }
        // grenade hand is shared but should be present/ready as well
        this.grenadeHand.show?.();
    }

    /** Restore normal visibility after warmup. */
    public endWarmupVisible() {
        for (const id of this.weapons) {
            this.ensureWeaponInstance(id).hide();
        }
        // Show current weapon again
        this.getCurrentWeaponInstance().show();
    }

    public dispose() {
        for (const w of this.weaponInstances.values()) {
            w.dispose();
        }
        this.weaponInstances.clear();
    }

    private asHooks(w: IPlayerWeapon): IPlayerWeapon & {
        setEnemies?(enemies: Enemy[]): void;
        setParticleSystem?(particleSystem: ParticleSimulation): void;
        setGroundHeightCallback?(callback: (x: number, z: number) => number): void;
        setGrenadeThrowCallback?(callback: (position: THREE.Vector3, direction: THREE.Vector3) => void): void;
        setPhysicsSystem?(system: PhysicsSystem): void;
    } {
        return w as IPlayerWeapon & {
            setEnemies?(enemies: Enemy[]): void;
            setParticleSystem?(particleSystem: ParticleSimulation): void;
            setGroundHeightCallback?(callback: (x: number, z: number) => number): void;
            setGrenadeThrowCallback?(callback: (position: THREE.Vector3, direction: THREE.Vector3) => void): void;
            setPhysicsSystem?(system: PhysicsSystem): void;
        };
    }

    public setEnemies(enemies: Enemy[]) {
        this.enemies = enemies;
        for (const w of this.weaponInstances.values()) {
            // best-effort: only ranged uses it
            this.asHooks(w).setEnemies?.(enemies);
        }
    }

    public setParticleSystem(particleSystem: ParticleSimulation) {
        this.particleSystem = particleSystem;
        for (const w of this.weaponInstances.values()) {
            this.asHooks(w).setParticleSystem?.(particleSystem);
        }
    }

    public setGroundHeightCallback(callback: (x: number, z: number) => number) {
        this.onGetGroundHeight = callback;
        for (const w of this.weaponInstances.values()) {
            this.asHooks(w).setGroundHeightCallback?.(callback);
        }
    }

    public setGrenadeThrowCallback(callback: (position: THREE.Vector3, direction: THREE.Vector3) => void) {
        this.onGrenadeThrow = callback;
        for (const w of this.weaponInstances.values()) {
            this.asHooks(w).setGrenadeThrowCallback?.(callback);
        }
    }

    public update(delta: number) {
        // 更新当前武器
        const current = this.getCurrentWeaponInstance();
        current.update(delta);

        // 共享手榴弹手动画（只有 grenade weapon 会显示，但这里统一更新）
        this.grenadeHand.update(delta);
    }

    public onTriggerDown(isAiming: boolean) {
        const ctx: WeaponContext = { scene: this.scene, isAiming };
        this.getCurrentWeaponInstance().onTriggerDown(ctx);
    }

    public onTriggerUp() {
        this.getCurrentWeaponInstance().onTriggerUp();
    }

    public startAiming() {
        this.getCurrentWeaponInstance().startAiming();
    }

    public stopAiming() {
        this.getCurrentWeaponInstance().stopAiming();
    }

    public getAimProgress(): number {
        return this.getCurrentWeaponInstance().getAimProgress();
    }

    public getCurrentWeaponId(): WeaponId {
        return this.weapons[this.currentIndex];
    }

    public switchToNextWeapon() {
        this.switchToIndex((this.currentIndex + 1) % this.weapons.length);
    }

    public switchToPrevWeapon() {
        this.switchToIndex((this.currentIndex - 1 + this.weapons.length) % this.weapons.length);
    }

    public switchToWeapon(id: WeaponId) {
        const idx = this.weapons.indexOf(id);
        if (idx >= 0) this.switchToIndex(idx);
    }

    private switchToIndex(nextIndex: number) {
        if (nextIndex === this.currentIndex) return;

        const prevWeapon = this.getCurrentWeaponInstance();
        prevWeapon.hide();

        this.currentIndex = nextIndex;
        const nextId = this.weapons[this.currentIndex];
        this.ensureWeaponInstance(nextId);
        this.setCurrentWeapon(nextId);

        // 切换音效
        this.events.emit({ type: 'sound:play', sound: 'weaponSwitch' });
    }

    private setCurrentWeapon(id: WeaponId) {
        const nextWeapon = this.getCurrentWeaponInstance();
        nextWeapon.show();

        this.events.emit({ type: 'state:setCurrentWeapon', weapon: id });
    }

    private getCurrentWeaponInstance(): IPlayerWeapon {
        const id = this.weapons[this.currentIndex];
        return this.ensureWeaponInstance(id);
    }

    private ensureWeaponInstance(id: WeaponId): IPlayerWeapon {
        const existing = this.weaponInstances.get(id);
        if (existing) return existing;

        const def = getWeaponDefinition(id);
        let instance: IPlayerWeapon;

        if (def.category === 'ranged') {
            const ranged = new PlayerHitscanWeapon(this.camera, def, this.services, this.events);
            ranged.setPhysicsSystem(this.physicsSystem);
            ranged.setEnemies(this.enemies);
            if (this.particleSystem) ranged.setParticleSystem(this.particleSystem);
            if (this.onGetGroundHeight) ranged.setGroundHeightCallback(this.onGetGroundHeight);
            instance = ranged;
        } else if (def.category === 'melee') {
            const melee = new PlayerMeleeWeapon(this.camera, def, this.services, this.events);
            melee.setEnemies(this.enemies);
            melee.setPhysicsSystem(this.physicsSystem);
            if (this.particleSystem) melee.setParticleSystem(this.particleSystem);
            instance = melee;
        } else {
            const grenade = new PlayerGrenadeWeapon(this.camera, this.grenadeHand, this.services, this.events);
            if (this.onGrenadeThrow) grenade.setGrenadeThrowCallback(this.onGrenadeThrow);
            instance = grenade;
        }

        this.weaponInstances.set(id, instance);
        return instance;
    }
}
