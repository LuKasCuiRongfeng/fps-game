import * as THREE from 'three';
import { MeshBasicNodeMaterial, type UniformNode } from 'three/webgpu';
import { 
    uniform, time, sin, vec2, vec3, vec4, float, 
    smoothstep, uv, abs, length
} from 'three/tsl';
import { getUserData } from '../types/GameUserData';

/**
 * 弹道轨迹类 - 使用 TSL 增强的子弹轨迹
 * 使用圆柱体网格实现更好的视觉效果
 */
export class BulletTrail {
    // 共享几何体 (单位高度 1，中心在原点)
    private static mainGeometry = new THREE.CylinderGeometry(0.003, 0.003, 1, 4, 1);
    private static glowGeometry = new THREE.CylinderGeometry(0.015, 0.008, 1, 6, 1);

    public mesh: THREE.Group;
    public isDead: boolean = false;
    private lifetime: number = 0;
    private maxLifetime: number = 0.15;
    private trailOpacity: UniformNode<number>;
    private trailLength: number = 1;

    private mainTrail: THREE.Mesh;
    private glowTrail: THREE.Mesh;

    private static readonly defaultDir = new THREE.Vector3(0, 1, 0);
    private static readonly axisX = new THREE.Vector3(1, 0, 0);

    private readonly tmpDirection = new THREE.Vector3();
    private readonly tmpMidpoint = new THREE.Vector3();
    private readonly tmpQuaternion = new THREE.Quaternion();

    constructor() {
        this.trailOpacity = uniform(1.0);
        
        this.mesh = new THREE.Group();
        getUserData(this.mesh).isBulletTrail = true;
        
        // 创建材质 (每个实例独立，因为 uniforms 是绑定的)
        // 创建主轨迹
        const mainMaterial = this.createMainMaterial();
        this.mainTrail = new THREE.Mesh(BulletTrail.mainGeometry, mainMaterial);
        
        // 但这里我们之后统一旋转整个 Group
        this.mesh.add(this.mainTrail);
        
        // 创建发光轨迹
        const glowMaterial = this.createGlowMaterial();
        this.glowTrail = new THREE.Mesh(BulletTrail.glowGeometry, glowMaterial);
        this.mesh.add(this.glowTrail);
        
        // 初始隐藏
        this.mesh.visible = false;
    }

    /**
     * 重置并初始化轨迹 (对象池复用)
     */
    public init(start: THREE.Vector3, end: THREE.Vector3) {
        this.isDead = false;
        this.lifetime = 0;
        this.trailOpacity.value = 1.0;
        this.mesh.visible = true;

        // 计算轨迹方向和长度 (avoid per-shot allocations)
        const direction = this.tmpDirection.subVectors(end, start);
        const len = direction.length();
        this.trailLength = Math.max(0.1, len);

        // 如果长度太短，隐藏
        if (len < 0.01) {
            this.mesh.visible = false;
            this.isDead = true;
            return;
        }
        
        // 设置位置到中点
        this.tmpMidpoint.addVectors(start, end).multiplyScalar(0.5);
        this.mesh.position.copy(this.tmpMidpoint);
        
        // 计算旋转
        direction.multiplyScalar(1 / len);
        const defaultDir = BulletTrail.defaultDir;
        const quaternion = this.tmpQuaternion;

        const dot = defaultDir.dot(direction);
        if (Math.abs(dot) > 0.9999) {
            if (dot < 0) quaternion.setFromAxisAngle(BulletTrail.axisX, Math.PI);
        } else {
            quaternion.setFromUnitVectors(defaultDir, direction);
        }
        this.mesh.quaternion.copy(quaternion);

        // 应用缩放 (直接缩放 Mesh)
        this.mainTrail.scale.set(1, this.trailLength, 1);
        this.glowTrail.scale.set(1, this.trailLength, 1);
    }

    private createMainMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;
        
        const opacity = this.trailOpacity;
        const t = time;
        const coreColor = vec3(1.0, 0.95, 0.7);
        const flicker = sin(t.mul(200)).mul(0.1).add(0.9);
        
        material.colorNode = coreColor.mul(flicker);
        material.opacityNode = opacity;
        return material;
    }

    private createGlowMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;
        
        const opacity = this.trailOpacity;
        const uvCoord = uv();
        const gradient = smoothstep(float(0), float(0.3), uvCoord.y);
        const glowColor = vec3(1.0, 0.6, 0.15);
        const radialFade = smoothstep(float(0.5), float(0.2), abs(uvCoord.x.sub(0.5)));
        
        material.colorNode = glowColor.mul(gradient);
        material.opacityNode = opacity.mul(0.6).mul(radialFade);
        return material;
    }

    public update(delta: number) {
        if (this.isDead) return;

        this.lifetime += delta;
        const progress = this.lifetime / this.maxLifetime;
        
        const fadeOut = 1 - Math.pow(progress, 0.5);
        this.trailOpacity.value = fadeOut;
        
        // 轨迹收缩
        const shrinkProgress = Math.min(progress * 2, 1);
        
        // 更新缩放
        const scaleY = this.trailLength * (1 - shrinkProgress * 0.8);
        const scaleRadial = Math.max(0.1, 1 - shrinkProgress * 0.9);

        // 注意：scale.y 代表长度，scale.x/z 代表粗细
        this.mainTrail.scale.set(scaleRadial, scaleY, scaleRadial);
        this.glowTrail.scale.set(scaleRadial, scaleY, scaleRadial);
        
        if (this.lifetime >= this.maxLifetime) {
            this.isDead = true;
        }
    }

    public dispose() {
        // 静态几何体不需要销毁
        // 只销毁材质
        (this.mainTrail.material as THREE.Material).dispose();
        (this.glowTrail.material as THREE.Material).dispose();
    }
}
