/**
 * Level - 使用 TSL 材质增强的关卡系统
 * 所有地形材质使用程序化生成的 shader 纹理
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { 
    time, sin, vec3, mix, float, 
    smoothstep, fract, floor, uv,
    sub, max, mod, normalLocal, normalize, step, positionWorld
} from 'three/tsl';

export class Level {
    private scene: THREE.Scene;
    private objects: THREE.Object3D[];

    constructor(scene: THREE.Scene, objects: THREE.Object3D[]) {
        this.scene = scene;
        this.objects = objects;
        
        this.createFloor();
        this.createWalls();
        this.createObstacles();
        this.createStairs();
        this.createSkybox();
        this.createAtmosphere();
    }

    /**
     * 创建地板 - 高级砖块纹理
     */
    private createFloor() {
        const geometry = new THREE.PlaneGeometry(50, 50, 1, 1);
        const material = this.createFloorMaterial();

        const plane = new THREE.Mesh(geometry, material);
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        plane.userData = { isGround: true };
        this.scene.add(plane);
    }

    /**
     * 地板材质 - 程序化砖块纹理
     */
    private createFloorMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            side: THREE.DoubleSide,
            roughness: 0.85,
            metalness: 0.05
        });

        const uvCoord = uv().mul(15); // 15x15 砖块网格
        const t = time;
        
        // ========== 砖块图案 ==========
        const brickWidth = float(1);
        const brickHeight = float(0.5);
        const mortarWidth = float(0.05);
        
        // 行列计算
        const row = floor(uvCoord.y.div(brickHeight));
        const offsetX = mod(row, float(2)).mul(0.5); // 错位
        const adjustedX = uvCoord.x.add(offsetX);
        
        const brickX = fract(adjustedX.div(brickWidth));
        const brickY = fract(uvCoord.y.div(brickHeight));
        
        // 砖缝蒙版
        const mortarMaskX = smoothstep(float(0), mortarWidth, brickX)
            .mul(smoothstep(float(1), sub(float(1), mortarWidth), brickX));
        const mortarMaskY = smoothstep(float(0), mortarWidth.mul(2), brickY)
            .mul(smoothstep(float(1), sub(float(1), mortarWidth.mul(2)), brickY));
        const brickMask = mortarMaskX.mul(mortarMaskY);
        
        // ========== 砖块颜色变化 ==========
        const brickIndex = floor(adjustedX).add(row.mul(100));
        const colorNoise1 = sin(brickIndex.mul(12.9898)).mul(0.5).add(0.5);
        const colorNoise2 = sin(brickIndex.mul(78.233)).mul(0.5).add(0.5);
        
        // 基础颜色变体
        const brickColor1 = vec3(0.45, 0.38, 0.32);
        const brickColor2 = vec3(0.52, 0.45, 0.38);
        const brickColor3 = vec3(0.38, 0.32, 0.28);
        
        // 混合砖块颜色
        const brickColorMix = mix(
            mix(brickColor1, brickColor2, colorNoise1),
            brickColor3,
            colorNoise2.mul(0.3)
        );
        
        // 添加表面噪声
        const surfaceNoise = sin(uvCoord.x.mul(50)).mul(sin(uvCoord.y.mul(50))).mul(0.02);
        const brickWithNoise = brickColorMix.add(surfaceNoise);
        
        // ========== 砖缝颜色 ==========
        const mortarColor = vec3(0.2, 0.18, 0.15);
        
        // ========== 磨损效果 ==========
        // 砖块边缘磨损
        const edgeWear = smoothstep(float(0.1), float(0.2), brickX)
            .mul(smoothstep(float(0.9), float(0.8), brickX));
        const wearDarkening = mix(float(0.85), float(1.0), edgeWear);
        
        // 最终颜色
        const finalColor = mix(mortarColor, brickWithNoise.mul(wearDarkening), brickMask);
        
        material.colorNode = finalColor;
        
        // ========== 法线贴图效果 ==========
        // 砖块凸起
        const bumpStrength = sub(float(1), brickMask).mul(0.15);
        const bumpNormal = normalLocal.add(vec3(0, bumpStrength, 0));
        material.normalNode = normalize(bumpNormal);
        
        // ========== 动态粗糙度 ==========
        // 砖缝处更粗糙
        material.roughnessNode = mix(float(0.95), float(0.75), brickMask);
        
        return material;
    }

    /**
     * 创建墙壁 - 混凝土砖墙纹理
     */
    private createWalls() {
        const wallHeight = 5;
        const wallThickness = 1;
        const arenaSize = 50;
        
        const configs = [
            { pos: [0, wallHeight/2, -arenaSize/2], size: [arenaSize, wallHeight, wallThickness] },
            { pos: [0, wallHeight/2, arenaSize/2], size: [arenaSize, wallHeight, wallThickness] },
            { pos: [-arenaSize/2, wallHeight/2, 0], size: [wallThickness, wallHeight, arenaSize] },
            { pos: [arenaSize/2, wallHeight/2, 0], size: [wallThickness, wallHeight, arenaSize] },
        ];

        configs.forEach(cfg => {
            const geo = new THREE.BoxGeometry(cfg.size[0], cfg.size[1], cfg.size[2]);
            const material = this.createWallMaterial();
            
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.objects.push(mesh);
        });
    }

    /**
     * 墙壁材质 - 混凝土砖块
     */
    private createWallMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.9,
            metalness: 0.0
        });

        const uvCoord = uv();
        const t = time;
        
        // ========== 大砖块图案 ==========
        const brickScaleX = float(6);
        const brickScaleY = float(3);
        
        const row = floor(uvCoord.y.mul(brickScaleY));
        const offset = mod(row, float(2)).mul(0.5);
        const adjustedX = uvCoord.x.mul(brickScaleX).add(offset);
        
        const brickX = fract(adjustedX);
        const brickY = fract(uvCoord.y.mul(brickScaleY));
        
        // 砖缝
        const gap = float(0.04);
        const brickMaskX = smoothstep(float(0), gap, brickX)
            .mul(smoothstep(float(1), sub(float(1), gap), brickX));
        const brickMaskY = smoothstep(float(0), gap, brickY)
            .mul(smoothstep(float(1), sub(float(1), gap), brickY));
        const brickMask = brickMaskX.mul(brickMaskY);
        
        // ========== 混凝土纹理 ==========
        const noiseFreq = float(30);
        const noise1 = sin(uvCoord.x.mul(noiseFreq)).mul(sin(uvCoord.y.mul(noiseFreq)));
        const noise2 = sin(uvCoord.x.mul(noiseFreq.mul(2.3))).mul(sin(uvCoord.y.mul(noiseFreq.mul(1.7))));
        const concreteNoise = noise1.mul(0.03).add(noise2.mul(0.02));
        
        // 砖块颜色变化
        const brickIndex = floor(adjustedX).add(row.mul(50));
        const colorVar = sin(brickIndex.mul(43.758)).mul(0.08);
        
        // 基础灰色
        const baseGray = vec3(0.35, 0.33, 0.30);
        const concreteColor = baseGray.add(colorVar).add(concreteNoise);
        
        // 砖缝颜色
        const mortarColor = vec3(0.25, 0.23, 0.20);
        
        // ========== 污渍效果 ==========
        // 顶部和底部更脏
        const verticalDirt = smoothstep(float(0.8), float(1.0), uvCoord.y)
            .add(smoothstep(float(0.2), float(0.0), uvCoord.y).mul(0.5));
        const dirtColor = vec3(0.2, 0.18, 0.15);
        
        const concreteWithDirt = mix(concreteColor, dirtColor, verticalDirt.mul(0.3));
        
        // 最终颜色
        const finalColor = mix(mortarColor, concreteWithDirt, brickMask);
        
        material.colorNode = finalColor;
        
        // 粗糙度变化
        material.roughnessNode = mix(float(0.95), float(0.85), brickMask);
        
        return material;
    }

    /**
     * 创建障碍物 - 金属/混凝土方块
     */
    private createObstacles() {
        const boxGeo = new THREE.BoxGeometry(2, 2, 2);
        const tallGeo = new THREE.BoxGeometry(2, 6, 2);

        const positions = [
            { x: 5, z: 5, type: 'box' },
            { x: -5, z: 5, type: 'box' },
            { x: 5, z: -5, type: 'box' },
            { x: -5, z: -5, type: 'box' },
            { x: 15, z: 15, type: 'tall' },
            { x: -15, z: 15, type: 'tall' },
            { x: 15, z: -15, type: 'tall' },
            { x: -15, z: -15, type: 'tall' },
            { x: 0, z: 15, type: 'box' },
            { x: 0, z: -15, type: 'box' },
            { x: 15, z: 0, type: 'box' },
            { x: -15, z: 0, type: 'box' },
        ];

        positions.forEach((p, index) => {
            const geo = p.type === 'box' ? boxGeo : tallGeo;
            const y = p.type === 'box' ? 1 : 3;
            
            // 交替使用金属和混凝土材质
            const material = index % 2 === 0 
                ? this.createMetalCrateMaterial() 
                : this.createConcreteMaterial();
            
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.set(p.x, y, p.z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.objects.push(mesh);
        });
    }

    /**
     * 金属箱子材质
     */
    private createMetalCrateMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.4,
            metalness: 0.8
        });

        const uvCoord = uv();
        const t = time;
        
        // ========== 金属板图案 ==========
        const panelCount = float(4);
        const panelX = fract(uvCoord.x.mul(panelCount));
        const panelY = fract(uvCoord.y.mul(panelCount));
        
        // 面板边框
        const borderWidth = float(0.08);
        const borderMaskX = smoothstep(float(0), borderWidth, panelX)
            .mul(smoothstep(float(1), sub(float(1), borderWidth), panelX));
        const borderMaskY = smoothstep(float(0), borderWidth, panelY)
            .mul(smoothstep(float(1), sub(float(1), borderWidth), panelY));
        const panelMask = borderMaskX.mul(borderMaskY);
        
        // ========== 划痕纹理 ==========
        const scratchFreq = float(50);
        const scratch1 = sin(uvCoord.x.mul(scratchFreq).add(uvCoord.y.mul(0.5)));
        const scratch2 = sin(uvCoord.y.mul(scratchFreq).add(uvCoord.x.mul(0.3)));
        const scratches = max(scratch1, scratch2).mul(0.5).add(0.5);
        
        // ========== 锈迹 ==========
        const rustNoise = sin(uvCoord.x.mul(20)).mul(sin(uvCoord.y.mul(20)));
        const rustMask = smoothstep(float(0.3), float(0.5), rustNoise);
        
        // 颜色
        const metalColor = vec3(0.5, 0.48, 0.45);
        const rustColor = vec3(0.45, 0.25, 0.15);
        const borderColor = vec3(0.35, 0.33, 0.30);
        
        // 混合
        const metalWithScratches = metalColor.mul(mix(float(0.85), float(1.0), scratches));
        const metalWithRust = mix(metalWithScratches, rustColor, rustMask.mul(0.3));
        const finalColor = mix(borderColor, metalWithRust, panelMask);
        
        material.colorNode = finalColor;
        
        // 动态粗糙度 - 划痕处更粗糙，锈迹处最粗糙
        material.roughnessNode = mix(
            float(0.3),
            float(0.8),
            scratches.sub(0.5).abs().add(rustMask.mul(0.5))
        );
        
        // 金属度 - 锈迹处降低
        material.metalnessNode = mix(float(0.9), float(0.2), rustMask);
        
        return material;
    }

    /**
     * 混凝土材质
     */
    private createConcreteMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.95,
            metalness: 0.0
        });

        const uvCoord = uv();
        
        // 混凝土噪声
        const noiseFreq = float(20);
        const noise1 = sin(uvCoord.x.mul(noiseFreq)).mul(sin(uvCoord.y.mul(noiseFreq)));
        const noise2 = sin(uvCoord.x.mul(noiseFreq.mul(3.1))).mul(sin(uvCoord.y.mul(noiseFreq.mul(2.7))));
        const combinedNoise = noise1.mul(0.04).add(noise2.mul(0.02));
        
        // 大颗粒效果
        const grainFreq = float(100);
        const grain = sin(uvCoord.x.mul(grainFreq)).mul(sin(uvCoord.y.mul(grainFreq))).mul(0.02);
        
        // 基础颜色
        const baseColor = vec3(0.55, 0.52, 0.48);
        const finalColor = baseColor.add(combinedNoise).add(grain);
        
        material.colorNode = finalColor;
        
        return material;
    }

    /**
     * 创建楼梯
     */
    private createStairs() {
        const stepHeight = 0.5;
        const stepDepth = 1.0;
        const stepWidth = 4.0;
        const numSteps = 8;
        
        const startX = 20;
        const startZ = -5;

        for (let i = 0; i < numSteps; i++) {
            const currentHeight = stepHeight * (i + 1);
            const geo = new THREE.BoxGeometry(stepWidth, currentHeight, stepDepth);
            const material = this.createStairMaterial();
            
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.set(startX, currentHeight / 2, startZ + i * stepDepth);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { isStair: true };
            
            this.scene.add(mesh);
            this.objects.push(mesh);
        }

        // 顶部平台
        const platformWidth = 6;
        const platformDepth = 6;
        const platformHeight = stepHeight * numSteps;
        
        const platformGeo = new THREE.BoxGeometry(platformWidth, platformHeight, platformDepth);
        const platformMaterial = this.createStairMaterial();
        const platformMesh = new THREE.Mesh(platformGeo, platformMaterial);
        
        platformMesh.position.set(
            startX,
            platformHeight / 2,
            startZ + numSteps * stepDepth + platformDepth / 2 - stepDepth/2
        );
        
        platformMesh.castShadow = true;
        platformMesh.receiveShadow = true;
        platformMesh.userData = { isStair: true };
        
        this.scene.add(platformMesh);
        this.objects.push(platformMesh);

        // 路径点
        const stairBottom = new THREE.Object3D();
        stairBottom.position.set(startX, 0, startZ - 1.0);
        stairBottom.userData = { isWayPoint: true, type: 'stair_bottom', id: 1 };
        this.objects.push(stairBottom);

        const stairTop = new THREE.Object3D();
        stairTop.position.set(startX, platformHeight, startZ + numSteps * stepDepth + 1.0);
        stairTop.userData = { isWayPoint: true, type: 'stair_top', id: 1 };
        this.objects.push(stairTop);
    }

    /**
     * 楼梯材质 - 带防滑纹理
     */
    private createStairMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.7,
            metalness: 0.2
        });

        const uvCoord = uv();
        
        // 防滑条纹
        const stripeFreq = float(20);
        const stripes = sin(uvCoord.x.mul(stripeFreq)).mul(0.5).add(0.5);
        const stripeMask = step(float(0.7), stripes);
        
        // 混凝土基础
        const noiseFreq = float(30);
        const noise = sin(uvCoord.x.mul(noiseFreq)).mul(sin(uvCoord.y.mul(noiseFreq))).mul(0.03);
        
        // 颜色
        const baseColor = vec3(0.5, 0.48, 0.45);
        const stripeColor = vec3(0.3, 0.28, 0.25);
        
        const finalColor = mix(baseColor.add(noise), stripeColor, stripeMask.mul(0.3));
        
        material.colorNode = finalColor;
        
        // 条纹处更粗糙
        material.roughnessNode = mix(float(0.6), float(0.9), stripeMask);
        
        return material;
    }

    /**
     * 创建天空盒
     */
    private createSkybox() {
        const skyGeo = new THREE.SphereGeometry(100, 32, 32);
        const skyMaterial = this.createSkyMaterial();
        
        const sky = new THREE.Mesh(skyGeo, skyMaterial);
        this.scene.add(sky);
    }

    /**
     * 天空材质 - 动态渐变
     */
    private createSkyMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial({
            side: THREE.BackSide
        });

        const t = time;
        
        // 使用世界位置计算高度
        const worldPos = positionWorld;
        const height = worldPos.y.div(100).add(0.5); // 归一化到 0-1
        
        // 天空渐变
        const horizonColor = vec3(0.75, 0.88, 0.98);
        const zenithColor = vec3(0.4, 0.6, 0.95);
        const sunsetTint = vec3(0.95, 0.85, 0.7);
        
        // 基础渐变
        const skyGradient = smoothstep(float(0.3), float(0.8), height);
        let skyColor = mix(horizonColor, zenithColor, skyGradient);
        
        // 添加日落色调 (可选，基于时间)
        const sunsetAmount = sin(t.mul(0.1)).mul(0.5).add(0.5).mul(0.2);
        skyColor = mix(skyColor, sunsetTint, sunsetAmount.mul(sub(float(1), skyGradient)));
        
        material.colorNode = skyColor;
        
        return material;
    }

    /**
     * 创建大气效果 - 环境雾
     */
    private createAtmosphere() {
        // Three.js 内置雾已在 Game.ts 中设置
        // 这里可以添加额外的大气效果
        
        // 灰尘粒子 (可选)
        this.createDustParticles();
    }

    /**
     * 创建环境灰尘粒子
     */
    private createDustParticles() {
        const particleCount = 200;
        const positions = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 50;
            positions[i * 3 + 1] = Math.random() * 10;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 50;
            sizes[i] = Math.random() * 0.1 + 0.02;
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        // 简单材质 - 可以用 TSL 增强
        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.05,
            transparent: true,
            opacity: 0.3,
            depthWrite: false
        });
        
        const particles = new THREE.Points(geometry, material);
        particles.userData = { isDust: true };
        this.scene.add(particles);
    }
}
