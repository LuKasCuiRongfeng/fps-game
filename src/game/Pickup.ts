import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { time, sin, vec3 } from 'three/tsl';
import { GameStateService } from './GameState';
import { SoundManager } from './SoundManager';

export type PickupType = 'health' | 'ammo';

export class Pickup {
    public mesh: THREE.Mesh;
    public type: PickupType;
    public isCollected: boolean = false;
    private floatOffset: number;

    constructor(type: PickupType, position: THREE.Vector3) {
        this.type = type;
        this.floatOffset = Math.random() * 100;

        const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        
        // TSL Material
        const material = new MeshStandardNodeMaterial();
        
        const t = time;
        // Pulse effect
        const pulse = sin(t.mul(5).add(this.floatOffset)).mul(0.2).add(0.8); // 0.6 to 1.0
        
        let baseColor;
        if (type === 'health') {
            baseColor = vec3(0, 1, 0); // Green
        } else {
            baseColor = vec3(1, 1, 0); // Yellow
        }

        material.colorNode = baseColor;
        material.emissiveNode = baseColor.mul(pulse).mul(0.5); // Glowing pulse

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        this.mesh.position.y = 1; // Floating height
        
        // Removed PointLight to prevent shader recompilation stutter
        // The emissive material is enough for visibility
    }

    public update(playerPos: THREE.Vector3, delta: number) {
        if (this.isCollected) return;

        // Rotate
        this.mesh.rotation.y += 2 * delta;
        this.mesh.rotation.x += 1 * delta;

        // Float
        this.mesh.position.y = 1 + Math.sin(Date.now() * 0.003 + this.floatOffset) * 0.2;

        // Check collision
        const dist = this.mesh.position.distanceTo(playerPos);
        if (dist < 1.0) {
            this.collect();
        }
    }

    private collect() {
        this.isCollected = true;
        this.mesh.visible = false;
        SoundManager.getInstance().playPickup();

        if (this.type === 'health') {
            GameStateService.getInstance().updateHealth(25);
        } else {
            GameStateService.getInstance().updateAmmo(15);
        }
    }
}
