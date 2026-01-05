// filepath: d:\tauri\fps-game\src\game\Game.ts
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { PlayerController } from './PlayerController';
import { Enemy } from './Enemy';
import { Pickup } from './Pickup';
import { GameStateService } from './GameState';
import { SoundManager } from './SoundManager';
import { Level } from './Level';
import { Pathfinding } from './Pathfinding';

export class Game {
    private container: HTMLElement;
    private renderer: WebGPURenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private playerController: PlayerController;
    private clock: THREE.Clock;
    private objects: THREE.Object3D[] = [];
    private enemies: Enemy[] = [];
    private pickups: Pickup[] = [];
    private spawnTimer: number = 0;
    private pickupSpawnTimer: number = 0;
    private pathfinding: Pathfinding;

    constructor(container: HTMLElement) {
        this.container = container;
        this.clock = new THREE.Clock();

        // 1. 初始化渲染器
        this.renderer = new WebGPURenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true; // Enable shadows
        this.renderer.setAnimationLoop(this.animate.bind(this));
        this.container.appendChild(this.renderer.domElement);

        // 2. 初始化场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // 天空蓝
        this.scene.fog = new THREE.Fog(0x87ceeb, 10, 50); // Add fog for depth

        // Add Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        dirLight.shadow.camera.top = 20;
        dirLight.shadow.camera.bottom = -20;
        dirLight.shadow.camera.left = -20;
        dirLight.shadow.camera.right = 20;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        this.scene.add(dirLight);

        // 3. 初始化相机
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 1.6, 5); // 模拟人眼高度
        this.scene.add(this.camera);

        // 4. 初始化关卡
        new Level(this.scene, this.objects);

        // Initialize Pathfinding
        this.pathfinding = new Pathfinding(this.objects);

        // 5. 初始化玩家控制器
        this.playerController = new PlayerController(this.camera, this.container, this.scene, this.objects);

        // 6. Spawn initial enemy
        this.spawnEnemy();
        
        // Spawn initial pickups
        for (let i = 0; i < 5; i++) {
            this.spawnPickup();
        }

        // 7. 监听窗口大小变化
        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    private spawnEnemy() {
        // Random position around the center, but not too close
        const angle = Math.random() * Math.PI * 2;
        const radius = 8 + Math.random() * 5; // 8 to 13 meters away
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        const enemy = new Enemy(new THREE.Vector3(x, 0, z));
        this.scene.add(enemy.mesh);
        this.enemies.push(enemy);
    }

    private spawnPickup() {
        if (this.pickups.length >= 10) return; // Max pickups

        const type = Math.random() > 0.5 ? 'health' : 'ammo';
        // Random position
        const x = (Math.random() - 0.5) * 40;
        const z = (Math.random() - 0.5) * 40;
        
        // Simple check to avoid spawning inside walls (very basic)
        // Ideally we check against this.objects bounding boxes
        
        const pickup = new Pickup(type, new THREE.Vector3(x, 0, z));
        this.scene.add(pickup.mesh);
        this.pickups.push(pickup);
    }

    private onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    private animate() {
        // Clamp delta to prevent physics explosions during lag spikes
        const rawDelta = this.clock.getDelta();
        const delta = Math.min(rawDelta, 0.1);

        const gameState = GameStateService.getInstance().getState();

        if (gameState.isGameOver) {
            this.playerController.unlock(); // Unlock mouse on game over
            return;
        }

        this.playerController.update(delta);

        const playerPos = this.camera.position;

        // Update pickups
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const pickup = this.pickups[i];
            pickup.update(playerPos, delta);
            
            if (pickup.isCollected) {
                this.scene.remove(pickup.mesh);
                this.pickups.splice(i, 1);
            }
        }

        // Update enemies
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            enemy.update(playerPos, delta, this.objects, this.pathfinding);
            
            // Check collision with player
            const dist = enemy.mesh.position.distanceTo(playerPos);
            if (dist < 1.0) { // Simple collision radius
                GameStateService.getInstance().updateHealth(-10 * delta); // Damage over time
                // Play damage sound occasionally (not every frame)
                if (Math.random() < 0.05) {
                    SoundManager.getInstance().playDamage();
                }
            }

            if (enemy.isDead) {
                this.scene.remove(enemy.mesh);
                this.enemies.splice(i, 1);
            }
        }

        // Spawn logic
        this.spawnTimer += delta;
        if (this.spawnTimer > 3.0 && this.enemies.length < 5) {
            this.spawnEnemy();
            this.spawnTimer = 0;
        }

        this.pickupSpawnTimer += delta;
        if (this.pickupSpawnTimer > 10.0) { // Spawn pickup every 10 seconds
            this.spawnPickup();
            this.pickupSpawnTimer = 0;
        }

        // 渲染场景
        this.renderer.render(this.scene, this.camera);
    }

    public dispose() {
        this.playerController.dispose();
        this.renderer.dispose();
        window.removeEventListener('resize', this.onWindowResize.bind(this));
        this.container.removeChild(this.renderer.domElement);
    }
}