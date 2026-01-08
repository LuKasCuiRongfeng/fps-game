import * as THREE from 'three';

export type WeaponCategory = 'ranged' | 'melee' | 'throwable';

export type WeaponId =
    | 'rifle'
    | 'sniper'
    | 'pistol'
    | 'smg'
    | 'shotgun'
    | 'bow'
    | 'knife'
    | 'axe'
    | 'scythe'
    | 'grenade';

export interface WeaponDefinitionBase {
    id: WeaponId;
    displayName: string;
    category: WeaponCategory;
}

export interface RangedWeaponDefinition extends WeaponDefinitionBase {
    category: 'ranged';
    damage: number;
    aimDamage?: number;
    range: number;
    fireRate: number; // shots per second
    usesAmmo: boolean;
    ammoPerShot: number;
    canAutoFire: boolean;
    supportsAiming: boolean;
    muzzleFlash: boolean;
    bulletTrail: boolean;
}

export interface MeleeWeaponDefinition extends WeaponDefinitionBase {
    category: 'melee';
    damage: number;
    range: number;
    swingCooldown: number; // seconds
    supportsAiming: false;
}

export interface ThrowableWeaponDefinition extends WeaponDefinitionBase {
    category: 'throwable';
    supportsAiming: false;
}

export type WeaponDefinition = RangedWeaponDefinition | MeleeWeaponDefinition | ThrowableWeaponDefinition;

export interface WeaponContext {
    scene: THREE.Scene;
    isAiming: boolean;
}

export interface IPlayerWeapon {
    readonly id: WeaponId;
    readonly category: WeaponCategory;

    show(): void;
    hide(): void;

    update(delta: number): void;

    onTriggerDown(ctx: WeaponContext): void;
    onTriggerUp(): void;

    startAiming(): void;
    stopAiming(): void;
    getAimProgress(): number; // 0..1 (for scope postfx)

    dispose(): void;
}
