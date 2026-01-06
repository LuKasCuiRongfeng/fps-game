import * as THREE from 'three';
import { MapConfig } from './GameConfig';

/**
 * 物理系统 - 使用空间划分 (Spatial Partitioning) 优化碰撞检测
 * 使用 Grid (网格) 索引静态物体，避免 O(N) 遍历
 */
export class PhysicsSystem {
    private static instance: PhysicsSystem;
    
    // 网格大小 (米)
    // 玩家移动速度约 6m/s ~ 12m/s
    // 10m 的网格比较合适，每次查询周围 3x3 个网格
    private cellSize: number = 20; 
    
    // 空间哈希表: Key = "x_z", Value = colliders list
    private grid: Map<string, Array<{ box: THREE.Box3, object: THREE.Object3D }>> = new Map();
    
    // 所有的静态碰撞体 (备用)
    private staticColliders: Array<{ box: THREE.Box3, object: THREE.Object3D }> = [];

    constructor() {
        // Singleton or Instance per Level
    }

    /**
     * 添加静态碰撞体
     * 会计算包围盒并添加到对应的网格中
     */
    public addStaticObject(object: THREE.Object3D) {
        // 计算精确的世界坐标包围盒
        const box = new THREE.Box3().setFromObject(object);
        
        // 如果包围盒无效，跳过
        if (box.isEmpty()) return;
        
        const entry = { box, object };
        this.staticColliders.push(entry);
        
        // 将物体添加到覆盖的所有网格中
        const minX = Math.floor(box.min.x / this.cellSize);
        const maxX = Math.floor(box.max.x / this.cellSize);
        const minZ = Math.floor(box.min.z / this.cellSize);
        const maxZ = Math.floor(box.max.z / this.cellSize);
        
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const key = `${x}_${z}`;
                if (!this.grid.has(key)) {
                    this.grid.set(key, []);
                }
                this.grid.get(key)!.push(entry);
            }
        }
    }
    
    /**
     * 获取指定区域附近的碰撞体
     * @param position 中心位置
     * @param radius 查询半径
     */
    public getNearbyObjects(position: THREE.Vector3, radius: number = 2.0): Array<{ box: THREE.Box3, object: THREE.Object3D }> {
        // 计算查询范围覆盖的网格
        const minX = Math.floor((position.x - radius) / this.cellSize);
        const maxX = Math.floor((position.x + radius) / this.cellSize);
        const minZ = Math.floor((position.z - radius) / this.cellSize);
        const maxZ = Math.floor((position.z + radius) / this.cellSize);
        
        const result: Array<{ box: THREE.Box3, object: THREE.Object3D }> = [];
        const processed = new Set<THREE.Object3D>(); // 防止由于跨网格导致的重复
        
        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const key = `${x}_${z}`;
                const cellObjects = this.grid.get(key);
                if (cellObjects) {
                    for (const entry of cellObjects) {
                        if (!processed.has(entry.object)) {
                            // 简单的距离裁剪 (可选，Box3 Intersects Box3 已经很快了)
                            // 这里我们直接返回所有候选者，交给调用者做精确的 AABB 测试
                            result.push(entry);
                            processed.add(entry.object);
                        }
                    }
                }
            }
        }
        
        return result;
    }
    
    /**
     * 清理
     */
    public clear() {
        this.grid.clear();
        this.staticColliders = [];
    }
}
