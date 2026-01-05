/**
 * Enemy - 使用 TSL 材质优化的敌人类
 * 结合 GPU Compute 进行高性能更新
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform, time, sin, vec3, mix, float, smoothstep } from 'three/tsl';
import { SoundManager } from './SoundManager';
import { Pathfinding } from './Pathfinding';

export class Enemy {
    public mesh: THREE.Mesh;
    private speed: number = 3.0;
    private health: number = 100;
    public isDead: boolean = false;
    
    // TSL Uniforms (使用 any 类型绕过 WebGPU 类型问题)
    private hitStrength: any;
    private dissolveAmount: any;
    
    // Pathfinding
    private currentPath: THREE.Vector3[] = [];
    private pathUpdateTimer: number = 0;
    private pathUpdateInterval: number = 0.5;
    
    // GPU Index (用于 GPU Compute 系统)
    public gpuIndex: number = -1;

    // 动画状态
    private walkCycle: number = 0;
    private originalY: number = 1;

    constructor(position: THREE.Vector3) {
        // 创建敌人几何体 (胶囊)
        const geometry = new THREE.CapsuleGeometry(0.5, 1, 8, 16);
        
        // TSL Uniforms
        this.hitStrength = uniform(0);
        this.dissolveAmount = uniform(0);
        
        // 使用 TSL 材质系统
        const material = this.createAdvancedEnemyMaterial();

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        this.mesh.position.y = 1;
        this.originalY = 1;
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        
        this.mesh.userData = { isEnemy: true, entity: this };
    }

    /**
     * 创建高级 TSL 敌人材质
     */
    private createAdvancedEnemyMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.5,
            metalness: 0.3
        });

        const t = time;
        
        // 基础红色
        const baseRed = vec3(0.85, 0.08, 0.03);
        const darkRed = vec3(0.5, 0.02, 0.01);
        
        // 脉动效果 - 心跳般的律动
        const heartbeat1 = sin(t.mul(8)).mul(0.5).add(0.5);
        const heartbeat2 = sin(t.mul(8).add(0.2)).mul(0.5).add(0.5);
        const heartbeat = heartbeat1.mul(heartbeat2);
        const pulse = heartbeat.mul(0.15).add(0.85);
        
        // 垂直渐变 - 头部更亮
        const verticalGradient = smoothstep(float(-1), float(1), float(0.5)); // 简化，可用 positionLocal.y
        const gradientColor = mix(darkRed, baseRed, verticalGradient);
        
        // 应用脉动
        const pulsingColor = gradientColor.mul(pulse);
        
        // 受击白色闪烁
        const hitColor = vec3(1, 1, 1);
        const colorAfterHit = mix(pulsingColor, hitColor, this.hitStrength);
        
        // 溶解效果 (死亡时)
        // 这里简化处理，实际可用噪声函数
        const dissolveThreshold = this.dissolveAmount;
        const finalColor = colorAfterHit;
        
        material.colorNode = finalColor;
        
        // 自发光 - 眼睛区域更亮
        const baseEmissive = vec3(0.15, 0.01, 0);
        const hitEmissive = vec3(1, 0.9, 0.7);
        const emissive = mix(baseEmissive.mul(pulse), hitEmissive, this.hitStrength);
        material.emissiveNode = emissive;
        
        // 受击时更金属
        material.metalnessNode = mix(float(0.3), float(0.8), this.hitStrength);
        
        return material;
    }

    public update(
        playerPosition: THREE.Vector3, 
        delta: number, 
        obstacles: THREE.Object3D[], 
        pathfinding: Pathfinding
    ) {
        if (this.isDead) {
            // 死亡溶解动画
            this.dissolveAmount.value = Math.min(1, this.dissolveAmount.value + delta * 2);
            return;
        }

        // 行走动画
        this.walkCycle += delta * this.speed * 2;
        const bobAmount = Math.sin(this.walkCycle) * 0.05;
        const swayAmount = Math.sin(this.walkCycle * 0.5) * 0.02;
        
        // 更新路径
        this.pathUpdateTimer += delta;
        if (this.pathUpdateTimer >= this.pathUpdateInterval) {
            this.pathUpdateTimer = 0;
            this.currentPath = pathfinding.findPath(this.mesh.position, playerPosition);
        }

        let targetPos = playerPosition;
        
        // 跟随路径
        if (this.currentPath.length > 0) {
            const nextPoint = this.currentPath[0];
            const dist = new THREE.Vector2(this.mesh.position.x, this.mesh.position.z)
                .distanceTo(new THREE.Vector2(nextPoint.x, nextPoint.z));
                
            if (dist < 0.5) {
                this.currentPath.shift();
                if (this.currentPath.length > 0) {
                    targetPos = this.currentPath[0];
                }
            } else {
                targetPos = nextPoint;
            }
        }

        // 移动计算
        const direction = new THREE.Vector3()
            .subVectors(targetPos, this.mesh.position);
        direction.y = 0;
        direction.normalize();

        const moveDistance = this.speed * delta;

        // X 轴移动
        const nextPosX = this.mesh.position.clone();
        nextPosX.x += direction.x * moveDistance;
        
        let collisionBox = this.checkCollisions(nextPosX, obstacles, false);
        if (!collisionBox) {
            this.mesh.position.x = nextPosX.x;
        } else {
            this.handleObstacle(collisionBox, direction.x * moveDistance, 0);
        }

        // Z 轴移动
        const nextPosZ = this.mesh.position.clone();
        nextPosZ.z += direction.z * moveDistance;
        
        collisionBox = this.checkCollisions(nextPosZ, obstacles, false);
        if (!collisionBox) {
            this.mesh.position.z = nextPosZ.z;
        } else {
            this.handleObstacle(collisionBox, 0, direction.z * moveDistance);
        }

        // 检查脚下的地面/楼梯高度
        const targetGroundY = this.findGroundHeight(this.mesh.position, obstacles);
        
        // 平滑调整高度（用于上下楼梯）
        const heightDiff = targetGroundY + 1 - this.mesh.position.y;
        if (Math.abs(heightDiff) > 0.01) {
            // 上楼梯时快速调整，下楼梯时受重力影响
            if (heightDiff > 0) {
                // 上楼梯 - 快速抬升
                this.mesh.position.y += Math.min(heightDiff, 8 * delta);
            } else {
                // 下楼梯/重力 - 正常下降
                this.mesh.position.y += Math.max(heightDiff, -9.8 * delta);
            }
        }
        
        // 确保不低于地面
        this.mesh.position.y = Math.max(1, this.mesh.position.y);

        // 应用行走动画
        this.mesh.position.y += bobAmount;
        this.mesh.rotation.z = swayAmount;

        // 面向玩家
        this.mesh.lookAt(playerPosition.x, this.mesh.position.y, playerPosition.z);
    }

    /**
     * 找到指定位置下方的地面高度
     */
    private findGroundHeight(position: THREE.Vector3, obstacles: THREE.Object3D[]): number {
        let groundY = 0; // 默认地面高度
        const checkRadius = 0.5;
        
        for (const object of obstacles) {
            if (object.userData.isGround) continue;
            if (object.userData.isWayPoint) continue;
            
            const objectBox = new THREE.Box3().setFromObject(object);
            
            // 检查是否在该物体的XZ范围内
            if (position.x >= objectBox.min.x - checkRadius &&
                position.x <= objectBox.max.x + checkRadius &&
                position.z >= objectBox.min.z - checkRadius &&
                position.z <= objectBox.max.z + checkRadius) {
                
                // 如果物体顶部在敌人脚下附近（可以站上去）
                const feetY = position.y - 1;
                if (objectBox.max.y > groundY && objectBox.max.y <= feetY + 0.6) {
                    groundY = objectBox.max.y;
                }
            }
        }
        
        return groundY;
    }

    private handleObstacle(obstacleBox: THREE.Box3, dx: number, dz: number) {
        const enemyFeetY = this.mesh.position.y - 1;
        const obstacleTopY = obstacleBox.max.y;
        const stepHeight = obstacleTopY - enemyFeetY;

        if (stepHeight > 0 && stepHeight <= 2.0) {
            this.mesh.position.y = obstacleTopY + 1 + 0.01;
            
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0.0001) {
                const scale = 0.3 / len;
                this.mesh.position.x += dx + (dx * scale);
                this.mesh.position.z += dz + (dz * scale);
            } else {
                this.mesh.position.x += dx;
                this.mesh.position.z += dz;
            }
        }
    }

    private checkCollisions(
        position: THREE.Vector3, 
        obstacles: THREE.Object3D[], 
        isGroundCheck: boolean = false
    ): THREE.Box3 | null {
        const enemyRadius = 0.5;
        const enemyBox = new THREE.Box3();
        const skinWidth = isGroundCheck ? 0.0 : 0.1;
        const maxStepHeight = 0.6; // 最大可跨越高度

        enemyBox.min.set(
            position.x - enemyRadius, 
            position.y - 1 + skinWidth, 
            position.z - enemyRadius
        );
        enemyBox.max.set(
            position.x + enemyRadius, 
            position.y + 1, 
            position.z + enemyRadius
        );

        for (const object of obstacles) {
            if (object.userData.isGround) continue;
            if (object.userData.isWayPoint) continue;

            const objectBox = new THREE.Box3().setFromObject(object);
            if (enemyBox.intersectsBox(objectBox)) {
                // 如果是楼梯，检查是否可以跨越
                if (object.userData.isStair) {
                    const enemyFeetY = position.y - 1;
                    const stepHeight = objectBox.max.y - enemyFeetY;
                    
                    // 如果台阶高度可跨越，不视为碰撞，让敌人可以走上去
                    if (stepHeight > 0 && stepHeight <= maxStepHeight) {
                        continue; // 跳过这个碰撞，允许敌人走上去
                    }
                }
                return objectBox;
            }
        }
        return null;
    }

    public takeDamage(amount: number) {
        if (this.isDead) return;

        this.health -= amount;
        
        // 受击闪烁 - 使用 TSL uniform
        this.hitStrength.value = 1;
        
        // 击退效果
        const knockback = new THREE.Vector3(
            (Math.random() - 0.5) * 0.3,
            0.1,
            (Math.random() - 0.5) * 0.3
        );
        this.mesh.position.add(knockback);

        // 延迟恢复
        setTimeout(() => {
            if (!this.isDead) {
                // 渐变恢复
                const fadeOut = () => {
                    if (this.hitStrength.value > 0.01) {
                        this.hitStrength.value *= 0.8;
                        requestAnimationFrame(fadeOut);
                    } else {
                        this.hitStrength.value = 0;
                    }
                };
                fadeOut();
            }
        }, 80);

        if (this.health <= 0) {
            this.die();
        }
    }

    private die() {
        this.isDead = true;
        this.hitStrength.value = 0.5; // 死亡时保持一定亮度
        SoundManager.getInstance().playEnemyDeath();
        
        // 死亡动画 - 缩小消失
        const shrinkAnimation = () => {
            if (this.mesh.scale.x > 0.01) {
                this.mesh.scale.multiplyScalar(0.92);
                this.mesh.position.y -= 0.02;
                this.mesh.rotation.y += 0.1;
                requestAnimationFrame(shrinkAnimation);
            } else {
                this.mesh.visible = false;
            }
        };
        shrinkAnimation();
    }

    public dispose() {
        if (this.mesh.geometry) {
            this.mesh.geometry.dispose();
        }
        if (this.mesh.material) {
            (this.mesh.material as MeshStandardNodeMaterial).dispose();
        }
    }
}
