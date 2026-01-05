import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, mix, checker, uv } from 'three/tsl';

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
    }

    private createStairs() {
        const stepHeight = 0.5;
        const stepDepth = 1.0;
        const stepWidth = 4.0;
        const numSteps = 8;
        
        const material = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.3 });
        material.color.setHex(0x888888);

        // Create stairs at (20, 0, 0) going up towards +Z
        const startX = 20;
        const startZ = -5;

        for (let i = 0; i < numSteps; i++) {
            // Each step is a box that goes from ground to step height
            // This prevents gaps underneath
            const currentHeight = stepHeight * (i + 1);
            const geo = new THREE.BoxGeometry(stepWidth, currentHeight, stepDepth);
            
            const mesh = new THREE.Mesh(geo, material.clone());
            
            // Position:
            // x: constant
            // z: increases by stepDepth
            // y: half of currentHeight (center of box)
            mesh.position.set(
                startX, 
                currentHeight / 2, 
                startZ + i * stepDepth
            );
            
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { isStair: true };
            
            this.scene.add(mesh);
            this.objects.push(mesh);
        }

        // Add a platform at the top
        const platformWidth = 6;
        const platformDepth = 6;
        const platformHeight = stepHeight * numSteps;
        
        const platformGeo = new THREE.BoxGeometry(platformWidth, platformHeight, platformDepth);
        const platformMesh = new THREE.Mesh(platformGeo, material.clone());
        
        platformMesh.position.set(
            startX,
            platformHeight / 2,
            startZ + numSteps * stepDepth + platformDepth / 2 - stepDepth/2 // Align with last step
        );
        
        platformMesh.castShadow = true;
        platformMesh.receiveShadow = true;
        platformMesh.userData = { isStair: true }; // Treat platform as stair for pathfinding
        
        this.scene.add(platformMesh);
        this.objects.push(platformMesh);

        // Add Waypoints for AI Pathfinding (Stair Logic)
        // Bottom of stairs
        const stairBottom = new THREE.Object3D();
        stairBottom.position.set(startX, 0, startZ - 1.0); // Closer to stairs (was 2.0)
        stairBottom.userData = { isWayPoint: true, type: 'stair_bottom', id: 1 };
        this.objects.push(stairBottom);

        // Top of stairs (on platform)
        const stairTop = new THREE.Object3D();
        stairTop.position.set(startX, platformHeight, startZ + numSteps * stepDepth + 1.0); // Slightly onto platform
        stairTop.userData = { isWayPoint: true, type: 'stair_top', id: 1 };
        this.objects.push(stairTop);
    }

    private createFloor() {
        const geometry = new THREE.PlaneGeometry(50, 50);
        
        // TSL Ground Material (Checkerboard)
        const uvNode = uv().mul(10); 
        const checkerNode = checker(uvNode);
        const groundColor = mix(color(0x555555), color(0x444444), checkerNode);
        
        const material = new MeshStandardNodeMaterial({ 
            side: THREE.DoubleSide, 
            roughness: 0.9, 
            metalness: 0.1 
        });
        material.colorNode = groundColor;

        const plane = new THREE.Mesh(geometry, material);
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        plane.userData = { isGround: true };
        this.scene.add(plane);
    }

    private createWalls() {
        const wallHeight = 5;
        const wallThickness = 1;
        const arenaSize = 50;
        
        const material = new MeshStandardNodeMaterial({ roughness: 0.8 });
        material.color.setHex(0x333333);
        
        // 4 Walls
        const configs = [
            { pos: [0, wallHeight/2, -arenaSize/2], size: [arenaSize, wallHeight, wallThickness] }, // North
            { pos: [0, wallHeight/2, arenaSize/2], size: [arenaSize, wallHeight, wallThickness] },  // South
            { pos: [-arenaSize/2, wallHeight/2, 0], size: [wallThickness, wallHeight, arenaSize] }, // West
            { pos: [arenaSize/2, wallHeight/2, 0], size: [wallThickness, wallHeight, arenaSize] },  // East
        ];

        configs.forEach(cfg => {
            const geo = new THREE.BoxGeometry(cfg.size[0], cfg.size[1], cfg.size[2]);
            const mesh = new THREE.Mesh(geo, material.clone());
            mesh.position.set(cfg.pos[0] as number, cfg.pos[1] as number, cfg.pos[2] as number);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.objects.push(mesh);
        });
    }

    private createObstacles() {
        const boxGeo = new THREE.BoxGeometry(2, 2, 2);
        const tallGeo = new THREE.BoxGeometry(2, 6, 2);
        
        const material = new MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.5 });
        material.color.setHex(0x666666);

        const positions = [
            // Central cover
            { x: 5, z: 5, type: 'box' },
            { x: -5, z: 5, type: 'box' },
            { x: 5, z: -5, type: 'box' },
            { x: -5, z: -5, type: 'box' },
            
            // Pillars
            { x: 15, z: 15, type: 'tall' },
            { x: -15, z: 15, type: 'tall' },
            { x: 15, z: -15, type: 'tall' },
            { x: -15, z: -15, type: 'tall' },

            // Side cover
            { x: 0, z: 15, type: 'box' },
            { x: 0, z: -15, type: 'box' },
            { x: 15, z: 0, type: 'box' },
            { x: -15, z: 0, type: 'box' },
        ];

        positions.forEach(p => {
            const geo = p.type === 'box' ? boxGeo : tallGeo;
            const y = p.type === 'box' ? 1 : 3;
            const mesh = new THREE.Mesh(geo, material.clone());
            mesh.position.set(p.x, y, p.z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.objects.push(mesh);
        });
    }
}
