import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color } from 'three/tsl';
import { Enemy } from './Enemy';
import { GameStateService } from './GameState';
import { SoundManager } from './SoundManager';

export class Weapon {
    private camera: THREE.Camera;
    private mesh: THREE.Mesh;
    private raycaster: THREE.Raycaster;
    private flashMesh: THREE.Mesh;

    constructor(camera: THREE.Camera) {
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();

        // Gun mesh (simple box)
        const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.6);
        
        // TSL Material
        const material = new MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.8 });
        material.colorNode = color(0x888888);
        
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.castShadow = true;
        
        // Position: Right side, lower, slightly more forward
        this.mesh.position.set(0.3, -0.25, -0.6);
        
        // Add to camera
        this.camera.add(this.mesh);
        
        // Muzzle flash (hidden by default)
        const flashGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        this.flashMesh = new THREE.Mesh(flashGeo, flashMat);
        this.flashMesh.position.set(0, 0, -0.4); // Tip of the gun (gun is 0.6 long, center at 0, so tip is at -0.3. -0.4 is slightly in front)
        this.flashMesh.visible = false;
        this.mesh.add(this.flashMesh);
    }

    public shoot(scene: THREE.Scene) {
        const gameState = GameStateService.getInstance();
        if (gameState.getState().ammo <= 0) return; // No ammo

        gameState.updateAmmo(-1);
        SoundManager.getInstance().playShoot();

        // Visual effect: Muzzle flash
        this.flashMesh.visible = true;
        // Force update matrix to ensure it renders in the correct position immediately if needed
        this.flashMesh.updateMatrixWorld();
        
        setTimeout(() => { this.flashMesh.visible = false; }, 50);

        // Raycast
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        
        // Intersect against everything in the scene
        const intersects = this.raycaster.intersectObjects(scene.children);

        for (const intersect of intersects) {
            // Skip if we hit the gun itself (though it shouldn't be in scene.children usually)
            // or if we hit something invisible/helper
            
            const obj = intersect.object as THREE.Mesh;

            // Skip ground
            if (obj.userData.isGround) continue;

            // Check if it's an enemy
            if (obj.userData.isEnemy && obj.userData.entity) {
                const enemy = obj.userData.entity as Enemy;
                enemy.takeDamage(34); // 3 shots to kill
                SoundManager.getInstance().playHit();
                
                if (enemy.isDead) {
                    GameStateService.getInstance().updateScore(100);
                }
                
                console.log('Hit enemy!');
                break; // Stop raycast after hitting enemy
            }
            
            // Simple hit feedback: Flash color
            // We need to clone material to not affect all objects sharing it
            if (obj.material) {
                // For this prototype, we just assume it's a MeshStandardMaterial or similar
                // and we modify it directly. If multiple objects share material, they all flash.
                // That's acceptable for a prototype.
                
                const mat = obj.material as THREE.MeshStandardMaterial;
                if (mat.color) {
                    const oldColor = mat.color.getHex();
                    mat.color.setHex(0xffa500); // Orange hit
                    mat.emissive.setHex(0xaa5500); // Glow
                    
                    setTimeout(() => {
                        mat.color.setHex(oldColor);
                        mat.emissive.setHex(0x000000);
                    }, 100);
                }
            }
            
            console.log('Hit:', obj);
            break; // Only hit the first object
        }
    }

    public dispose() {
        this.camera.remove(this.mesh);
        this.mesh.geometry.dispose();
        if (Array.isArray(this.mesh.material)) {
            this.mesh.material.forEach(m => m.dispose());
        } else {
            this.mesh.material.dispose();
        }
        
        this.flashMesh.geometry.dispose();
        (this.flashMesh.material as THREE.Material).dispose();
    }
}
