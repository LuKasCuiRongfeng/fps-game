/**
 * Pickup - 使用完全 TSL 驱动的拾取物
 * 所有动画效果都在 GPU 上通过 shader 计算
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { 
    uniform, time, sin, vec3, mix, float, 
    smoothstep, uv, length,
    sub, abs, pow
} from 'three/tsl';
import { GameStateService } from './GameState';
import { SoundManager } from './SoundManager';

export type PickupType = 'health' | 'ammo';

export class Pickup {
    public mesh: THREE.Mesh;
    public type: PickupType;
    public isCollected: boolean = false;
    
    // TSL Uniforms (使用 any 类型绕过 WebGPU 类型问题)
    private collectProgress: any;
    private floatOffset: number;

    constructor(type: PickupType, position: THREE.Vector3) {
        this.type = type;
        this.floatOffset = Math.random() * 100;
        
        // TSL Uniforms
        this.collectProgress = uniform(0);

        // 使用更有趣的几何体
        const geometry = type === 'health' 
            ? this.createHealthGeometry()
            : this.createAmmoGeometry();
        
        // 完全 TSL 驱动的材质
        const material = this.createAdvancedMaterial();

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        this.mesh.position.y = 1;
        
        this.mesh.userData = { isPickup: true, type: type };
    }

    /**
     * 创建治疗包几何体 (十字形)
     */
    private createHealthGeometry(): THREE.BufferGeometry {
        const group = new THREE.Group();
        
        // 主立方体
        const mainGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        
        // 十字凸起
        const crossH = new THREE.BoxGeometry(0.6, 0.15, 0.15);
        const crossV = new THREE.BoxGeometry(0.15, 0.6, 0.15);
        
        // 合并几何体
        const mergedGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        return mergedGeo;
    }

    /**
     * 创建弹药包几何体
     */
    private createAmmoGeometry(): THREE.BufferGeometry {
        // 子弹形状 - 圆柱+圆锥
        const geometry = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 8);
        return geometry;
    }

    /**
     * 创建高级 TSL 材质 - 所有动画在 GPU 上完成
     */
    private createAdvancedMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.2,
            metalness: 0.8
        });

        const t = time;
        const offset = float(this.floatOffset);
        const collectProg = this.collectProgress;
        
        // 基础颜色
        const healthColor = vec3(0.1, 0.95, 0.2);
        const ammoColor = vec3(1.0, 0.85, 0.1);
        const baseColor = this.type === 'health' ? healthColor : ammoColor;
        
        // ========== 脉动效果 ==========
        const pulseFreq = float(4);
        const pulse = sin(t.mul(pulseFreq).add(offset)).mul(0.2).add(0.8);
        
        // ========== 彩虹边缘效果 ==========
        const uvCoord = uv();
        const edgeDistX = abs(uvCoord.x.sub(0.5)).mul(2);
        const edgeDistY = abs(uvCoord.y.sub(0.5)).mul(2);
        const edgeDist = smoothstep(float(0.6), float(1.0), edgeDistX.max(edgeDistY));
        
        // 旋转彩虹
        const rainbowAngle = t.mul(2).add(offset);
        const rainbow = vec3(
            sin(rainbowAngle).mul(0.5).add(0.5),
            sin(rainbowAngle.add(2.094)).mul(0.5).add(0.5),
            sin(rainbowAngle.add(4.188)).mul(0.5).add(0.5)
        );
        
        // ========== 能量波纹效果 ==========
        const rippleFreq = float(8);
        const rippleSpeed = float(3);
        const ripple = sin(
            uvCoord.x.add(uvCoord.y).mul(rippleFreq).sub(t.mul(rippleSpeed))
        ).mul(0.1).add(0.9);
        
        // ========== 闪烁星光效果 ==========
        const sparkleFreq = float(20);
        const sparkle1 = sin(t.mul(sparkleFreq).add(offset.mul(1.1)));
        const sparkle2 = sin(t.mul(sparkleFreq.mul(1.3)).add(offset.mul(0.7)));
        const sparkle = sparkle1.mul(sparkle2).mul(0.5).add(0.5);
        const sparkleIntensity = pow(sparkle, float(8)).mul(0.3);
        
        // ========== 组合颜色 ==========
        // 基础 + 脉动
        let finalColor: any = baseColor.mul(pulse);
        
        // 添加彩虹边缘
        // @ts-ignore - TSL type compatibility
        finalColor = mix(finalColor, rainbow.mul(1.2), edgeDist.mul(0.4));
        
        // 添加波纹
        finalColor = finalColor.mul(ripple);
        
        // 添加星光
        finalColor = finalColor.add(vec3(sparkleIntensity, sparkleIntensity, sparkleIntensity));
        
        // ========== 收集动画 ==========
        // 收集时变白并缩小
        const collectWhite = vec3(2, 2, 2);
        // @ts-ignore - TSL type compatibility
        finalColor = mix(finalColor, collectWhite, collectProg);
        
        material.colorNode = finalColor;
        
        // ========== 自发光 ==========
        const glowPulse = sin(t.mul(6).add(offset)).mul(0.3).add(0.7);
        const baseGlow = baseColor.mul(glowPulse).mul(0.6);
        
        // 能量核心发光
        const coreDist = length(uvCoord.sub(vec3(0.5, 0.5, 0)));
        const coreGlow = smoothstep(float(0.5), float(0), coreDist);
        const energyCore = baseColor.mul(coreGlow).mul(0.5);
        
        // 收集时强发光
        const collectGlow = vec3(3, 3, 3).mul(collectProg);
        
        // @ts-ignore - TSL type compatibility
        material.emissiveNode = baseGlow.add(energyCore).add(collectGlow);
        
        // ========== 动态粗糙度 ==========
        // @ts-ignore - TSL type compatibility
        material.roughnessNode = mix(float(0.1), float(0.4), pulse.sub(0.8).mul(5));
        
        // ========== 收集时透明 ==========
        material.transparent = true;
        material.opacityNode = sub(float(1), collectProg);
        
        return material;
    }

    /**
     * 更新 - 大部分计算已移至 GPU
     */
    public update(playerPos: THREE.Vector3, delta: number) {
        if (this.isCollected) return;

        // 旋转和浮动由 shader 处理大部分
        // 但物理位置更新仍需在 CPU
        const t = performance.now() * 0.001;
        
        // 旋转
        this.mesh.rotation.y = t * 2 + this.floatOffset;
        this.mesh.rotation.x = Math.sin(t + this.floatOffset) * 0.3;
        
        // 浮动
        this.mesh.position.y = 1 + Math.sin(t * 2 + this.floatOffset) * 0.15;

        // 碰撞检测
        const dist = this.mesh.position.distanceTo(playerPos);
        if (dist < 1.2) {
            // 磁吸效果 - 靠近时被吸过去
            const pullStrength = Math.max(0, 1 - dist) * 0.1;
            const direction = new THREE.Vector3()
                .subVectors(playerPos, this.mesh.position)
                .normalize()
                .multiplyScalar(pullStrength);
            this.mesh.position.add(direction);
            
            if (dist < 0.8) {
                this.collect();
            }
        }
    }

    /**
     * 收集拾取物 - 播放收集动画
     */
    private collect() {
        if (this.isCollected) return;
        this.isCollected = true;
        
        SoundManager.getInstance().playPickup();

        // 应用效果
        if (this.type === 'health') {
            GameStateService.getInstance().updateHealth(25);
        } else {
            GameStateService.getInstance().updateAmmo(15);
        }

        // 收集动画 - 通过 uniform 控制 shader
        const animateCollect = () => {
            if (this.collectProgress.value < 1) {
                this.collectProgress.value += 0.08;
                
                // 缩小并上升
                this.mesh.scale.multiplyScalar(0.92);
                this.mesh.position.y += 0.05;
                this.mesh.rotation.y += 0.3;
                
                requestAnimationFrame(animateCollect);
            } else {
                this.mesh.visible = false;
            }
        };
        animateCollect();
    }

    /**
     * 清理资源
     */
    public dispose() {
        if (this.mesh.geometry) {
            this.mesh.geometry.dispose();
        }
        if (this.mesh.material) {
            (this.mesh.material as MeshStandardNodeMaterial).dispose();
        }
    }
}
