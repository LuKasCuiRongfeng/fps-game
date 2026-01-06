import * as THREE from 'three';
import { createTrunkMaterial, createLeavesMaterial } from './shaders/TreeTSL';
import { EnvironmentConfig, MapConfig } from './GameConfig';

/**
 * 树木系统 - 管理大量树木的生成和渲染
 * 使用 Chunk (分块) + InstancedMesh 进行性能优化
 */
export class TreeSystem {
    private scene: THREE.Scene;
    // 存储所有分块的列表
    private chunks: { trunk: THREE.InstancedMesh, leaves: THREE.InstancedMesh }[] = [];
    
    // 用于坐标转换的辅助对象
    private dummy = new THREE.Object3D();
    
    // 复用的几何体和材质
    private trunkGeometry: THREE.BufferGeometry;
    private leavesGeometry: THREE.BufferGeometry;
    private trunkMaterial: any;
    private leavesMaterial: any;

    constructor(scene: THREE.Scene, initialCount: number = 500) {
        this.scene = scene;
        
        // 1. 创建几何体
        this.leavesGeometry = this.createCombinedLeavesGeometry();
        
        const trunkConfig = EnvironmentConfig.trees.trunk;
        this.trunkGeometry = new THREE.CylinderGeometry(
            trunkConfig.radiusTop, 
            trunkConfig.radiusBottom, 
            trunkConfig.height, 
            trunkConfig.segments
        );
        this.trunkGeometry.translate(0, trunkConfig.height/2, 0); // 移动原点到底部
        
        // 2. 创建材质
        this.leavesMaterial = createLeavesMaterial();
        this.trunkMaterial = createTrunkMaterial();
    }

    /**
     * 生成并放置树木 (基于分块)
     * @param mapSize 地图大小
     * @param getHeightAt 获取指定坐标地形高度的回调函数
     * @param excludeAreas 需要排除的区域列表
     */
    public placeTrees(
        mapSize: number, 
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: Array<{x: number, z: number, radius: number}> = []
    ) {
        // 清理旧资源
        this.dispose();

        const chunkSize = MapConfig.chunkSize;
        const chunksPerRow = Math.ceil(mapSize / chunkSize);
        const halfSize = mapSize / 2;

        // 计算密度和每块的数量
        // 基础参考: 200x200 (40000m2) 地图约 1200 棵树 => 0.03 棵/m2
        // 大地图 800x800 => 需要 19200 棵
        // 为了平衡性能，我们稍微降低一点密度系数到 0.02
        const density = 0.02; 
        
        // 计算每块(Chunk)的目标树木数量
        const treesPerChunk = Math.floor((chunkSize * chunkSize) * density);
        
        console.log(`Generating Trees: Map=${mapSize}, Chunk=${chunkSize}, PerChunk=${treesPerChunk}, TotalChunks=${chunksPerRow*chunksPerRow}`);

        for (let x = 0; x < chunksPerRow; x++) {
            for (let z = 0; z < chunksPerRow; z++) {
                // 当前块中心的世​​界坐标
                const chunkCX = (x * chunkSize) - halfSize + (chunkSize / 2);
                const chunkCZ = (z * chunkSize) - halfSize + (chunkSize / 2);
                
                this.generateChunk(chunkCX, chunkCZ, chunkSize, treesPerChunk, getHeightAt, excludeAreas);
            }
        }
    }
    
    private generateChunk(
        cx: number, 
        cz: number, 
        size: number, 
        count: number, 
        getHeightAt: (x: number, z: number) => number, 
        excludeAreas: any[]
    ) {
        // 为该 Chunk 创建独立的 InstancedMesh
        const trunkMesh = new THREE.InstancedMesh(this.trunkGeometry, this.trunkMaterial, count);
        const leavesMesh = new THREE.InstancedMesh(this.leavesGeometry, this.leavesMaterial, count);
        
        trunkMesh.castShadow = true;
        trunkMesh.receiveShadow = true;
        leavesMesh.castShadow = true;
        leavesMesh.receiveShadow = true;
        
        let validCount = 0;
        
        for (let i = 0; i < count; i++) {
            // 在 Chunk 范围内随机生成
            const rx = (Math.random() - 0.5) * size;
            const rz = (Math.random() - 0.5) * size;
            
            const wx = cx + rx;
            const wz = cz + rz;
            
            // 检查排除区域
            let excluded = false;
            for (const area of excludeAreas) {
                const dx = wx - area.x;
                const dz = wz - area.z;
                if (dx * dx + dz * dz < area.radius * area.radius) {
                    excluded = true;
                    break;
                }
            }
            if (excluded) continue;

            const y = getHeightAt(wx, wz);
            
            // 避免水下生成
            const placeConfig = EnvironmentConfig.trees.placement;
            if (y < placeConfig.minAltitude) continue; 
            
            // 随机旋转和缩放
            const scale = placeConfig.scale.min + Math.random() * placeConfig.scale.range;
            const rotationY = Math.random() * Math.PI * 2;
            
            this.dummy.position.set(wx, y, wz);
            this.dummy.rotation.set(0, rotationY, 0);
            this.dummy.scale.set(scale, scale, scale);
            this.dummy.updateMatrix();
            
            trunkMesh.setMatrixAt(validCount, this.dummy.matrix);
            leavesMesh.setMatrixAt(validCount, this.dummy.matrix);
            
            validCount++;
        }
        
        // 只添加有树木的 Chunk
        if (validCount > 0) {
            trunkMesh.count = validCount;
            leavesMesh.count = validCount;
            
            trunkMesh.instanceMatrix.needsUpdate = true;
            leavesMesh.instanceMatrix.needsUpdate = true;
            
            // 重要：计算边界球以确保 Frustum Culling 工作正常
            trunkMesh.computeBoundingSphere();
            leavesMesh.computeBoundingSphere();
            
            this.scene.add(trunkMesh);
            this.scene.add(leavesMesh);
            
            this.chunks.push({ trunk: trunkMesh, leaves: leavesMesh });
        } else {
            // 空块
            trunkMesh.dispose();
            leavesMesh.dispose();
        }
    }
    
    public dispose() {
        this.chunks.forEach(c => {
            this.scene.remove(c.trunk);
            this.scene.remove(c.leaves);
            c.trunk.dispose();
            c.leaves.dispose();
        });
        this.chunks = [];
    }

    /**
     * 创建合并的树叶几何体 (多个圆锥体叠加)
     */
    private createCombinedLeavesGeometry(): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        
        // 底部大叶子
        const cone1 = new THREE.ConeGeometry(2.5, 3, 6);
        cone1.translate(0, 3.5, 0);
        geometries.push(cone1);
        
        // 中部叶子
        const cone2 = new THREE.ConeGeometry(2.0, 2.5, 6);
        cone2.translate(0, 5, 0);
        geometries.push(cone2);
        
        // 顶部小叶子
        const cone3 = new THREE.ConeGeometry(1.2, 2, 6);
        cone3.translate(0, 6.5, 0);
        geometries.push(cone3);
        
        return this.mergeGeometries(geometries);
    }
    
    /**
     * 简单的几何体合并工具
     */
    private mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        
        let vertexOffset = 0;
        
        geometries.forEach(geo => {
            const posAttr = geo.attributes.position;
            const normAttr = geo.attributes.normal;
            const uvAttr = geo.attributes.uv;
            const indexAttr = geo.index;
            
            for (let i = 0; i < posAttr.count; i++) {
                positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
                uvs.push(uvAttr.getX(i), uvAttr.getY(i));
            }
            
            if (indexAttr) {
                for (let i = 0; i < indexAttr.count; i++) {
                    indices.push(indexAttr.getX(i) + vertexOffset);
                }
            } else {
                 for (let i = 0; i < posAttr.count; i++) {
                    indices.push(i + vertexOffset);
                }
            }
            
            vertexOffset += posAttr.count;
        });
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        
        return geometry;
    }
}
