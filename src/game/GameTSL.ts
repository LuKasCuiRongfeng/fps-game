/**
 * Game - 使用 TSL 和 GPU Compute 优化的游戏主类
 * 集成所有 shader 系统，最大化 GPU 性能
 */
import * as THREE from 'three';
// @ts-ignore - WebGPU types not fully available
import { WebGPURenderer, PostProcessing } from 'three/webgpu';
import { 
    pass, 
    uniform, time, sin, vec3, vec4, mix, float, 
    smoothstep, screenUV
} from 'three/tsl';

import { PlayerController } from './PlayerController';
import { Enemy } from './EnemyTSL';
import { Pickup } from './PickupTSL';
import { GameStateService } from './GameState';
import { SoundManager } from './SoundManager';
import { Level } from './LevelTSL';
import { Pathfinding } from './Pathfinding';
import { UniformManager } from './shaders/TSLMaterials';
import { GPUComputeSystem } from './shaders/GPUCompute';
import { GPUParticleSystem } from './shaders/GPUParticles';

export class Game {
    private container: HTMLElement;
    private renderer: WebGPURenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private playerController: PlayerController;
    private clock: THREE.Clock;
    
    // 游戏对象
    private objects: THREE.Object3D[] = [];
    private enemies: Enemy[] = [];
    private pickups: Pickup[] = [];
    
    // 计时器
    private spawnTimer: number = 0;
    private pickupSpawnTimer: number = 0;
    
    // 系统
    private pathfinding!: Pathfinding;
    private uniformManager: UniformManager;
    private gpuCompute!: GPUComputeSystem;
    private particleSystem!: GPUParticleSystem;
    
    // 后处理
    private postProcessing!: PostProcessing;
    private damageFlashIntensity = uniform(0);
    
    // 性能监控
    private frameCount: number = 0;
    private lastFpsUpdate: number = 0;
    private currentFps: number = 60;

    constructor(container: HTMLElement) {
        this.container = container;
        this.clock = new THREE.Clock();
        this.uniformManager = UniformManager.getInstance();

        // 初始化 WebGPU 渲染器
        this.renderer = new WebGPURenderer({ 
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 限制像素比以提高性能
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);

        // 初始化场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);
        this.scene.fog = new THREE.Fog(0x87ceeb, 15, 60);

        // 光照
        this.setupLighting();

        // 相机
        this.camera = new THREE.PerspectiveCamera(
            75, 
            window.innerWidth / window.innerHeight, 
            0.1, 
            1000
        );
        this.camera.position.set(0, 1.6, 5);
        this.scene.add(this.camera);

        // 关卡
        new Level(this.scene, this.objects);

        // 寻路系统
        this.pathfinding = new Pathfinding(this.objects);

        // GPU Compute 系统
        this.gpuCompute = new GPUComputeSystem(this.renderer, 100, 10000);

        // 粒子系统
        this.particleSystem = new GPUParticleSystem(this.renderer, this.scene, 50000);

        // 玩家控制器
        this.playerController = new PlayerController(
            this.camera, 
            this.container, 
            this.scene, 
            this.objects
        );

        // 后处理
        this.setupPostProcessing();

        // 生成初始敌人和拾取物
        this.spawnEnemy();
        for (let i = 0; i < 5; i++) {
            this.spawnPickup();
        }

        // 事件监听
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // 启动渲染循环
        this.renderer.setAnimationLoop(this.animate.bind(this));
    }

    /**
     * 设置光照
     */
    private setupLighting() {
        // 环境光
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        // 主方向光 (太阳)
        const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
        sunLight.position.set(15, 30, 15);
        sunLight.castShadow = true;
        
        // 阴影设置
        sunLight.shadow.camera.top = 30;
        sunLight.shadow.camera.bottom = -30;
        sunLight.shadow.camera.left = -30;
        sunLight.shadow.camera.right = 30;
        sunLight.shadow.camera.near = 0.5;
        sunLight.shadow.camera.far = 100;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        sunLight.shadow.bias = -0.0001;
        
        this.scene.add(sunLight);

        // 填充光 (蓝色天空反射)
        const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
        fillLight.position.set(-10, 10, -10);
        this.scene.add(fillLight);

        // 半球光 (天空和地面)
        const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.4);
        this.scene.add(hemiLight);
    }

    /**
     * 设置后处理 - TSL 驱动
     */
    private setupPostProcessing() {
        this.postProcessing = new PostProcessing(this.renderer);
        
        // 场景渲染 pass
        const scenePass = pass(this.scene, this.camera);
        
        // 获取场景颜色
        const sceneColor = scenePass.getTextureNode('output');
        
        // ========== 伤害闪烁效果 ==========
        const damageOverlay = this.createDamageOverlay(sceneColor);
        
        // ========== 简单晕影效果 ==========
        const vignette = this.createVignetteEffect(damageOverlay);
        
        // 输出
        this.postProcessing.outputNode = vignette;
    }

    /**
     * 创建伤害叠加效果
     */
    private createDamageOverlay(inputColor: any) {
        const coord = screenUV;
        const damageAmount = this.damageFlashIntensity;
        
        // 红色叠加
        const damageColor = vec3(0.8, 0.1, 0.05);
        
        // 边缘晕影
        const center = vec3(0.5, 0.5, 0);
        const distFromCenter = coord.sub(center.xy).length();
        const edgeFade = smoothstep(float(0.3), float(0.8), distFromCenter);
        
        // 脉动
        const t = time;
        const pulse = sin(t.mul(15)).mul(0.2).add(0.8);
        
        // 伤害强度
        const damageStrength = damageAmount.mul(edgeFade).mul(pulse);
        
        // 混合
        const finalColor = mix(inputColor, vec4(damageColor, 1), damageStrength.mul(0.5));
        
        return finalColor;
    }

    /**
     * 创建晕影效果
     */
    private createVignetteEffect(inputColor: any) {
        const coord = screenUV;
        
        // 计算到中心的距离
        const center = vec3(0.5, 0.5, 0);
        const dist = coord.sub(center.xy).length();
        
        // 晕影强度
        const vignetteStrength = float(0.4);
        const vignetteRadius = float(0.8);
        const vignetteSoftness = float(0.5);
        
        // 平滑晕影
        const vignette = smoothstep(vignetteRadius, vignetteRadius.sub(vignetteSoftness), dist);
        
        // 应用晕影
        const darkening = mix(float(1), vignette, vignetteStrength);
        const finalColor = inputColor.mul(darkening);
        
        return finalColor;
    }

    /**
     * 生成敌人
     */
    private spawnEnemy() {
        const angle = Math.random() * Math.PI * 2;
        const radius = 8 + Math.random() * 5;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        const enemy = new Enemy(new THREE.Vector3(x, 0, z));
        enemy.gpuIndex = this.enemies.length;
        
        this.scene.add(enemy.mesh);
        this.enemies.push(enemy);
        
        // 更新 GPU Compute 数据
        this.gpuCompute.setEnemyData(
            enemy.gpuIndex,
            enemy.mesh.position,
            this.camera.position,
            3.0,
            100
        );
    }

    /**
     * 生成拾取物
     */
    private spawnPickup() {
        if (this.pickups.length >= 10) return;

        const type = Math.random() > 0.5 ? 'health' : 'ammo';
        const x = (Math.random() - 0.5) * 40;
        const z = (Math.random() - 0.5) * 40;
        
        const pickup = new Pickup(type, new THREE.Vector3(x, 0, z));
        this.scene.add(pickup.mesh);
        this.pickups.push(pickup);
    }

    /**
     * 窗口大小变化
     */
    private onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * 主循环
     */
    private animate() {
        const rawDelta = this.clock.getDelta();
        const delta = Math.min(rawDelta, 0.1);

        // 更新 FPS
        this.updateFPS(delta);

        const gameState = GameStateService.getInstance().getState();

        if (gameState.isGameOver) {
            this.playerController.unlock();
            return;
        }

        // 更新玩家
        this.playerController.update(delta);
        const playerPos = this.camera.position;

        // 更新全局 uniforms
        this.uniformManager.update(delta, playerPos, gameState.health);

        // 更新 GPU Compute 系统
        this.gpuCompute.updateEnemies(delta, playerPos);
        
        // 更新粒子系统
        this.particleSystem.update(delta);

        // 更新拾取物
        this.updatePickups(playerPos, delta);

        // 更新敌人
        this.updateEnemies(playerPos, delta);

        // 更新伤害闪烁
        this.damageFlashIntensity.value = Math.max(0, this.damageFlashIntensity.value - delta * 3);

        // 生成逻辑
        this.spawnTimer += delta;
        if (this.spawnTimer > 3.0 && this.enemies.length < 5) {
            this.spawnEnemy();
            this.spawnTimer = 0;
        }

        this.pickupSpawnTimer += delta;
        if (this.pickupSpawnTimer > 10.0) {
            this.spawnPickup();
            this.pickupSpawnTimer = 0;
        }

        // 渲染 (使用后处理)
        this.postProcessing.render();
    }

    /**
     * 更新拾取物
     */
    private updatePickups(playerPos: THREE.Vector3, delta: number) {
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const pickup = this.pickups[i];
            pickup.update(playerPos, delta);
            
            if (pickup.isCollected) {
                this.scene.remove(pickup.mesh);
                pickup.dispose();
                this.pickups.splice(i, 1);
            }
        }
    }

    /**
     * 更新敌人
     */
    private updateEnemies(playerPos: THREE.Vector3, delta: number) {
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            
            // 更新敌人目标 (玩家位置)
            if (enemy.gpuIndex >= 0) {
                this.gpuCompute.setEnemyTarget(enemy.gpuIndex, playerPos);
            }
            
            enemy.update(playerPos, delta, this.objects, this.pathfinding);
            
            // 玩家碰撞检测
            const dist = enemy.mesh.position.distanceTo(playerPos);
            if (dist < 1.0) {
                GameStateService.getInstance().updateHealth(-10 * delta);
                
                // 触发伤害效果
                if (Math.random() < 0.1) {
                    this.damageFlashIntensity.value = 0.5;
                    SoundManager.getInstance().playDamage();
                }
            }

            // 死亡处理
            if (enemy.isDead) {
                // 死亡粒子效果
                this.particleSystem.emitBlood(
                    enemy.mesh.position,
                    new THREE.Vector3(0, 1, 0),
                    20
                );
                
                this.scene.remove(enemy.mesh);
                
                if (enemy.gpuIndex >= 0) {
                    this.gpuCompute.setEnemyActive(enemy.gpuIndex, false);
                }
                
                enemy.dispose();
                this.enemies.splice(i, 1);
            }
        }
    }

    /**
     * 更新 FPS 显示
     */
    private updateFPS(delta: number) {
        this.frameCount++;
        this.lastFpsUpdate += delta;
        
        if (this.lastFpsUpdate >= 1.0) {
            this.currentFps = Math.round(this.frameCount / this.lastFpsUpdate);
            this.frameCount = 0;
            this.lastFpsUpdate = 0;
            
            // 可以将 FPS 发送到 UI
            // console.log('FPS:', this.currentFps);
        }
    }

    /**
     * 获取当前 FPS
     */
    public getFPS(): number {
        return this.currentFps;
    }

    /**
     * 获取粒子系统 (用于外部触发效果)
     */
    public getParticleSystem(): GPUParticleSystem {
        return this.particleSystem;
    }

    /**
     * 触发伤害效果
     */
    public triggerDamageEffect() {
        this.damageFlashIntensity.value = 1.0;
        this.uniformManager.triggerDamageFlash();
    }

    /**
     * 销毁
     */
    public dispose() {
        this.playerController.dispose();
        this.particleSystem.dispose();
        this.gpuCompute.dispose();
        this.renderer.dispose();
        
        // 清理敌人
        this.enemies.forEach(e => {
            this.scene.remove(e.mesh);
            e.dispose();
        });
        
        // 清理拾取物
        this.pickups.forEach(p => {
            this.scene.remove(p.mesh);
            p.dispose();
        });
        
        window.removeEventListener('resize', this.onWindowResize.bind(this));
        this.container.removeChild(this.renderer.domElement);
    }
}
