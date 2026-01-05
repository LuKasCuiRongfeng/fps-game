import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, uniform, mix, vec3 } from 'three/tsl';
import { SoundManager } from './SoundManager';
import { Pathfinding } from './Pathfinding';

export class Enemy {
    public mesh: THREE.Mesh;
    private speed: number = 3.0;
    private health: number = 100;
    public isDead: boolean = false;
    private hitStrength: any;
    
    // Pathfinding
    private currentPath: THREE.Vector3[] = [];
    private pathUpdateTimer: number = 0;
    private pathUpdateInterval: number = 0.5; // Update path every 0.5s

    constructor(position: THREE.Vector3) {
        // Simple red capsule for enemy
        const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
        
        // TSL Shader Logic
        this.hitStrength = uniform(0);
        
        const baseColor = color(0xff0000);
        const hitColor = color(0xffffff);
        
        // Mix between red and white based on hitStrength
        const finalColor = mix(baseColor, hitColor, this.hitStrength);
        
        // Create Node Material
        const material = new MeshStandardNodeMaterial({ 
            roughness: 0.5, 
            metalness: 0.2 
        });
        
        // Assign nodes
        material.colorNode = finalColor;
        // Add emission when hit (mix black and grey)
        material.emissiveNode = mix(vec3(0.0), vec3(0.5), this.hitStrength);

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        this.mesh.position.y = 1; // Stand on ground (height is 2 total: 1 cylinder + 2*0.5 radius)
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        
        // Add user data to identify this mesh as an enemy
        this.mesh.userData = { isEnemy: true, entity: this };
    }

    public update(playerPosition: THREE.Vector3, delta: number, obstacles: THREE.Object3D[], pathfinding: Pathfinding) {
        if (this.isDead) return;

        // Update path periodically
        this.pathUpdateTimer += delta;
        if (this.pathUpdateTimer >= this.pathUpdateInterval) {
            this.pathUpdateTimer = 0;
            // Only calculate path if player is far enough or not visible directly?
            // For now, always calculate
            this.currentPath = pathfinding.findPath(this.mesh.position, playerPosition);
        }

        let targetPos = playerPosition;
        
        // If we have a path, follow it
        if (this.currentPath.length > 0) {
            // Get next waypoint
            const nextPoint = this.currentPath[0];
            
            // Check if we reached it (ignore Y)
            const dist = new THREE.Vector2(this.mesh.position.x, this.mesh.position.z)
                .distanceTo(new THREE.Vector2(nextPoint.x, nextPoint.z));
                
            if (dist < 0.5) {
                // Reached waypoint, remove it
                this.currentPath.shift();
                if (this.currentPath.length > 0) {
                    targetPos = this.currentPath[0];
                }
            } else {
                targetPos = nextPoint;
            }
        }

        // Move towards targetPos
        const direction = new THREE.Vector3()
            .subVectors(targetPos, this.mesh.position);
        
        // Ignore Y difference for movement (stay on ground)
        direction.y = 0;
        direction.normalize();

        // Calculate potential new position
        const moveDistance = this.speed * delta;

        // Try moving along X axis
        const nextPosX = this.mesh.position.clone();
        nextPosX.x += direction.x * moveDistance;
        
        // Use skin width for movement checks (isGroundCheck = false)
        let collisionBox = this.checkCollisions(nextPosX, obstacles, false);
        if (!collisionBox) {
            this.mesh.position.x = nextPosX.x;
        } else {
            // Try to step up
            this.handleObstacle(collisionBox, direction.x * moveDistance, 0);
        }

        // Try moving along Z axis (using potentially updated X)
        const nextPosZ = this.mesh.position.clone();
        nextPosZ.z += direction.z * moveDistance;
        
        // Use skin width for movement checks (isGroundCheck = false)
        collisionBox = this.checkCollisions(nextPosZ, obstacles, false);
        if (!collisionBox) {
            this.mesh.position.z = nextPosZ.z;
        } else {
            // Try to step up
            this.handleObstacle(collisionBox, 0, direction.z * moveDistance);
        }

        // Apply gravity (simple)
        // Check if we are in air
        const groundCheckPos = this.mesh.position.clone();
        groundCheckPos.y -= 0.1; // Check slightly below feet
        
        // Use strict check for gravity (isGroundCheck = true)
        if (!this.checkCollisions(groundCheckPos, obstacles, true)) {
             // Fall
             this.mesh.position.y = Math.max(1, this.mesh.position.y - 9.8 * delta);
        }

        // Look at player (always look at player, or look at movement direction?)
        // Looking at player is scarier/better for FPS
        this.mesh.lookAt(playerPosition.x, this.mesh.position.y, playerPosition.z);
    }

    private handleObstacle(obstacleBox: THREE.Box3, dx: number, dz: number) {
        const enemyFeetY = this.mesh.position.y - 1;
        const obstacleTopY = obstacleBox.max.y;
        const stepHeight = obstacleTopY - enemyFeetY;

        // Allow stepping up if obstacle is reachable (up to 1.5m)
        // Also handle cases where we might be slightly below ground due to gravity/physics glitches
        // So we check if stepHeight is reasonable (e.g. < 2.0 to be safe)
        if (stepHeight > 0 && stepHeight <= 2.0) { 
             this.mesh.position.y = obstacleTopY + 1 + 0.01; 
             
             // Push slightly more forward to ensure we land ON the step, not on the edge
             // Normalize direction
             const len = Math.sqrt(dx*dx + dz*dz);
             if (len > 0.0001) {
                 const scale = 0.3 / len; // Push 0.3m extra (increased from 0.2)
                 this.mesh.position.x += dx + (dx * scale);
                 this.mesh.position.z += dz + (dz * scale);
             } else {
                 this.mesh.position.x += dx;
                 this.mesh.position.z += dz;
             }
        }
    }

    private checkCollisions(position: THREE.Vector3, obstacles: THREE.Object3D[], isGroundCheck: boolean = false): THREE.Box3 | null {
        const enemyRadius = 0.5; // From CapsuleGeometry(0.5, 1, ...)
        
        const enemyBox = new THREE.Box3();
        // Mesh pivot is at center of capsule? 
        // CapsuleGeometry(radius, length) -> length is the cylinder part.
        // Total height = length + 2*radius.
        // If mesh.position.y = 1, and total height is 2, then it sits on y=0.
        // Center is at y=1.
        
        // If isGroundCheck is true, we want strict collision at the bottom (no skin width)
        // If isGroundCheck is false (movement), we lift the box slightly to slide over ground
        const skinWidth = isGroundCheck ? 0.0 : 0.1;

        enemyBox.min.set(position.x - enemyRadius, position.y - 1 + skinWidth, position.z - enemyRadius); 
        enemyBox.max.set(position.x + enemyRadius, position.y + 1, position.z + enemyRadius);

        for (const object of obstacles) {
            // Skip ground if it's in the objects list (it shouldn't be usually, but good to be safe)
            if (object.userData.isGround) continue;
            if (object.userData.isWayPoint) continue; // Skip waypoints

            const objectBox = new THREE.Box3().setFromObject(object);
            if (enemyBox.intersectsBox(objectBox)) {
                return objectBox;
            }
        }
        return null;
    }

    public takeDamage(amount: number) {
        if (this.isDead) return;

        this.health -= amount;
        
        // Flash effect via uniform
        this.hitStrength.value = 1;
        
        setTimeout(() => {
            if (!this.isDead) {
                this.hitStrength.value = 0;
            }
        }, 100);

        if (this.health <= 0) {
            this.die();
        }
    }

    private die() {
        this.isDead = true;
        this.mesh.visible = false;
        SoundManager.getInstance().playEnemyDeath();
        // Clean up material resources if needed, though GC handles most
        (this.mesh.material as MeshStandardNodeMaterial).dispose();
    }
}
