/**
 * Weapon - 使用 TSL 增强的武器系统
 * 包含枪口火焰、弹道轨迹、命中特效等
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { 
    uniform, time, sin, vec3, mix, float, 
    smoothstep, uv, sub, abs, length
} from 'three/tsl';
import { Enemy } from './EnemyTSL';
import { GameStateService } from './GameState';
import { SoundManager } from './SoundManager';

export class Weapon {
    private camera: THREE.Camera;
    private mesh: THREE.Mesh;
    private raycaster: THREE.Raycaster;
    
    // 枪口火焰
    private flashMesh: THREE.Mesh;
    private flashIntensity: any;  // TSL uniform
    
    // 武器动画状态
    private recoilOffset: THREE.Vector3 = new THREE.Vector3();
    private swayOffset: THREE.Vector3 = new THREE.Vector3();
    private isRecoiling: boolean = false;
    
    // 弹道轨迹管理
    private bulletTrails: BulletTrail[] = [];
    private scene: THREE.Scene | null = null;
    
    // 命中特效
    private hitEffects: HitEffect[] = [];

    constructor(camera: THREE.Camera) {
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();
        
        // TSL Uniforms
        this.flashIntensity = uniform(0);

        // 创建武器
        this.mesh = this.createWeaponMesh();
        this.camera.add(this.mesh);
        
        // 创建枪口火焰
        this.flashMesh = this.createMuzzleFlash();
        this.mesh.add(this.flashMesh);
    }

    /**
     * 创建武器网格 - 简单的枪模型
     */
    private createWeaponMesh(): THREE.Mesh {
        // 组合几何体创建枪形
        const bodyGeo = new THREE.BoxGeometry(0.08, 0.12, 0.5);
        const material = this.createWeaponMaterial();
        
        const mesh = new THREE.Mesh(bodyGeo, material);
        mesh.position.set(0.3, -0.25, -0.6);
        mesh.castShadow = true;
        
        // 添加枪管
        const barrelGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.3, 8);
        const barrelMesh = new THREE.Mesh(barrelGeo, material);
        barrelMesh.rotation.x = Math.PI / 2;
        barrelMesh.position.set(0, 0.02, -0.3);
        mesh.add(barrelMesh);
        
        // 添加瞄准器
        const sightGeo = new THREE.BoxGeometry(0.02, 0.04, 0.02);
        const sightMesh = new THREE.Mesh(sightGeo, material);
        sightMesh.position.set(0, 0.08, -0.1);
        mesh.add(sightMesh);
        
        return mesh;
    }

    /**
     * 武器材质 - 金属质感
     */
    private createWeaponMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.25,
            metalness: 0.95
        });

        const uvCoord = uv();
        const t = time;
        
        // ========== 金属刷纹 ==========
        const brushFreq = float(200);
        const brushPattern = sin(uvCoord.x.mul(brushFreq)).mul(0.015);
        
        // ========== 基础颜色 ==========
        const baseColor = vec3(0.15, 0.14, 0.13);
        const highlightColor = vec3(0.25, 0.24, 0.22);
        
        // 高光区域
        const highlight = smoothstep(float(0.3), float(0.7), uvCoord.y);
        const metalColor = mix(baseColor, highlightColor, highlight);
        
        // 添加刷纹
        const finalColor = metalColor.add(brushPattern);
        
        material.colorNode = finalColor;
        
        // ========== 动态反射 ==========
        // 环境光反射
        material.envMapIntensity = 0.8;
        
        // 刷纹处略粗糙
        material.roughnessNode = mix(float(0.2), float(0.35), abs(brushPattern).mul(10));
        
        return material;
    }

    /**
     * 创建枪口火焰
     */
    private createMuzzleFlash(): THREE.Mesh {
        const geometry = new THREE.PlaneGeometry(0.15, 0.15);
        const material = this.createMuzzleFlashMaterial();
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(0, 0.02, -0.45);
        mesh.visible = false;
        
        // 双面渲染
        const mesh2 = mesh.clone();
        mesh2.rotation.y = Math.PI / 2;
        mesh.add(mesh2);
        
        return mesh;
    }

    /**
     * 枪口火焰材质 - 动态火焰效果
     */
    private createMuzzleFlashMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;

        const t = time;
        const intensity = this.flashIntensity;
        
        // 火焰颜色渐变
        const innerColor = vec3(1, 1, 0.9); // 白黄色中心
        const outerColor = vec3(1, 0.5, 0.1); // 橙色边缘
        
        // 基于UV的径向渐变
        const uvCoord = uv();
        const center = vec3(0.5, 0.5, 0);
        const dist = length(uvCoord.sub(center.xy));
        
        // 火焰形状
        const flameShape = smoothstep(float(0.5), float(0), dist);
        
        // 闪烁效果
        const flicker = sin(t.mul(100)).mul(0.2).add(0.8);
        
        // 颜色混合
        const fireColor = mix(outerColor, innerColor, smoothstep(float(0.3), float(0), dist));
        
        material.colorNode = fireColor.mul(flameShape).mul(intensity).mul(flicker);
        material.opacityNode = flameShape.mul(intensity);
        
        return material;
    }

    /**
     * 射击
     */
    public shoot(scene: THREE.Scene) {
        this.scene = scene;
        
        const gameState = GameStateService.getInstance();
        if (gameState.getState().ammo <= 0) return;

        gameState.updateAmmo(-1);
        SoundManager.getInstance().playShoot();

        // 枪口火焰
        this.showMuzzleFlash();
        
        // 后座力
        this.applyRecoil();

        // 射线检测
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const intersects = this.raycaster.intersectObjects(scene.children, true);

        // 获取射线起点和方向用于弹道
        const rayOrigin = this.raycaster.ray.origin.clone();
        const rayDirection = this.raycaster.ray.direction.clone();

        let hitPoint: THREE.Vector3 | null = null;
        let hitNormal: THREE.Vector3 | null = null;

        for (const intersect of intersects) {
            const obj = intersect.object as THREE.Mesh;

            if (obj.userData.isGround) continue;
            if (obj === this.mesh || obj.parent === this.mesh) continue;

            hitPoint = intersect.point.clone();
            hitNormal = intersect.face?.normal?.clone() || new THREE.Vector3(0, 1, 0);

            // 命中敌人
            if (obj.userData.isEnemy && obj.userData.entity) {
                const enemy = obj.userData.entity as Enemy;
                enemy.takeDamage(34);
                SoundManager.getInstance().playHit();
                
                if (enemy.isDead) {
                    GameStateService.getInstance().updateScore(100);
                }
                
                // 血液特效
                this.createHitEffect(hitPoint, hitNormal, 'blood');
            } else {
                // 火花特效
                this.createHitEffect(hitPoint, hitNormal, 'spark');
            }
            
            break;
        }

        // 创建弹道轨迹
        const endPoint = hitPoint || rayOrigin.clone().add(rayDirection.multiplyScalar(100));
        this.createBulletTrail(rayOrigin, endPoint);
    }

    /**
     * 显示枪口火焰
     */
    private showMuzzleFlash() {
        this.flashMesh.visible = true;
        this.flashIntensity.value = 1;
        
        // 随机旋转
        this.flashMesh.rotation.z = Math.random() * Math.PI * 2;
        
        // 淡出
        const fadeOut = () => {
            this.flashIntensity.value *= 0.7;
            if (this.flashIntensity.value > 0.01) {
                requestAnimationFrame(fadeOut);
            } else {
                this.flashIntensity.value = 0;
                this.flashMesh.visible = false;
            }
        };
        
        setTimeout(fadeOut, 16);
    }

    /**
     * 应用后座力
     */
    private applyRecoil() {
        if (this.isRecoiling) return;
        this.isRecoiling = true;
        
        const recoilAmount = 0.05;
        const originalPos = this.mesh.position.clone();
        
        // 后座力动画
        const animate = () => {
            this.recoilOffset.z = THREE.MathUtils.lerp(this.recoilOffset.z, 0, 0.2);
            this.recoilOffset.y = THREE.MathUtils.lerp(this.recoilOffset.y, 0, 0.15);
            
            this.mesh.position.copy(originalPos).add(this.recoilOffset);
            
            if (Math.abs(this.recoilOffset.z) > 0.001 || Math.abs(this.recoilOffset.y) > 0.001) {
                requestAnimationFrame(animate);
            } else {
                this.recoilOffset.set(0, 0, 0);
                this.mesh.position.copy(originalPos);
                this.isRecoiling = false;
            }
        };
        
        // 初始后座力
        this.recoilOffset.z = recoilAmount;
        this.recoilOffset.y = recoilAmount * 0.3;
        animate();
    }

    /**
     * 创建弹道轨迹
     */
    private createBulletTrail(start: THREE.Vector3, end: THREE.Vector3) {
        if (!this.scene) return;
        
        const trail = new BulletTrail(start, end);
        this.scene.add(trail.mesh);
        this.bulletTrails.push(trail);
    }

    /**
     * 创建命中特效
     */
    private createHitEffect(position: THREE.Vector3, normal: THREE.Vector3, type: 'spark' | 'blood') {
        if (!this.scene) return;
        
        const effect = new HitEffect(position, normal, type);
        this.scene.add(effect.group);
        this.hitEffects.push(effect);
    }

    /**
     * 更新武器动画
     */
    public update(delta: number) {
        const t = performance.now() * 0.001;
        
        // 武器摇摆
        this.swayOffset.x = Math.sin(t * 1.5) * 0.003;
        this.swayOffset.y = Math.sin(t * 2) * 0.002;
        
        if (!this.isRecoiling) {
            this.mesh.position.x = 0.3 + this.swayOffset.x;
            this.mesh.position.y = -0.25 + this.swayOffset.y;
        }
        
        // 更新弹道轨迹
        for (let i = this.bulletTrails.length - 1; i >= 0; i--) {
            const trail = this.bulletTrails[i];
            trail.update(delta);
            
            if (trail.isDead) {
                if (this.scene) {
                    this.scene.remove(trail.mesh);
                }
                trail.dispose();
                this.bulletTrails.splice(i, 1);
            }
        }
        
        // 更新命中特效
        for (let i = this.hitEffects.length - 1; i >= 0; i--) {
            const effect = this.hitEffects[i];
            effect.update(delta);
            
            if (effect.isDead) {
                if (this.scene) {
                    this.scene.remove(effect.group);
                }
                effect.dispose();
                this.hitEffects.splice(i, 1);
            }
        }
    }

    public dispose() {
        this.camera.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        
        this.flashMesh.geometry.dispose();
        (this.flashMesh.material as THREE.Material).dispose();
        
        // 清理弹道和特效
        this.bulletTrails.forEach(t => t.dispose());
        this.hitEffects.forEach(e => e.dispose());
    }
}

/**
 * 弹道轨迹类
 */
class BulletTrail {
    public mesh: THREE.Line;
    public isDead: boolean = false;
    private lifetime: number = 0;
    private maxLifetime: number = 0.1;
    private opacity: ReturnType<typeof uniform>;

    constructor(start: THREE.Vector3, end: THREE.Vector3) {
        this.opacity = uniform(1);
        
        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        const material = this.createTrailMaterial();
        
        this.mesh = new THREE.Line(geometry, material);
    }

    private createTrailMaterial(): THREE.LineBasicMaterial {
        // 使用基础材质，因为 Line 不支持 Node 材质
        const material = new THREE.LineBasicMaterial({
            color: 0xffaa33,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });
        
        return material;
    }

    public update(delta: number) {
        this.lifetime += delta;
        
        const progress = this.lifetime / this.maxLifetime;
        (this.mesh.material as THREE.LineBasicMaterial).opacity = 1 - progress;
        
        if (this.lifetime >= this.maxLifetime) {
            this.isDead = true;
        }
    }

    public dispose() {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}

/**
 * 命中特效类
 */
class HitEffect {
    public group: THREE.Group;
    public isDead: boolean = false;
    private lifetime: number = 0;
    private maxLifetime: number = 0.3;
    private particles: THREE.Mesh[] = [];

    constructor(position: THREE.Vector3, normal: THREE.Vector3, type: 'spark' | 'blood') {
        this.group = new THREE.Group();
        this.group.position.copy(position);
        
        // 创建粒子
        const particleCount = type === 'spark' ? 8 : 5;
        const color = type === 'spark' ? 0xffaa33 : 0xcc0000;
        
        for (let i = 0; i < particleCount; i++) {
            const geo = new THREE.SphereGeometry(0.02, 4, 4);
            const mat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 1
            });
            
            const particle = new THREE.Mesh(geo, mat);
            
            // 随机方向 (偏向法线方向)
            const randomDir = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize();
            
            const velocity = normal.clone()
                .multiplyScalar(2 + Math.random() * 2)
                .add(randomDir.multiplyScalar(1 + Math.random()));
            
            particle.userData.velocity = velocity;
            
            this.particles.push(particle);
            this.group.add(particle);
        }
    }

    public update(delta: number) {
        this.lifetime += delta;
        
        const progress = this.lifetime / this.maxLifetime;
        
        // 更新粒子
        this.particles.forEach(particle => {
            const vel = particle.userData.velocity as THREE.Vector3;
            
            // 应用重力
            vel.y -= 20 * delta;
            
            // 移动
            particle.position.add(vel.clone().multiplyScalar(delta));
            
            // 淡出
            (particle.material as THREE.MeshBasicMaterial).opacity = 1 - progress;
            
            // 缩小
            const scale = 1 - progress * 0.5;
            particle.scale.setScalar(scale);
        });
        
        if (this.lifetime >= this.maxLifetime) {
            this.isDead = true;
        }
    }

    public dispose() {
        this.particles.forEach(particle => {
            particle.geometry.dispose();
            (particle.material as THREE.Material).dispose();
        });
    }
}
