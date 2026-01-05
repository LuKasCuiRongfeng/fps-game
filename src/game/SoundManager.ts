export class SoundManager {
    private static instance: SoundManager;
    private audioContext: AudioContext;
    private masterGain: GainNode;

    private constructor() {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.3; // Master volume
        this.masterGain.connect(this.audioContext.destination);
    }

    public static getInstance(): SoundManager {
        if (!SoundManager.instance) {
            SoundManager.instance = new SoundManager();
        }
        return SoundManager.instance;
    }

    // Ensure AudioContext is resumed (browsers block auto-play)
    public async resume() {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
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

    public playShoot() {
        this.resume();
        // Pew pew sound
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(800, this.audioContext.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, this.audioContext.currentTime + 0.1);

        gain.gain.setValueAtTime(0.5, this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.audioContext.currentTime + 0.1);
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
}
