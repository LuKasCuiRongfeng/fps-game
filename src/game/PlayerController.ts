import * as THREE from 'three';
import { Weapon } from './Weapon';
import { SoundManager } from './SoundManager';

export class PlayerController {
    private domElement: HTMLElement;
    private camera: THREE.Camera;
    private weapon: Weapon;
    private scene: THREE.Scene;
    
    // Movement state
    private moveForward: boolean = false;
    private moveBackward: boolean = false;
    private moveLeft: boolean = false;
    private moveRight: boolean = false;
    private canJump: boolean = false;
    private isLocked: boolean = false;
    private isRunning: boolean = false;

    private velocity: THREE.Vector3 = new THREE.Vector3();
    private direction: THREE.Vector3 = new THREE.Vector3();

    // Look state
    private pitch: number = 0;
    private yaw: number = 0;
    private targetPitch: number = 0;
    private targetYaw: number = 0;
    
    // Settings
    private readonly sensitivity: number = 0.002;
    private readonly smoothFactor: number = 0.15; // Lower = smoother
    private readonly walkSpeed: number = 60.0; 
    private readonly runSpeed: number = 120.0;
    private readonly friction: number = 10.0;
    private readonly jumpHeight: number = 10.0; 
    private readonly gravity: number = 30.0;
    
    private defaultY: number = 1.6;
    
    // Smoothing
    private visualYOffset: number = 0;

    private objects: THREE.Object3D[] = [];

    constructor(camera: THREE.Camera, domElement: HTMLElement, scene: THREE.Scene, objects: THREE.Object3D[]) {
        this.domElement = domElement;
        this.camera = camera;
        this.scene = scene;
        this.objects = objects;
        
        // Initialize angles from current camera rotation
        const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        this.pitch = euler.x;
        this.yaw = euler.y;
        this.targetPitch = this.pitch;
        this.targetYaw = this.yaw;

        this.weapon = new Weapon(camera);

        this.initInputListeners();
        this.initPointerLock();
    }

    private initPointerLock() {
        this.domElement.addEventListener('click', () => {
            if (!this.isLocked) {
                this.domElement.requestPointerLock();
            } else {
                this.weapon.shoot(this.scene);
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === this.domElement;
        });

        document.addEventListener('mousemove', (event) => {
            if (!this.isLocked) return;

            const movementX = event.movementX || 0;
            const movementY = event.movementY || 0;

            this.targetYaw -= movementX * this.sensitivity;
            this.targetPitch -= movementY * this.sensitivity;

            // Clamp pitch
            this.targetPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.targetPitch));
        });
    }

    private initInputListeners() {
        const onKeyDown = (event: KeyboardEvent) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    this.moveForward = true;
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    this.moveLeft = true;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.moveBackward = true;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    this.moveRight = true;
                    break;
                case 'Space':
                    if (this.canJump === true) {
                        this.velocity.y += this.jumpHeight;
                        this.canJump = false;
                        SoundManager.getInstance().playJump();
                    }
                    break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.isRunning = true;
                    break;
            }
        };

        const onKeyUp = (event: KeyboardEvent) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    this.moveForward = false;
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    this.moveLeft = false;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.moveBackward = false;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    this.moveRight = false;
                    break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.isRunning = false;
                    break;
            }
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
    }

    public update(delta: number) {
        if (this.isLocked === true) {
            // Restore physics position (remove visual offset from previous frame)
            this.camera.position.y -= this.visualYOffset;

            // 1. Smooth Look
            // Interpolate current angles towards target angles
            // Using a simple lerp factor adjusted by delta for frame-rate independence
            // const smooth = 1.0 - Math.pow(0.001, delta); // High damping
            // Or simpler:
            const t = 1.0 - Math.pow(1.0 - this.smoothFactor, delta * 60); 
            
            this.yaw += (this.targetYaw - this.yaw) * t;
            this.pitch += (this.targetPitch - this.pitch) * t;

            this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

            // 2. Movement Physics
            // Friction / Damping
            this.velocity.x -= this.velocity.x * this.friction * delta;
            this.velocity.z -= this.velocity.z * this.friction * delta;
            this.velocity.y -= this.gravity * delta; // Gravity

            this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
            this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
            this.direction.normalize();

            const currentSpeed = this.isRunning ? this.runSpeed : this.walkSpeed;

            if (this.moveForward || this.moveBackward) this.velocity.z -= this.direction.z * currentSpeed * delta;
            if (this.moveLeft || this.moveRight) this.velocity.x -= this.direction.x * currentSpeed * delta;

            // Calculate world space velocity vector
            // We want movement to be strictly horizontal (XZ plane), independent of camera pitch
            // Get forward vector (projected to XZ plane)
            const forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            forward.y = 0;
            forward.normalize();

            // Get right vector
            const right = new THREE.Vector3();
            right.crossVectors(forward, this.camera.up);
            right.normalize();

            const forwardSpeed = -this.velocity.z * delta;
            const rightSpeed = -this.velocity.x * delta;

            // X axis movement (World Space)
            const dx = (forward.x * forwardSpeed) + (right.x * rightSpeed);
            this.camera.position.x += dx;
            let collisionBox = this.checkCollisions(true); // Use skinWidth for horizontal
            if (collisionBox) {
                this.camera.position.x -= dx;
                this.handleObstacle(collisionBox, dx, 0);
            }

            // Z axis movement (World Space)
            const dz = (forward.z * forwardSpeed) + (right.z * rightSpeed);
            this.camera.position.z += dz;
            collisionBox = this.checkCollisions(true); // Use skinWidth for horizontal
            if (collisionBox) {
                this.camera.position.z -= dz;
                this.handleObstacle(collisionBox, 0, dz);
            }

            // Y axis movement (Gravity / Jump)
            const previousY = this.camera.position.y;
            this.camera.position.y += (this.velocity.y * delta);

            const collisionBoxY = this.checkCollisions(false); // Strict check for vertical
            if (collisionBoxY) {
                 if (this.velocity.y < 0) {
                     // Falling down
                     // Check if we were above the object (landing)
                     const previousFeetY = previousY - 1.6;
                     // Tolerance of 0.1m to handle fast falling or slight penetration
                     if (previousFeetY >= collisionBoxY.max.y - 0.1) {
                         this.canJump = true;
                         this.velocity.y = 0;
                         // Snap to top
                         this.camera.position.y = collisionBoxY.max.y + 1.6;
                     } else {
                         // Hit side or bottom while falling? Revert.
                         this.camera.position.y = previousY;
                         this.velocity.y = 0;
                     }
                 } 
                 else if (this.velocity.y > 0) {
                     // Jumping up and hit ceiling
                     this.velocity.y = 0;
                     this.camera.position.y = previousY;
                 }
            }

            // Simple ground floor check (fallback)
            if (this.camera.position.y < this.defaultY) {
                this.velocity.y = 0;
                this.camera.position.y = this.defaultY;
                this.canJump = true;
            }

            // Smooth camera Y
            // Decay the offset
            this.visualYOffset = THREE.MathUtils.lerp(this.visualYOffset, 0, delta * 15);
            if (Math.abs(this.visualYOffset) < 0.001) this.visualYOffset = 0;
            
            // Apply offset for rendering
            this.camera.position.y += this.visualYOffset;
        }
    }

    private handleObstacle(obstacleBox: THREE.Box3, dx: number, dz: number) {
        // Only attempt to step up if we are moving
        if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;

        const playerFeetY = this.camera.position.y - 1.6;
        const obstacleTopY = obstacleBox.max.y;
        const stepHeight = obstacleTopY - playerFeetY;

        // Allow stepping up if obstacle is not too high (e.g. 1.0 unit)
        // And we must be somewhat below the top (otherwise we are already above it)
        if (stepHeight > 0 && stepHeight <= 1.0) {
            // Check if there is space at the new position (on top of obstacle)
            const originalY = this.camera.position.y;
            const originalX = this.camera.position.x;
            const originalZ = this.camera.position.z;

            // Try to move up and forward
            this.camera.position.y = obstacleTopY + 1.6 + 0.01; // Slightly above
            this.camera.position.x += dx;
            this.camera.position.z += dz;

            // Use strict check here to ensure we are not colliding with anything else
            // But wait, if we are standing on it, strict check might fail if we are too close?
            // We added 0.01, so strict check should be fine (feet at max.y + 0.01 > max.y)
            if (!this.checkCollisions(false)) {
                // Success! We can step up.
                // Keep the new position.
                
                // Smooth the transition: visual position lags behind physics position
                this.visualYOffset -= (this.camera.position.y - originalY);

                // Also reset vertical velocity so we don't keep flying up or down immediately
                this.velocity.y = 0;
                this.canJump = true;
            } else {
                // Failed, revert
                this.camera.position.y = originalY;
                this.camera.position.x = originalX;
                this.camera.position.z = originalZ;
            }
        }
    }

    private checkCollisions(useSkinWidth: boolean = false): THREE.Box3 | null {
        const playerBox = new THREE.Box3();
        const position = this.camera.position;
        
        // Define player bounding box (approximate size: 0.6 width, 1.8 height)
        // Camera is at 1.6 height, so feet are at y = 0 (approx)
        const radius = 0.3;
        const height = 1.8;
        
        // We assume the player is standing on the ground (y=0) when camera is at y=1.6
        // So the box bottom is at position.y - 1.6
        
        // IMPORTANT: When moving horizontally (useSkinWidth = true), we reduce the box height slightly 
        // from the bottom to allow "sliding" on top of surfaces without detecting the surface we are standing on as a collision.
        const skinWidth = useSkinWidth ? 0.05 : 0.0;

        playerBox.min.set(position.x - radius, position.y - 1.6 + skinWidth, position.z - radius);
        playerBox.max.set(position.x + radius, position.y - 1.6 + height, position.z + radius);

        for (const object of this.objects) {
            const objectBox = new THREE.Box3().setFromObject(object);
            if (playerBox.intersectsBox(objectBox)) {
                return objectBox;
            }
        }
        return null;
    }

    public unlock() {
        document.exitPointerLock();
    }

    public dispose() {
        this.weapon.dispose();
        document.exitPointerLock();
        // Remove listeners...
    }
}
