import { WeaponDefinition, WeaponId } from './WeaponTypes';

const DEFINITIONS: Record<WeaponId, WeaponDefinition> = {
    rifle: {
        id: 'rifle',
        displayName: 'Rifle',
        category: 'ranged',
        damage: 28,
        aimDamage: 40,
        range: 120,
        fireRate: 10,
        usesAmmo: true,
        ammoPerShot: 1,
        canAutoFire: true,
        supportsAiming: true,
        muzzleFlash: true,
        bulletTrail: true,
    },
    sniper: {
        id: 'sniper',
        displayName: 'Sniper',
        category: 'ranged',
        damage: 60,
        aimDamage: 160,
        range: 250,
        fireRate: 1,
        usesAmmo: true,
        ammoPerShot: 1,
        canAutoFire: false,
        supportsAiming: true,
        muzzleFlash: true,
        bulletTrail: true,
    },
    pistol: {
        id: 'pistol',
        displayName: 'Pistol',
        category: 'ranged',
        damage: 20,
        aimDamage: 28,
        range: 80,
        fireRate: 5,
        usesAmmo: true,
        ammoPerShot: 1,
        canAutoFire: false,
        supportsAiming: true,
        muzzleFlash: true,
        bulletTrail: true,
    },
    smg: {
        id: 'smg',
        displayName: 'SMG',
        category: 'ranged',
        damage: 14,
        aimDamage: 18,
        range: 70,
        fireRate: 14,
        usesAmmo: true,
        ammoPerShot: 1,
        canAutoFire: true,
        supportsAiming: true,
        muzzleFlash: true,
        bulletTrail: true,
    },
    shotgun: {
        id: 'shotgun',
        displayName: 'Shotgun',
        category: 'ranged',
        damage: 40,
        aimDamage: 55,
        range: 40,
        fireRate: 1.2,
        usesAmmo: true,
        ammoPerShot: 1,
        canAutoFire: false,
        supportsAiming: true,
        muzzleFlash: true,
        bulletTrail: true,
    },
    bow: {
        id: 'bow',
        displayName: 'Bow',
        category: 'ranged',
        damage: 45,
        aimDamage: 60,
        range: 90,
        fireRate: 1.5,
        usesAmmo: true,
        ammoPerShot: 1,
        canAutoFire: false,
        supportsAiming: true,
        muzzleFlash: false,
        bulletTrail: true,
    },
    knife: {
        id: 'knife',
        displayName: 'Knife',
        category: 'melee',
        damage: 35,
        range: 2.2,
        swingCooldown: 0.35,
        supportsAiming: false,
    },
    axe: {
        id: 'axe',
        displayName: 'Axe',
        category: 'melee',
        damage: 55,
        range: 2.6,
        swingCooldown: 0.65,
        supportsAiming: false,
    },
    scythe: {
        id: 'scythe',
        displayName: 'Scythe',
        category: 'melee',
        damage: 45,
        range: 3.0,
        swingCooldown: 0.55,
        supportsAiming: false,
    },
    grenade: {
        id: 'grenade',
        displayName: 'Grenade',
        category: 'throwable',
        supportsAiming: false,
    },
};

export function getWeaponDefinition(id: WeaponId): WeaponDefinition {
    return DEFINITIONS[id];
}

export function getDefaultPlayerLoadout(): WeaponId[] {
    // 维持现有玩法：玩家默认有一把主武器 + 手榴弹
    return ['rifle', 'pistol', 'knife', 'axe', 'scythe', 'grenade'];
}

export function getRandomEnemyWeaponId(): WeaponId {
    // 敌人只随机远程枪械（先不发近战，避免 AI 距离逻辑大改）
    const pool: WeaponId[] = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol'];
    return pool[Math.floor(Math.random() * pool.length)];
}

export function getWeaponDisplayName(id: WeaponId): string {
    return DEFINITIONS[id].displayName;
}
