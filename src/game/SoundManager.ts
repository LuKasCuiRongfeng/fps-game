import { SoundConfig } from './GameConfig';

export class SoundManager {
    private static instance: SoundManager;
    private audioContext: AudioContext;
    private masterGain: GainNode;
    
    // 天气音效
    private weatherGain: GainNode | null = null;
    private weatherNodes: (OscillatorNode | AudioBufferSourceNode)[] = [];
    private currentWeatherSound: string | null = null;
    private weatherCleanupId: number = 0;  // 用于标识清理操作
    
    // 背景音乐系统 (Procedural Generators)
    private bgmGain: GainNode;
    private bgmNodes: OscillatorNode[] = [];
    private currentBGMState: 'none' | 'sunny' | 'rainy' | 'combat' = 'none';
    private bgmIntervalId: number = 0;

    private constructor() {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = SoundConfig.masterVolume; // Master volume
        this.masterGain.connect(this.audioContext.destination);
        
        // 独立的 BGM 音量控制
        this.bgmGain = this.audioContext.createGain();
        this.bgmGain.gain.value = SoundConfig.bgmVolume; // BGM Volume
        this.bgmGain.connect(this.masterGain);
    }

    public static getInstance(): SoundManager {
        if (!SoundManager.instance) {
            SoundManager.instance = new SoundManager();
        }
        return SoundManager.instance;
    }

    /**
     * 设置背景音乐状态
     */
    public setBGMState(state: 'sunny' | 'rainy' | 'combat') {
        if (this.currentBGMState === state) return;
        
        console.log(`BGM State Switch: ${this.currentBGMState} -> ${state}`);
        this.currentBGMState = state;
        
        // 停止之前的生成器
        if (this.bgmIntervalId) {
            window.clearInterval(this.bgmIntervalId);
            this.bgmIntervalId = 0;
        }
        
        // 停止之前的音频节点 (淡出)
        const oldNodes = [...this.bgmNodes];
        this.bgmNodes = [];
        
        const now = this.audioContext.currentTime;
        oldNodes.forEach(node => {
            try {
                // 如果节点直接连接了 gain，需要找到那个 gain 进行淡出
                // 这里简化处理: node 直接停止或让他自然结束
                // 更好的做法是每个音符自带 Envelope，这里我们不管旧音符，让它自己播放完 (Reverb-like)
                // 除非是长时间的 Drone，需要强行淡出
                // 由于我们下面的生成器主要产生短音符或长 Drone，长 Drone 需要手动停止
                if ((node as any).stopWait) {
                     node.stop(now + 2);
                }
            } catch (e) {}
        });

        // 启动新的生成器
        this.resume();
        switch (state) {
            case 'sunny':
                this.startSunnyBGM();
                break;
            case 'rainy':
                this.startRainyBGM();
                break;
            case 'combat':
                this.startCombatBGM();
                break;
        }
    }

    // 辅助: 播放一个带有包络的音符 (ADSR)
    private playNote(freq: number, type: OscillatorType, duration: number, vol: number = 0.5, attack: number = 0.1, release: number = 0.5) {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        const now = this.audioContext.currentTime;

        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(vol, now + attack);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration + release);

        osc.connect(gain);
        gain.connect(this.bgmGain);

        osc.start(now);
        osc.stop(now + duration + release);
        
        return osc;
    }

    /**
     * 晴天音乐: 欢快、轻松、Major Scale
     * 风格: Ambient / Light Pluck
     */
    private startSunnyBGM() {
        const config = SoundConfig.bgm.sunny;
        const majorScale = config.scale; // C Major
        
        // 1. 底层 Drone (长音垫) - 温暖的正弦波
        const playDrone = () => {
             // 防止 AudioContext 挂起时堆积太多 Oscillator
             if (this.audioContext.state === 'suspended') return;
             
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const now = this.audioContext.currentTime;
            
            osc.frequency.setValueAtTime(config.drone.freq, now); // C3
            osc.type = 'sine';
            
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(config.drone.volume, now + 2); 
            gain.gain.setValueAtTime(config.drone.volume, now + config.drone.duration - 2);
            gain.gain.linearRampToValueAtTime(0, now + config.drone.duration);
            
            osc.connect(gain);
            gain.connect(this.bgmGain);
            
            osc.start(now);
            osc.stop(now + config.drone.duration);
            (osc as any).stopWait = true;
            this.bgmNodes.push(osc);
        };
        
        // 2. 随机旋律 (Arpeggio)
        const playMelody = () => {
            if (this.audioContext.state === 'suspended') return;
            
            if (Math.random() > (1 - config.melody.probability)) {
                const note = majorScale[Math.floor(Math.random() * majorScale.length)];
                // 偶尔高八度
                const pitch = Math.random() > 0.8 ? note * 2 : note;
                this.playNote(pitch, 'triangle', 0.5, config.melody.volume, 0.05, 1.0); 
            }
        };

        // 初始播放
        playDrone();
        
        // 循环逻辑
        let tick = 0;
        this.bgmIntervalId = window.setInterval(() => {
            tick++;
            if (tick % config.interval.droneTick === 0) playDrone(); 
            if (tick % config.interval.melodyTick === 0) playMelody(); 
        }, config.interval.loop);
    }

    /**
     * 雨天音乐: 忧郁、缓慢、Minor Scale
     * 风格: Sad Piano / Pad
     */
    private startRainyBGM() {
         const config = SoundConfig.bgm.rainy;
         const minorScale = config.scale; // A Minor
         
         // 1. 深沉 Drone
         const playDarkPad = () => {
             if (this.audioContext.state === 'suspended') return;
             
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const now = this.audioContext.currentTime;
            
            osc.frequency.setValueAtTime(config.drone.freq, now); // A2
            osc.type = 'triangle'; // 稍微粗糙一点
            
            // 低通滤波器让声音变闷
            const filter = this.audioContext.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = config.drone.filterFreq;
            
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(config.drone.volume, now + 3); 
            gain.gain.setValueAtTime(config.drone.volume, now + config.drone.duration - 3);
            gain.gain.linearRampToValueAtTime(0, now + config.drone.duration);
            
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.bgmGain);
            
            osc.start(now);
            osc.stop(now + config.drone.duration);
            (osc as any).stopWait = true;
            this.bgmNodes.push(osc);
        };
        
        // 2. 也是旋律，但更稀疏，更慢
        const playSadNote = () => {
            if (this.audioContext.state === 'suspended') return;
            
             if (Math.random() > (1 - config.melody.probability)) { // > 0.6
                const note = minorScale[Math.floor(Math.random() * minorScale.length)];
                // 使用 Sine 模拟类似 Rhodes/Piano 的柔和感
                this.playNote(note, 'sine', 1.5, config.melody.volume, 0.1, 2.0); 
            }
        };

        playDarkPad();
        
        let tick = 0;
        this.bgmIntervalId = window.setInterval(() => {
            tick++;
            if (tick % config.interval.droneTick === 0) playDarkPad();
            if (tick % config.interval.melodyTick === 0) playSadNote();
        }, config.interval.loop);
    }

    /**
     * 战斗音乐: 紧张、快速、不协和
     * 风格: Ostinato / Bass Pulse
     */
    private startCombatBGM() {
        const config = SoundConfig.bgm.combat;

        // 1. 紧张的 Bass Pulse (类似心跳或急促的低音)
        const playBassPulse = () => {
             if (this.audioContext.state === 'suspended') return;

             const osc = this.audioContext.createOscillator();
             const gain = this.audioContext.createGain();
             const now = this.audioContext.currentTime;
             
             osc.frequency.setValueAtTime(config.bass.freq, now); // A1
             osc.type = 'sawtooth';
             
             // 低通滤波，随着时间打开 (Filter Sweep)
             const filter = this.audioContext.createBiquadFilter();
             filter.type = 'lowpass';
             filter.frequency.setValueAtTime(config.bass.filterStart, now);
             filter.frequency.linearRampToValueAtTime(config.bass.filterEnd, now + 0.1);
             
             gain.gain.setValueAtTime(config.bass.volume, now); 
             gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
             
             osc.connect(filter);
             filter.connect(gain);
             gain.connect(this.bgmGain);
             
             osc.start(now);
             osc.stop(now + 0.2);
        };
        
        // 2. 高频不协和音 (警报感)
        const playAlarm = () => {
             if (this.audioContext.state === 'suspended') return;

             if (Math.random() > (1 - config.alarm.probability)) return;
             
             const osc = this.audioContext.createOscillator();
             const gain = this.audioContext.createGain();
             const now = this.audioContext.currentTime;
             
             // 两个靠的很近的频率产生 "Beat" (拍频)，制造听觉不适/紧张感
             const freq = Math.random() > 0.5 ? config.alarm.freq1 : config.alarm.freq2; 
             osc.frequency.setValueAtTime(freq, now);
             osc.frequency.linearRampToValueAtTime(freq - 10, now + 0.5); // Pitch bend down
             
             osc.type = 'square';
             
             gain.gain.setValueAtTime(config.alarm.volume, now); 
             gain.gain.linearRampToValueAtTime(0, now + 0.5);
             
             osc.connect(gain);
             gain.connect(this.bgmGain);
             
             osc.start(now);
             osc.stop(now + 0.5);
        };

        // 快速循环 (每 250ms = 240 BPM 1/4拍)
        this.bgmIntervalId = window.setInterval(() => {
            playBassPulse();
            if (Math.random() > 0.5) playAlarm(); // Use internal random for beat placement
        }, config.interval);
    }

    // Ensure AudioContext is resumed (browsers block auto-play)
    public async resume() {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            
            // 如果恢复成功，且当前有 BGM 状态，重启 BGM 以便立即听到声音
            // 否则可能会因为 'suspended' check 跳过初始播放，导致长达数秒的静音
            // 使用 type assertion 绕过 TS 的静态分析 (因为 await 改变了状态)
            if ((this.audioContext.state as AudioContextState) === 'running' && this.currentBGMState !== 'none') {
                const savedState = this.currentBGMState;
                this.currentBGMState = 'none'; // 强制状态重置
                this.setBGMState(savedState);
            }
        }
    }

    private playTone(freq: number, type: OscillatorType, duration: number, startTime: number = 0, vol: number = 1) {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.audioContext.currentTime + startTime);

        gain.gain.setValueAtTime(vol, this.audioContext.currentTime + startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + startTime + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(this.audioContext.currentTime + startTime);
        osc.stop(this.audioContext.currentTime + startTime + duration);
    }

    private lastShootTime: number = 0;
    private readonly SHOOT_THROTTLE: number = SoundConfig.weapon.shoot.throttle; // ms

    public playShoot() {
        const now = Date.now();
        if (now - this.lastShootTime < this.SHOOT_THROTTLE) {
            return;
        }
        this.lastShootTime = now;

        this.resume();
        // Pew pew sound
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(800, this.audioContext.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, this.audioContext.currentTime + 0.1);

        gain.gain.setValueAtTime(SoundConfig.weapon.shoot.volume, this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.audioContext.currentTime + 0.1);
    }
    
    /**
     * 播放狙击枪射击声 - 更有震慑力
     */
    public playSniperShoot() {
        this.resume();
        
        // 主爆发音 - 极其低沉有力
        const osc1 = this.audioContext.createOscillator();
        const gain1 = this.audioContext.createGain();
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(120, this.audioContext.currentTime);
        osc1.frequency.exponentialRampToValueAtTime(25, this.audioContext.currentTime + 0.5);
        gain1.gain.setValueAtTime(1.5, this.audioContext.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);
        osc1.connect(gain1);
        gain1.connect(this.masterGain);
        osc1.start();
        osc1.stop(this.audioContext.currentTime + 0.5);
        
        // 高频冲击音 - 尖锐的枪击声
        const osc2 = this.audioContext.createOscillator();
        const gain2 = this.audioContext.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(1500, this.audioContext.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(150, this.audioContext.currentTime + 0.12);
        gain2.gain.setValueAtTime(1.2, this.audioContext.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.12);
        osc2.connect(gain2);
        gain2.connect(this.masterGain);
        osc2.start();
        osc2.stop(this.audioContext.currentTime + 0.12);
        
        // 超低频震撼 - 身体能感受到的低音
        const osc3 = this.audioContext.createOscillator();
        const gain3 = this.audioContext.createGain();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(45, this.audioContext.currentTime);
        osc3.frequency.exponentialRampToValueAtTime(20, this.audioContext.currentTime + 0.7);
        gain3.gain.setValueAtTime(1.5, this.audioContext.currentTime);
        gain3.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.7);
        osc3.connect(gain3);
        gain3.connect(this.masterGain);
        osc3.start();
        osc3.stop(this.audioContext.currentTime + 0.7);
        
        // 中频爆破音
        const osc4 = this.audioContext.createOscillator();
        const gain4 = this.audioContext.createGain();
        osc4.type = 'sawtooth';
        osc4.frequency.setValueAtTime(300, this.audioContext.currentTime);
        osc4.frequency.exponentialRampToValueAtTime(80, this.audioContext.currentTime + 0.25);
        gain4.gain.setValueAtTime(1.0, this.audioContext.currentTime);
        gain4.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.25);
        osc4.connect(gain4);
        gain4.connect(this.masterGain);
        osc4.start();
        osc4.stop(this.audioContext.currentTime + 0.25);
        
        // 回响余音 - 远处的回声
        const osc5 = this.audioContext.createOscillator();
        const gain5 = this.audioContext.createGain();
        osc5.type = 'sine';
        osc5.frequency.setValueAtTime(80, this.audioContext.currentTime + 0.08);
        osc5.frequency.exponentialRampToValueAtTime(35, this.audioContext.currentTime + 1.0);
        gain5.gain.setValueAtTime(0, this.audioContext.currentTime);
        gain5.gain.linearRampToValueAtTime(0.6, this.audioContext.currentTime + 0.08);
        gain5.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 1.0);
        osc5.connect(gain5);
        gain5.connect(this.masterGain);
        osc5.start();
        osc5.stop(this.audioContext.currentTime + 1.0);
        
        // 噪声层 - 模拟爆炸气流
        const bufferSize = this.audioContext.sampleRate * 0.3;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const noise = this.audioContext.createBufferSource();
        noise.buffer = noiseBuffer;
        const noiseGain = this.audioContext.createGain();
        noiseGain.gain.setValueAtTime(0.8, this.audioContext.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
        const noiseFilter = this.audioContext.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.value = 2000;
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.masterGain);
        noise.start();
    }

    public playHit() {
        this.resume();
        // Short high pitch ping
        this.playTone(1200, 'sine', 0.05, 0, 0.5);
    }

    public playJump() {
        this.resume();
        // Rising pitch
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, this.audioContext.currentTime);
        osc.frequency.linearRampToValueAtTime(400, this.audioContext.currentTime + 0.2);

        gain.gain.setValueAtTime(0.5, this.audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.audioContext.currentTime + 0.2);
    }

    public playEnemyDeath() {
        this.resume();
        // Explosion-ish noise (simulated with low freq saw/square)
        this.playTone(100, 'sawtooth', 0.3, 0, 0.8);
        this.playTone(80, 'square', 0.3, 0.05, 0.8);
    }

    public playDamage() {
        this.resume();
        // Low thud
        this.playTone(150, 'sawtooth', 0.1, 0, 0.8);
    }

    public playPickup() {
        this.resume();
        // High happy chime
        this.playTone(1000, 'sine', 0.1, 0, 0.3);
        this.playTone(1500, 'sine', 0.2, 0.05, 0.3);
    }
    
    public playHitImpact() {
        this.resume();
        // Short impact sound
        this.playTone(200, 'square', 0.05, 0, 0.3);
    }
    
    public playExplosion() {
        this.resume();
        // Explosion sound - layered low frequency rumble
        
        // Main boom
        const osc1 = this.audioContext.createOscillator();
        const gain1 = this.audioContext.createGain();
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(100, this.audioContext.currentTime);
        osc1.frequency.exponentialRampToValueAtTime(30, this.audioContext.currentTime + 0.5);
        gain1.gain.setValueAtTime(1.0, this.audioContext.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);
        osc1.connect(gain1);
        gain1.connect(this.masterGain);
        osc1.start();
        osc1.stop(this.audioContext.currentTime + 0.5);
        
        // Secondary crack
        const osc2 = this.audioContext.createOscillator();
        const gain2 = this.audioContext.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(200, this.audioContext.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(50, this.audioContext.currentTime + 0.3);
        gain2.gain.setValueAtTime(0.8, this.audioContext.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
        osc2.connect(gain2);
        gain2.connect(this.masterGain);
        osc2.start();
        osc2.stop(this.audioContext.currentTime + 0.3);
        
        // High frequency crack
        this.playTone(800, 'sawtooth', 0.08, 0, 0.5);
        this.playTone(400, 'square', 0.15, 0.02, 0.4);
    }
    
    public playWeaponSwitch() {
        this.resume();
        // Click sound for weapon switch
        this.playTone(600, 'sine', 0.03, 0, 0.2);
        this.playTone(800, 'sine', 0.03, 0.02, 0.2);
    }
    
    public playGrenadeThrow() {
        this.resume();
        // Whoosh sound
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, this.audioContext.currentTime);
        osc.frequency.linearRampToValueAtTime(100, this.audioContext.currentTime + 0.2);
        
        gain.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);
        
        osc.connect(gain);
        gain.connect(this.masterGain);
        
        osc.start();
        osc.stop(this.audioContext.currentTime + 0.2);
    }
    
    /**
     * 播放天气环境音效
     */
    public playWeatherSound(weather: 'sunny' | 'rainy' | 'windy' | 'sandstorm') {
        this.resume();
        
        // 如果是同一个天气音效，不重复播放
        if (this.currentWeatherSound === weather) return;
        
        // 停止当前天气音效
        this.stopWeatherSound();
        
        this.currentWeatherSound = weather;
        
        // 晴天没有特殊音效
        if (weather === 'sunny') return;
        
        // 创建天气音效增益节点
        this.weatherGain = this.audioContext.createGain();
        this.weatherGain.gain.setValueAtTime(0, this.audioContext.currentTime);
        this.weatherGain.gain.linearRampToValueAtTime(0.5, this.audioContext.currentTime + 1);
        this.weatherGain.connect(this.masterGain);
        
        if (weather === 'rainy') {
            this.createRainSound();
        } else if (weather === 'windy') {
            this.createWindSound();
        } else if (weather === 'sandstorm') {
            this.createSandstormSound();
        }
    }
    
    /**
     * 停止天气音效
     */
    public stopWeatherSound() {
        this.currentWeatherSound = null;  // 立即设置，阻止新的循环音效
        
        // 保存当前要清理的节点引用
        const nodesToClean = [...this.weatherNodes];
        const gainToClean = this.weatherGain;
        
        // 清空当前数组，为新音效腾出空间
        this.weatherNodes = [];
        this.weatherGain = null;
        
        if (gainToClean) {
            // 渐出
            gainToClean.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 1);
        }
        
        // 延迟停止旧节点
        setTimeout(() => {
            for (const node of nodesToClean) {
                try {
                    node.stop();
                    node.disconnect();
                } catch (e) {
                    // 忽略已停止的节点
                }
            }
            if (gainToClean) {
                gainToClean.disconnect();
            }
        }, 1100);
    }
    
    /**
     * 创建雨声 - 使用白噪声模拟
     */
    private createRainSound() {
        if (!this.weatherGain) return;
        
        // 创建白噪声缓冲区
        const bufferSize = 2 * this.audioContext.sampleRate;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        // 创建噪声源
        const whiteNoise = this.audioContext.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        
        // 滤波器 - 让雨声更自然
        const lowpass = this.audioContext.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 3000;
        
        const highpass = this.audioContext.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 500;
        
        // 连接节点
        whiteNoise.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(this.weatherGain);
        
        whiteNoise.start();
        this.weatherNodes.push(whiteNoise);
        
        // 添加雨滴滴答声
        this.addRainDrops();
    }
    
    /**
     * 添加雨滴滴答声效果
     */
    private addRainDrops() {
        if (!this.weatherGain || this.currentWeatherSound !== 'rainy') return;
        
        // 随机播放更多雨滴声
        const dropCount = 5 + Math.floor(Math.random() * 5);
        for (let i = 0; i < dropCount; i++) {
            setTimeout(() => {
                if (!this.weatherGain || this.currentWeatherSound !== 'rainy') return;
                
                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                
                osc.type = 'sine';
                const freq = 1500 + Math.random() * 3000;
                osc.frequency.setValueAtTime(freq, this.audioContext.currentTime);
                osc.frequency.exponentialRampToValueAtTime(freq * 0.3, this.audioContext.currentTime + 0.08);
                
                gain.gain.setValueAtTime(0.08, this.audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.08);
                
                osc.connect(gain);
                gain.connect(this.weatherGain!);
                
                osc.start();
                osc.stop(this.audioContext.currentTime + 0.08);
            }, Math.random() * 300);
        }
        
        // 更频繁地循环播放雨滴声
        setTimeout(() => this.addRainDrops(), 100 + Math.random() * 200);
    }
    
    /**
     * 创建风声
     */
    private createWindSound() {
        if (!this.weatherGain) return;
        
        // 使用低频振荡器调制噪声来模拟风声
        const bufferSize = 2 * this.audioContext.sampleRate;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        const whiteNoise = this.audioContext.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        
        // 带通滤波器让风声更自然
        const bandpass = this.audioContext.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 400;
        bandpass.Q.value = 0.5;
        
        // LFO 调制音量模拟阵风 - 更强烈
        const lfo = this.audioContext.createOscillator();
        const lfoGain = this.audioContext.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.4; // 更快的阵风
        lfoGain.gain.value = 0.5;
        
        const modulatedGain = this.audioContext.createGain();
        modulatedGain.gain.value = 1.2;
        
        lfo.connect(lfoGain);
        lfoGain.connect(modulatedGain.gain);
        
        whiteNoise.connect(bandpass);
        bandpass.connect(modulatedGain);
        modulatedGain.connect(this.weatherGain);
        
        whiteNoise.start();
        lfo.start();
        
        this.weatherNodes.push(whiteNoise, lfo);
        
        // 添加呼啸声
        this.addWindWhistle();
    }
    
    /**
     * 添加风的呼啸声
     */
    private addWindWhistle() {
        if (!this.weatherGain || this.currentWeatherSound !== 'windy') return;
        
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc.type = 'sine';
        const baseFreq = 250 + Math.random() * 300;
        osc.frequency.setValueAtTime(baseFreq, this.audioContext.currentTime);
        osc.frequency.linearRampToValueAtTime(baseFreq * 2.0, this.audioContext.currentTime + 0.8);
        osc.frequency.linearRampToValueAtTime(baseFreq * 0.5, this.audioContext.currentTime + 1.8);
        
        gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(0.12, this.audioContext.currentTime + 0.3);
        gain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 1.8);
        
        osc.connect(gain);
        gain.connect(this.weatherGain!);
        
        osc.start();
        osc.stop(this.audioContext.currentTime + 1.8);
        
        // 更频繁地添加呼啸声
        setTimeout(() => this.addWindWhistle(), 800 + Math.random() * 1500);
    }
    
    /**
     * 创建沙尘暴声音
     */
    private createSandstormSound() {
        if (!this.weatherGain) return;
        
        // 沙尘暴 = 强风 + 沙粒摩擦声
        const bufferSize = 2 * this.audioContext.sampleRate;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        // 更粗糙的噪声模拟沙粒
        for (let i = 0; i < bufferSize; i++) {
            output[i] = (Math.random() * 2 - 1) * (0.5 + Math.random() * 0.5);
        }
        
        const whiteNoise = this.audioContext.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        
        // 滤波器
        const lowpass = this.audioContext.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 2000;
        
        const highpass = this.audioContext.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 200;
        
        // 更强烈的 LFO 调制
        const lfo = this.audioContext.createOscillator();
        const lfoGain = this.audioContext.createGain();
        lfo.type = 'triangle';
        lfo.frequency.value = 0.5;
        lfoGain.gain.value = 0.6;
        
        const modulatedGain = this.audioContext.createGain();
        modulatedGain.gain.value = 1.5;
        
        lfo.connect(lfoGain);
        lfoGain.connect(modulatedGain.gain);
        
        whiteNoise.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(modulatedGain);
        modulatedGain.connect(this.weatherGain);
        
        whiteNoise.start();
        lfo.start();
        
        this.weatherNodes.push(whiteNoise, lfo);
        
        // 添加低频隆隆声
        this.addSandRumble();
    }
    
    /**
     * 添加沙尘暴的低频隆隆声
     */
    private addSandRumble() {
        if (!this.weatherGain || this.currentWeatherSound !== 'sandstorm') return;
        
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(40 + Math.random() * 40, this.audioContext.currentTime);
        
        gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(0.2, this.audioContext.currentTime + 0.3);
        gain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 1.2);
        
        osc.connect(gain);
        gain.connect(this.weatherGain!);
        
        osc.start();
        osc.stop(this.audioContext.currentTime + 1.2);
        
        // 更频繁的隆隆声
        setTimeout(() => this.addSandRumble(), 600 + Math.random() * 1000);
    }
}
