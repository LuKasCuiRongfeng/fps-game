/**
 * GPU Compute System - 使用 TSL Compute Shader 进行高性能计算
 * 用于敌人AI更新、粒子系统、碰撞检测等
 */
import * as THREE from 'three';
import { StorageBufferAttribute, WebGPURenderer, type ComputeNode } from 'three/webgpu';
import {
    Fn, uniform, storage, instanceIndex,
    float, vec2, vec3, vec4,
    If,
    clamp, floor,
    max, min, sqrt, select, sub
} from 'three/tsl';

// ============= 敌人数据结构 =============
export interface EnemyGPUData {
    positions: Float32Array;      // vec3: x, y, z
    velocities: Float32Array;     // vec3: vx, vy, vz
    states: Float32Array;         // vec4: health, speed, pathIndex, isActive
    targets: Float32Array;        // vec3: targetX, targetY, targetZ
}

// ============= 粒子数据结构 =============
export interface ParticleGPUData {
    positions: Float32Array;      // vec3
    velocities: Float32Array;     // vec3
    colors: Float32Array;         // vec4: r, g, b, a
    lifetimes: Float32Array;      // vec2: currentLife, maxLife
}

// ============= GPU Compute 管理器 =============
export class GPUComputeSystem {
    private renderer: WebGPURenderer;
    private maxEnemies: number;
    private maxParticles: number;
    
    // 敌人数据存储
    private enemyPositionBuffer!: StorageBufferAttribute;
    private enemyVelocityBuffer!: StorageBufferAttribute;
    private enemyStateBuffer!: StorageBufferAttribute;
    private enemyTargetBuffer!: StorageBufferAttribute;
        private enemyColorBuffer!: StorageBufferAttribute;

    // Navigation grid (GPU-only movement helper): 1 = walkable, 0 = blocked
    private navWalkableBuffer!: StorageBufferAttribute;
    private navCellCount = 1;
    private navGridSize = uniform(1);
    private navCellSize = uniform(1);
    private navOffset = uniform(0);

    // Flow-field (GPU): cost + direction (updated at a limited cadence)
    private navCostA!: StorageBufferAttribute;
    private navCostB!: StorageBufferAttribute;
    private navDir!: StorageBufferAttribute;
    private navPlayerIndex = uniform(0);
    private navUpdateTimer = 0;
    private readonly navUpdateInterval = 0.15;
    private readonly navRelaxIterationsPerUpdate = 28;

    private navInitCompute!: ComputeNode;
    private navRelaxAtoB!: ComputeNode;
    private navRelaxBtoA!: ComputeNode;
    private navDirCompute!: ComputeNode;
    
    // 粒子数据存储
    private particlePositionBuffer!: StorageBufferAttribute;
    private particleVelocityBuffer!: StorageBufferAttribute;
    private particleColorBuffer!: StorageBufferAttribute;
    private particleLifetimeBuffer!: StorageBufferAttribute;
    
    // Uniforms
    private deltaTime = uniform(0);
    private playerPosition = uniform(new THREE.Vector3());
    private gravity = uniform(-9.8);

    // Compute 函数
    private enemyUpdateCompute!: ComputeNode;
    private particleUpdateCompute!: ComputeNode;

    constructor(renderer: WebGPURenderer, maxEnemies: number = 100, maxParticles: number = 10000) {
        this.renderer = renderer;
        this.maxEnemies = maxEnemies;
        this.maxParticles = maxParticles;
        
        this.initEnemyBuffers();
        this.initNavigationBuffers();
        this.initParticleBuffers();
        this.createEnemyComputeShader();
        this.createParticleComputeShader();
    }

    private initNavigationBuffers() {
        const walkable = new Float32Array(1);
        walkable[0] = 1;
        this.navWalkableBuffer = new StorageBufferAttribute(walkable, 1);
        this.navCellCount = 1;
        this.navGridSize.value = 1;
        this.navCellSize.value = 1;
        this.navOffset.value = 0;

        const costA = new Float32Array(1);
        const costB = new Float32Array(1);
        costA[0] = 0;
        costB[0] = 0;
        this.navCostA = new StorageBufferAttribute(costA, 1);
        this.navCostB = new StorageBufferAttribute(costB, 1);

        const dir = new Float32Array(2);
        dir[0] = 0;
        dir[1] = 0;
        this.navDir = new StorageBufferAttribute(dir, 2);

        this.createNavFlowFieldComputeShaders();
    }

    private createNavFlowFieldComputeShaders(): void {
        const INF = float(1e9);

        const walkable = storage(this.navWalkableBuffer, 'float', this.navCellCount);
        const costA = storage(this.navCostA, 'float', this.navCellCount);
        const costB = storage(this.navCostB, 'float', this.navCellCount);
        const dirOut = storage(this.navDir, 'vec2', this.navCellCount);

        const gridSize = this.navGridSize;

        // Initialize cost field around the player.
        this.navInitCompute = Fn(() => {
            const index = instanceIndex;
            const w = walkable.element(index);

            // Blocked cells get INF to prevent paths through obstacles.
            const isBlocked = w.lessThan(0.5);

            const isPlayer = index.equal(this.navPlayerIndex);
            const base = select(isPlayer, float(0.0), INF);
            const initial = select(isBlocked, INF, base);
            costA.element(index).assign(initial);
        })().compute(this.navCellCount);

        const relax = (src: ReturnType<typeof storage>, dst: ReturnType<typeof storage>) => {
            return Fn(() => {
                const index = instanceIndex;
                const w = walkable.element(index);
                const isBlocked = w.lessThan(0.5);

                // Grid coordinates
                const gx = index.mod(gridSize);
                const gz = float(index.div(gridSize));

                const hasL = gx.greaterThan(0.5);
                const hasR = gx.lessThan(gridSize.sub(1.5));
                const hasU = gz.greaterThan(0.5);
                const hasD = gz.lessThan(gridSize.sub(1.5));

                const left = select(hasL, index.sub(1), index);
                const right = select(hasR, index.add(1), index);
                const up = select(hasU, index.sub(gridSize), index);
                const down = select(hasD, index.add(gridSize), index);

                const c0 = src.element(index);
                const cL = src.element(left).add(1.0);
                const cR = src.element(right).add(1.0);
                const cU = src.element(up).add(1.0);
                const cD = src.element(down).add(1.0);

                const best = min(min(c0, cL), min(min(cR, cU), cD));
                dst.element(index).assign(select(isBlocked, INF, best));
            })().compute(this.navCellCount);
        };

        this.navRelaxAtoB = relax(costA, costB);
        this.navRelaxBtoA = relax(costB, costA);

        // Convert cost field -> direction field (pick lowest-cost neighbor)
        this.navDirCompute = Fn(() => {
            const index = instanceIndex;
            const w = walkable.element(index);
            const isBlocked = w.lessThan(0.5);

            const gx = index.mod(gridSize);
            const gz = float(index.div(gridSize));

            const hasL = gx.greaterThan(0.5);
            const hasR = gx.lessThan(gridSize.sub(1.5));
            const hasU = gz.greaterThan(0.5);
            const hasD = gz.lessThan(gridSize.sub(1.5));

            const left = select(hasL, index.sub(1), index);
            const right = select(hasR, index.add(1), index);
            const up = select(hasU, index.sub(gridSize), index);
            const down = select(hasD, index.add(gridSize), index);

            const cL = costA.element(left);
            const cR = costA.element(right);
            const cU = costA.element(up);
            const cD = costA.element(down);

            const best = min(min(cL, cR), min(cU, cD));

            const dx = select(best.equal(cL), float(-1.0), select(best.equal(cR), float(1.0), float(0.0)));
            const dz = select(best.equal(cU), float(-1.0), select(best.equal(cD), float(1.0), float(0.0)));
            const len = sqrt(dx.mul(dx).add(dz.mul(dz)));
            const inv = select(len.greaterThan(0.5), float(1.0).div(len), float(0.0));
            const dir = vec2(dx.mul(inv), dz.mul(inv));
            dirOut.element(index).assign(select(isBlocked, vec2(0.0, 0.0), dir));
        })().compute(this.navCellCount);
    }

    /**
     * Upload a baked nav grid (typically exported from Pathfinding) to the GPU.
     * This enables obstacle blocking for GPU-driven enemy movement.
     */
    public setNavigationGrid(nav: {
        gridSize: number;
        cellSize: number;
        offset: number;
        walkable: Uint8Array;
    }): void {
        const gridSize = Math.max(1, Math.floor(nav.gridSize));
        const cellCount = gridSize * gridSize;
        if (nav.walkable.length !== cellCount) {
            // Fail-safe: ignore invalid grids.
            return;
        }

        const walkable = new Float32Array(cellCount);
        for (let i = 0; i < cellCount; i++) {
            walkable[i] = nav.walkable[i] ? 1 : 0;
        }

        this.navWalkableBuffer = new StorageBufferAttribute(walkable, 1);
        this.navCellCount = cellCount;
        this.navGridSize.value = gridSize;
        this.navCellSize.value = nav.cellSize;
        this.navOffset.value = nav.offset;

        const costA = new Float32Array(cellCount);
        const costB = new Float32Array(cellCount);
        for (let i = 0; i < cellCount; i++) {
            costA[i] = 1e9;
            costB[i] = 1e9;
        }
        this.navCostA = new StorageBufferAttribute(costA, 1);
        this.navCostB = new StorageBufferAttribute(costB, 1);

        const dir = new Float32Array(cellCount * 2);
        this.navDir = new StorageBufferAttribute(dir, 2);

        this.createNavFlowFieldComputeShaders();

        // Storage bindings depend on buffer + element count: rebuild the compute node.
        this.createEnemyComputeShader();
    }

    public getDebugInfo(): { maxEnemies: number; maxParticles: number } {
        return {
            maxEnemies: this.maxEnemies,
            maxParticles: this.maxParticles,
        };
    }

    /**
     * Expose nav buffers/params for GPU-only debug visualization.
     * This is intentionally read-only and avoids any GPU->CPU readback.
     */
    public getNavDebugView(): {
        gridSize: number;
        cellSize: number;
        offset: number;
        cellCount: number;
        dirBuffer: StorageBufferAttribute;
        walkableBuffer: StorageBufferAttribute;
        costBuffer: StorageBufferAttribute;
    } {
        return {
            gridSize: Math.max(1, Math.floor(this.navGridSize.value)),
            cellSize: this.navCellSize.value || 1,
            offset: this.navOffset.value || 0,
            cellCount: this.navCellCount,
            dirBuffer: this.navDir,
            walkableBuffer: this.navWalkableBuffer,
            costBuffer: this.navCostA,
        };
    }

    // ============= 初始化敌人缓冲区 =============
    private initEnemyBuffers() {
        // 位置缓冲区 (vec3)
        const positions = new Float32Array(this.maxEnemies * 3);
        this.enemyPositionBuffer = new StorageBufferAttribute(positions, 3);
        
        // 速度缓冲区 (vec3)
        const velocities = new Float32Array(this.maxEnemies * 3);
        this.enemyVelocityBuffer = new StorageBufferAttribute(velocities, 3);
        
        // 状态缓冲区 (vec4: health, speed, pathIndex, isActive)
        const states = new Float32Array(this.maxEnemies * 4);
        this.enemyStateBuffer = new StorageBufferAttribute(states, 4);
        
        // 颜色缓冲区 (vec3: r, g, b)
        const colors = new Float32Array(this.maxEnemies * 3);
        this.enemyColorBuffer = new StorageBufferAttribute(colors, 3);
        
        // 目标位置缓冲区 (vec3)
        const targets = new Float32Array(this.maxEnemies * 3);
        this.enemyTargetBuffer = new StorageBufferAttribute(targets, 3);
    }

    // ============= 初始化粒子缓冲区 =============
    private initParticleBuffers() {
        // 位置缓冲区 (vec3)
        const positions = new Float32Array(this.maxParticles * 3);
        this.particlePositionBuffer = new StorageBufferAttribute(positions, 3);
        
        // 速度缓冲区 (vec3)
        const velocities = new Float32Array(this.maxParticles * 3);
        this.particleVelocityBuffer = new StorageBufferAttribute(velocities, 3);
        
        // 颜色缓冲区 (vec4)
        const colors = new Float32Array(this.maxParticles * 4);
        this.particleColorBuffer = new StorageBufferAttribute(colors, 4);
        
        // 生命周期缓冲区 (vec2: current, max)
        const lifetimes = new Float32Array(this.maxParticles * 2);
        this.particleLifetimeBuffer = new StorageBufferAttribute(lifetimes, 2);
    }

    // ============= 敌人移动 Compute Shader =============
    private createEnemyComputeShader() {
        const positionStorage = storage(this.enemyPositionBuffer, 'vec3', this.maxEnemies);
        const velocityStorage = storage(this.enemyVelocityBuffer, 'vec3', this.maxEnemies);
        const stateStorage = storage(this.enemyStateBuffer, 'vec4', this.maxEnemies);
        const navWalkable = storage(this.navWalkableBuffer, 'float', this.navCellCount);
        const navDir = storage(this.navDir, 'vec2', this.navCellCount);

        // Compute Shader: 更新敌人位置
        this.enemyUpdateCompute = Fn(() => {
            const index = instanceIndex;
            
            // 读取当前状态
            const state = stateStorage.element(index);
            const isActive = state.w;
            const renderMode = state.z; // 0=cpu rig, 1=gpu impostor
            
            // 只处理活跃的敌人
            If(isActive.greaterThan(0.5), () => {
                // Only move enemies that are in GPU render mode.
                // CPU-driven enemies still sync their positions into the buffer for rendering/raycasting.
                If(renderMode.greaterThan(0.5), () => {
                const position = positionStorage.element(index);
                const velocity = velocityStorage.element(index);
                const speed = state.y;
                
                // Sample flow-field direction at our current cell.
                const gridSize = this.navGridSize;
                const cellSize = this.navCellSize;
                const offset = this.navOffset;

                const gx = clamp(floor(position.x.div(cellSize).add(offset)), float(0), gridSize.sub(1));
                const gz = clamp(floor(position.z.div(cellSize).add(offset)), float(0), gridSize.sub(1));
                const flatIndex = gx.add(gz.mul(gridSize));
                const flow = navDir.element(flatIndex);

                // Fallback to direct chase if flow-field is undefined (e.g. all blocked).
                const toPlayer = this.playerPosition.sub(position);
                const distXZ = sqrt(toPlayer.x.mul(toPlayer.x).add(toPlayer.z.mul(toPlayer.z)));
                const directX = select(distXZ.greaterThan(0.1), toPlayer.x.div(distXZ), float(0));
                const directZ = select(distXZ.greaterThan(0.1), toPlayer.z.div(distXZ), float(0));

                const useDirect = flow.x.mul(flow.x).add(flow.y.mul(flow.y)).lessThan(0.01);
                const dirX = select(useDirect, directX, flow.x);
                const dirZ = select(useDirect, directZ, flow.y);
                
                // Predict next position
                const stepX = dirX.mul(speed).mul(this.deltaTime);
                const stepZ = dirZ.mul(speed).mul(this.deltaTime);
                const proposedX = position.x.add(stepX);
                const proposedZ = position.z.add(stepZ);

                // Basic obstacle blocking via baked nav grid (1=walkable,0=blocked).
                const g2x = clamp(floor(proposedX.div(cellSize).add(offset)), float(0), gridSize.sub(1));
                const g2z = clamp(floor(proposedZ.div(cellSize).add(offset)), float(0), gridSize.sub(1));
                const flatIndex2 = g2x.add(g2z.mul(gridSize));
                const walk = navWalkable.element(flatIndex2);
                const canMove = walk.greaterThan(0.5);

                // Update velocity (2D only)
                const newVelX = select(canMove, dirX.mul(speed), float(0));
                const newVelZ = select(canMove, dirZ.mul(speed), float(0));

                // Update position (keep Y stable; no terrain access on GPU)
                const newPosX = select(canMove, proposedX, position.x);
                const newPosY = position.y;
                const newPosZ = select(canMove, proposedZ, position.z);
                
                // 写回缓冲区
                positionStorage.element(index).assign(vec3(newPosX, newPosY, newPosZ));
                velocityStorage.element(index).assign(vec3(newVelX, float(0), newVelZ));
                });
            });
        })().compute(this.maxEnemies);
    }

    // ============= 粒子更新 Compute Shader =============
    private createParticleComputeShader() {
        const positionStorage = storage(this.particlePositionBuffer, 'vec3', this.maxParticles);
        const velocityStorage = storage(this.particleVelocityBuffer, 'vec3', this.maxParticles);
        const colorStorage = storage(this.particleColorBuffer, 'vec4', this.maxParticles);
        const lifetimeStorage = storage(this.particleLifetimeBuffer, 'vec2', this.maxParticles);

        // Compute Shader: 更新粒子
        this.particleUpdateCompute = Fn(() => {
            const index = instanceIndex;
            
            const lifetime = lifetimeStorage.element(index);
            const currentLife = lifetime.x;
            const maxLife = lifetime.y;
            
            // 只处理存活的粒子
            If(currentLife.lessThan(maxLife), () => {
                const position = positionStorage.element(index);
                const velocity = velocityStorage.element(index);
                const color = colorStorage.element(index);
                
                // 更新生命周期
                const newLife = currentLife.add(this.deltaTime);
                const lifeRatio = newLife.div(maxLife);
                
                // 应用重力和阻力
                const drag = float(0.98);
                const newVelX = velocity.x.mul(drag);
                const newVelY = velocity.y.add(this.gravity.mul(this.deltaTime).mul(0.5));
                const newVelZ = velocity.z.mul(drag);
                
                // 更新位置
                const newPosX = position.x.add(newVelX.mul(this.deltaTime));
                const newPosY = position.y.add(newVelY.mul(this.deltaTime));
                const newPosZ = position.z.add(newVelZ.mul(this.deltaTime));
                
                // 淡出效果
                const fadeAlpha = sub(float(1), lifeRatio);
                const newAlpha = color.w.mul(fadeAlpha);
                
                // 写回缓冲区
                positionStorage.element(index).assign(vec3(newPosX, newPosY, newPosZ));
                velocityStorage.element(index).assign(vec3(newVelX, newVelY, newVelZ));
                colorStorage.element(index).assign(vec4(color.x, color.y, color.z, newAlpha));
                lifetimeStorage.element(index).assign(vec3(newLife, maxLife, 0).xy); // vec2
            });
        })().compute(this.maxParticles);
    }

    // ============= 更新敌人 =============
    public updateEnemies(delta: number, playerPos: THREE.Vector3) {
        this.deltaTime.value = delta;
        this.playerPosition.value.copy(playerPos);

        // Update flow-field at a limited cadence (keeps compute cost bounded).
        this.navUpdateTimer += delta;
        if (this.navUpdateTimer >= this.navUpdateInterval) {
            this.navUpdateTimer = 0;

            const gridSize = Math.max(1, Math.floor(this.navGridSize.value));
            const cellSize = this.navCellSize.value || 1;
            const offset = this.navOffset.value || 0;

            const gx = Math.max(0, Math.min(gridSize - 1, Math.floor(playerPos.x / cellSize + offset)));
            const gz = Math.max(0, Math.min(gridSize - 1, Math.floor(playerPos.z / cellSize + offset)));
            this.navPlayerIndex.value = gx + gz * gridSize;

            void this.renderer.computeAsync(this.navInitCompute);
            for (let i = 0; i < this.navRelaxIterationsPerUpdate; i++) {
                void this.renderer.computeAsync((i & 1) === 0 ? this.navRelaxAtoB : this.navRelaxBtoA);
            }
            void this.renderer.computeAsync(this.navDirCompute);
        }
        
        // 执行 Compute Shader
        this.renderer.computeAsync(this.enemyUpdateCompute);
    }

    // ============= 更新粒子 =============
    public updateParticles(delta: number) {
        this.deltaTime.value = delta;
        
        // 执行 Compute Shader
        this.renderer.computeAsync(this.particleUpdateCompute);
    }

    // ============= 设置敌人数据 =============
    public setEnemyData(index: number, position: THREE.Vector3, target: THREE.Vector3, speed: number, health: number) {
        const posArray = this.enemyPositionBuffer.array as Float32Array;
        const stateArray = this.enemyStateBuffer.array as Float32Array;
        const targetArray = this.enemyTargetBuffer.array as Float32Array;
        
        // 位置
        posArray[index * 3] = position.x;
        posArray[index * 3 + 1] = position.y;
        posArray[index * 3 + 2] = position.z;
        
        // 状态
        stateArray[index * 4] = health;
        stateArray[index * 4 + 1] = speed;
        stateArray[index * 4 + 2] = 0; // pathIndex
        stateArray[index * 4 + 3] = 1; // isActive
        
        // 目标
        targetArray[index * 3] = target.x;
        targetArray[index * 3 + 1] = target.y;
        targetArray[index * 3 + 2] = target.z;
        
        this.enemyPositionBuffer.needsUpdate = true;
        this.enemyStateBuffer.needsUpdate = true;
        this.enemyTargetBuffer.needsUpdate = true;
    }

    public setEnemyPosition(index: number, position: THREE.Vector3) {
        const posArray = this.enemyPositionBuffer.array as Float32Array;
        posArray[index * 3] = position.x;
        posArray[index * 3 + 1] = position.y;
        posArray[index * 3 + 2] = position.z;
        this.enemyPositionBuffer.needsUpdate = true;
    }

    public setEnemyRenderMode(index: number, mode: 0 | 1) {
        const stateArray = this.enemyStateBuffer.array as Float32Array;
        // state.z is reserved for render mode (0=cpu rig, 1=gpu impostor)
        stateArray[index * 4 + 2] = mode;
        this.enemyStateBuffer.needsUpdate = true;
    }

    public readEnemyPosition(index: number, out: THREE.Vector3): THREE.Vector3 {
        const posArray = this.enemyPositionBuffer.array as Float32Array;
        out.set(
            posArray[index * 3],
            posArray[index * 3 + 1],
            posArray[index * 3 + 2]
        );
        return out;
    }

    public getEnemyPositionBuffer(): StorageBufferAttribute {
        return this.enemyPositionBuffer;
    }

    public getEnemyStateBuffer(): StorageBufferAttribute {
        return this.enemyStateBuffer;
    }
    
    public getEnemyColorBuffer(): StorageBufferAttribute {
        return this.enemyColorBuffer;
    }

    public getMaxEnemies(): number {
        return this.maxEnemies;
    }
    
    public setEnemyColor(index: number, color: THREE.Color) {
        const colorArray = this.enemyColorBuffer.array as Float32Array;
        colorArray[index * 3] = color.r;
        colorArray[index * 3 + 1] = color.g;
        colorArray[index * 3 + 2] = color.b;
        this.enemyColorBuffer.needsUpdate = true;
    }

    // ============= 获取敌人位置 =============
    public getEnemyPosition(index: number): THREE.Vector3 {
        const posArray = this.enemyPositionBuffer.array as Float32Array;
        return new THREE.Vector3(
            posArray[index * 3],
            posArray[index * 3 + 1],
            posArray[index * 3 + 2]
        );
    }

    // ============= 更新敌人目标 =============
    public setEnemyTarget(index: number, target: THREE.Vector3) {
        const targetArray = this.enemyTargetBuffer.array as Float32Array;
        targetArray[index * 3] = target.x;
        targetArray[index * 3 + 1] = target.y;
        targetArray[index * 3 + 2] = target.z;
        this.enemyTargetBuffer.needsUpdate = true;
    }

    // ============= 设置敌人状态 =============
    public setEnemyActive(index: number, active: boolean) {
        const stateArray = this.enemyStateBuffer.array as Float32Array;
        stateArray[index * 4 + 3] = active ? 1 : 0;
        this.enemyStateBuffer.needsUpdate = true;
    }

    // ============= 生成粒子 =============
    public spawnParticles(
        startIndex: number,
        count: number,
        position: THREE.Vector3,
        velocityRange: { min: THREE.Vector3, max: THREE.Vector3 },
        color: THREE.Color,
        lifetime: number
    ) {
        const posArray = this.particlePositionBuffer.array as Float32Array;
        const velArray = this.particleVelocityBuffer.array as Float32Array;
        const colorArray = this.particleColorBuffer.array as Float32Array;
        const lifeArray = this.particleLifetimeBuffer.array as Float32Array;
        
        for (let i = 0; i < count; i++) {
            const idx = (startIndex + i) % this.maxParticles;
            
            // 位置 (带小随机偏移)
            posArray[idx * 3] = position.x + (Math.random() - 0.5) * 0.2;
            posArray[idx * 3 + 1] = position.y + (Math.random() - 0.5) * 0.2;
            posArray[idx * 3 + 2] = position.z + (Math.random() - 0.5) * 0.2;
            
            // 随机速度
            velArray[idx * 3] = THREE.MathUtils.lerp(velocityRange.min.x, velocityRange.max.x, Math.random());
            velArray[idx * 3 + 1] = THREE.MathUtils.lerp(velocityRange.min.y, velocityRange.max.y, Math.random());
            velArray[idx * 3 + 2] = THREE.MathUtils.lerp(velocityRange.min.z, velocityRange.max.z, Math.random());
            
            // 颜色
            colorArray[idx * 4] = color.r;
            colorArray[idx * 4 + 1] = color.g;
            colorArray[idx * 4 + 2] = color.b;
            colorArray[idx * 4 + 3] = 1.0; // alpha
            
            // 生命周期
            lifeArray[idx * 2] = 0; // current
            lifeArray[idx * 2 + 1] = lifetime * (0.8 + Math.random() * 0.4); // max with variance
        }
        
        this.particlePositionBuffer.needsUpdate = true;
        this.particleVelocityBuffer.needsUpdate = true;
        this.particleColorBuffer.needsUpdate = true;
        this.particleLifetimeBuffer.needsUpdate = true;
    }

    // ============= 获取粒子缓冲区 (用于渲染) =============
    public getParticlePositionBuffer(): StorageBufferAttribute {
        return this.particlePositionBuffer;
    }

    public getParticleColorBuffer(): StorageBufferAttribute {
        return this.particleColorBuffer;
    }

    public getParticleLifetimeBuffer(): StorageBufferAttribute {
        return this.particleLifetimeBuffer;
    }

    // ============= 销毁 =============
    public dispose() {
        // 清理缓冲区
        this.enemyPositionBuffer.array = new Float32Array(0);
        this.enemyVelocityBuffer.array = new Float32Array(0);
        this.enemyStateBuffer.array = new Float32Array(0);
        this.enemyTargetBuffer.array = new Float32Array(0);
        this.enemyColorBuffer.array = new Float32Array(0);
        this.particlePositionBuffer.array = new Float32Array(0);
        this.particleVelocityBuffer.array = new Float32Array(0);
        this.particleColorBuffer.array = new Float32Array(0);
        this.particleLifetimeBuffer.array = new Float32Array(0);
    }
}
