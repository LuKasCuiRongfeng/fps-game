import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu'; // 注意：Vite 环境下可能是 three/webgpu
import { 
    color, uniform, time, sin, cos, vec3, float, 
    mix, positionLocal, normalLocal, uv, floor,
    positionWorld, hash, modelWorldMatrix
} from 'three/tsl';

// 定义风的参数
const windSpeed = uniform(1.5);
const windStrength = uniform(0.1);

/**
 * 创建树干材质 (TSL)
 */
export function createTrunkMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();
    
    // 基础颜色 - 深褐色/灰色
    const baseColor = vec3(0.35, 0.25, 0.15);
    const variation = hash(positionWorld.xz).mul(0.1); // 基于位置的颜色微调
    
    // 简单的树皮纹理噪声
    const uvCoord = uv();
    const barkNoise = sin(uvCoord.y.mul(20.0).add(sin(uvCoord.x.mul(10.0)))).mul(0.1);
    
    material.colorNode = baseColor.add(variation).add(barkNoise);
    material.roughnessNode = float(0.9);
    material.metalnessNode = float(0.0);
    
    // 树干底部固定，顶部轻微摆动 (如果是很高的树)
    // 根据高度 (y) 进行偏移
    const heightFactor = positionLocal.y.max(0.0);
    const worldPos = positionWorld;
    
    // 简单的风动
    const windOffset = sin(time.mul(windSpeed).add(worldPos.x.mul(0.5))).mul(windStrength).mul(0.2).mul(heightFactor);
    
    // 应用顶点偏移
    material.positionNode = positionLocal.add(vec3(windOffset, 0, 0));
    
    return material;
}

/**
 * 创建树叶材质 (TSL)
 * 包含风动效果
 */
export function createLeavesMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();
    
    // 基础颜色 - 各种绿色
    const color1 = vec3(0.1, 0.4, 0.1); // 深绿
    const color2 = vec3(0.3, 0.6, 0.2); // 浅绿
    
    // 基于世界坐标的随机颜色，让每棵树颜色不同
    const randomVal = hash(floor(positionWorld.xz.div(2.0))); 
    const treeColor = mix(color1, color2, randomVal);
    
    // 增加一点基于 UV 的渐变，模拟光照或叶子纹理
    const leafGradient = uv().y.mul(0.2);
    
    material.colorNode = treeColor.add(leafGradient);
    material.roughnessNode = float(0.8);
    // 树叶通常不反光
    
    // === 风动效果 ===
    // 树叶比树干动得更厉害
    const heightFactor = positionLocal.y.max(0.0); // 只有 Y > 0 的部分才动 (假设原点在底部)
    // TSL 中 modelWorldMatrix 可能不直接暴露 position，使用 positionWorld 替代 或分解矩阵
    // 对于 InstancedMesh，positionWorld 已经是世界坐标
    const worldPos = positionWorld; 
    
    // 多重正弦波模拟复杂的风
    const t = time.mul(windSpeed);
    
    // 主风向摆动 (X轴)
    const swayX = sin(t.add(worldPos.x.mul(0.3)).add(worldPos.z.mul(0.1)))
        .mul(windStrength)
        .mul(heightFactor.pow(1.5)); // 高度越高摆动越大
        
    // 侧向扰动 (Z轴)
    const swayZ = cos(t.mul(0.8).add(worldPos.z.mul(0.3)))
        .mul(windStrength).mul(0.5)
        .mul(heightFactor);
        
    // 树叶颤动 (高频噪声)
    const flutter = sin(t.mul(5.0).add(positionLocal.x).add(positionLocal.z))
        .mul(0.02)
        .mul(heightFactor);

    material.positionNode = positionLocal.add(vec3(swayX.add(flutter), 0, swayZ.add(flutter)));
    
    // 开启 Alpha Test (如果是模型贴图需要，但这里是几何体，暂不需要)
    // material.alphaTest = 0.5;
    
    return material;
}
