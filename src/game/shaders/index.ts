/**
 * TSL Shader 系统导出
 * 统一导出所有 TSL 相关模块
 */

// 材质系统
export { 
    UniformManager,
    TSLMaterials,
    createGroundMaterial,
    createWallMaterial,
    createObstacleMaterial,
    createEnemyMaterial,
    createPickupMaterial,
    createWeaponMaterial,
    createMuzzleFlashMaterial,
    createStairMaterial,
    createSkyMaterial,
    createDamageOverlayMaterial,
    createBulletTrailMaterial,
    createParticleMaterial
} from './TSLMaterials';

// GPU Compute 系统
export {
    GPUComputeSystem,
    type EnemyGPUData,
    type ParticleGPUData
} from './GPUCompute';

// GPU 粒子系统
export {
    GPUParticleSystem,
    type ParticleType,
    type EmitterConfig
} from './GPUParticles';
