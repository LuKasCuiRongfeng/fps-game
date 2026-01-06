这个项目的目标是开发一款第一人称 FPS 游戏

技术：前端 src 目录下，react，tailwindcss，渲染使用three.js，TSL 写shader，后端 src-tauri目录下，使用rust

文件结构：游戏代码放在 src/game 目录下，请注意文件良好的划分

rust：如果项目需要用到后端的能力，请用rust在 src-tauri/src目录下编写

要求：尽可能的用 TSL 写shader，能用shader的地方就尽量用，能用gpu加速的地方就尽量写compute shader，做到好的性能

服务：对于项目中如果依赖服务的数据，通过项目的server目录下 node index.js启动一个本地服务