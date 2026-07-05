import { useEffect, useRef, useState } from 'react';
import { LogOut, RotateCw, Play, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ===================== CONSTANTS =====================
const GAME_W = 800;
const GAME_H = 600;

interface Player {
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
  color: string;
}

interface Bullet {
  x: number;
  y: number;
  h: number;
  vy: number;
  color: string;
}

interface Enemy {
  x: number;
  y: number;
  w: number;
  h: number;
  type: number; // 1, 2, or 3
  alive: boolean;
  frame: number;
}

interface Barrier {
  x: number;
  y: number;
  w: number;
  h: number;
  alive: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface UFO {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  dir: number;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const starsCanvasRef = useRef<HTMLCanvasElement>(null);
  const gameCanvasRef = useRef<HTMLCanvasElement>(null);

  // Game States
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover' | 'confirmExit'>('menu');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    try {
      const saved = localStorage.getItem('space_invaders_highscore');
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  });
  const [level, setLevel] = useState(1);
  const [lives, setLives] = useState(3);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isPortrait, setIsPortrait] = useState(false);

  // Audio Context Ref
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Keyboard and Input Refs to avoid state delay in game loops
  const keysRef = useRef({
    left: false,
    right: false,
    fire: false,
  });

  // Game Entities Refs
  const playerRef = useRef<Player>({
    x: GAME_W / 2,
    y: GAME_H - 60,
    w: 40,
    h: 24,
    speed: 6,
    color: '#39FF14'
  });

  const bulletsRef = useRef<Bullet[]>([]);
  const enemyBulletsRef = useRef<Bullet[]>([]);
  const enemiesRef = useRef<Enemy[]>([]);
  const barriersRef = useRef<Barrier[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const ufoRef = useRef<UFO | null>(null);

  // Timers and Toggles
  const ufoTimerRef = useRef(0);
  const lastFireTimeRef = useRef(0);
  const enemyDirRef = useRef(1);
  const enemySpeedRef = useRef(0.35);
  const enemyFireTimerRef = useRef(0);
  const frameToggleRef = useRef(0);

  // Initialize Audio
  const initAudio = () => {
    if (!audioCtxRef.current) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AudioCtx();
      } catch (e) {
        console.error('Web Audio not supported', e);
      }
    }
    // Resume context if suspended
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  };

  const beep = (freq: number, dur: number, type: OscillatorType = 'square', vol = 0.05) => {
    if (!soundEnabled) return;
    initAudio();
    if (!audioCtxRef.current) return;

    try {
      const osc = audioCtxRef.current.createOscillator();
      const gain = audioCtxRef.current.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, audioCtxRef.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtxRef.current.currentTime + dur);
      osc.connect(gain);
      gain.connect(audioCtxRef.current.destination);
      osc.start();
      osc.stop(audioCtxRef.current.currentTime + dur);
    } catch (e) {
      // Ignore audio glitches
    }
  };

  // ===================== ENTITIES CREATION =====================
  const createEnemies = () => {
    const arr: Enemy[] = [];
    const startX = 80;
    const startY = 85;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 11; c++) {
        let type = 1;
        if (r === 0) type = 3;
        else if (r < 3) type = 2;
        arr.push({
          x: startX + c * 45,
          y: startY + r * 34,
          w: 30,
          h: 22,
          type: type,
          alive: true,
          frame: 0
        });
      }
    }
    enemiesRef.current = arr;
  };

  const createBarriers = () => {
    const arr: Barrier[] = [];
    const positions = [120, 280, 440, 600];
    positions.forEach(px => {
      const rows = 4;
      const cols = 6;
      const bw = 10;
      const bh = 10;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Formato de arco: remove cantos superiores e abertura central inferior
          if (r === 0 && (c === 0 || c === cols - 1)) continue;
          if (r === 3 && (c === 2 || c === 3)) continue;
          arr.push({
            x: px - 30 + c * bw,
            y: GAME_H - 140 + r * bh,
            w: bw,
            h: bh,
            alive: true
          });
        }
      }
    });
    barriersRef.current = arr;
  };

  const resetLevel = (nextLevel: number) => {
    bulletsRef.current = [];
    enemyBulletsRef.current = [];
    particlesRef.current = [];
    ufoRef.current = null;
    ufoTimerRef.current = 0;
    createEnemies();
    createBarriers();
    playerRef.current.x = GAME_W / 2;
    enemySpeedRef.current = 0.35 + (nextLevel - 1) * 0.12;
    enemyDirRef.current = 1;
  };

  // ===================== PARTICLES SYSTEM =====================
  const spawnParticles = (x: number, y: number, color: string, count = 10) => {
    const arr = [...particlesRef.current];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 3.5;
      arr.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 25 + Math.random() * 20,
        maxLife: 45,
        color,
        size: 2 + Math.random() * 3
      });
    }
    particlesRef.current = arr;
  };

  // ===================== STARS RENDERING =====================
  const drawStars = () => {
    const canvas = starsCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw 90 stars
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const r = Math.random() * 1.5;
      const alpha = 0.25 + Math.random() * 0.75;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // ===================== DRAWING FUNCTIONS =====================
  const drawPlayer = (ctx: CanvasRenderingContext2D) => {
    const p = playerRef.current;
    ctx.save();
    ctx.shadowBlur = 15;
    ctx.shadowColor = p.color;
    ctx.fillStyle = p.color;
    // Tank base
    ctx.fillRect(p.x - p.w / 2, p.y, p.w, p.h / 2);
    // Upper turret
    ctx.fillRect(p.x - p.w / 2 + 5, p.y - 6, p.w - 10, 6);
    // Gun barrel
    ctx.fillRect(p.x - 3, p.y - 12, 6, 6);
    ctx.restore();
  };

  const drawEnemy = (ctx: CanvasRenderingContext2D, e: Enemy) => {
    if (!e.alive) return;
    ctx.save();
    ctx.shadowBlur = 10;
    let color = '#ff00ff';
    if (e.type === 1) color = '#00ff00';
    else if (e.type === 2) color = '#ffff00';
    ctx.shadowColor = color;
    ctx.fillStyle = color;

    const x = e.x, y = e.y, w = e.w, f = e.frame;

    if (e.type === 1) {
      // Octopod/Squid style
      ctx.fillRect(x + 6, y, w - 12, 4);
      ctx.fillRect(x + 2, y + 4, w - 4, 4);
      ctx.fillRect(x, y + 8, w, 4);
      ctx.fillRect(x + 2, y + 12, 4, 4);
      ctx.fillRect(x + w - 6, y + 12, 4, 4);
      if (f === 0) {
        ctx.fillRect(x, y + 16, 4, 4);
        ctx.fillRect(x + w - 4, y + 16, 4, 4);
      } else {
        ctx.fillRect(x + 4, y + 16, 4, 4);
        ctx.fillRect(x + w - 8, y + 16, 4, 4);
      }
    } else if (e.type === 2) {
      // Crab style
      ctx.fillRect(x + 4, y, w - 8, 4);
      ctx.fillRect(x, y + 4, w, 4);
      ctx.fillRect(x, y + 8, w, 4);
      ctx.fillRect(x + 4, y + 12, 4, 4);
      ctx.fillRect(x + w - 8, y + 12, 4, 4);
      if (f === 0) {
        ctx.fillRect(x, y + 12, 4, 4);
        ctx.fillRect(x + w - 4, y + 12, 4, 4);
      } else {
        ctx.fillRect(x + 2, y + 16, 4, 4);
        ctx.fillRect(x + w - 6, y + 16, 4, 4);
      }
    } else {
      // Jelly style
      ctx.fillRect(x + 8, y, w - 16, 4);
      ctx.fillRect(x + 4, y + 4, w - 8, 4);
      ctx.fillRect(x, y + 8, w, 4);
      ctx.fillRect(x + 2, y + 12, w - 4, 4);
      if (f === 0) {
        ctx.fillRect(x, y + 16, 4, 4);
        ctx.fillRect(x + w - 4, y + 16, 4, 4);
      } else {
        ctx.fillRect(x + 6, y + 16, 4, 4);
        ctx.fillRect(x + w - 10, y + 16, 4, 4);
      }
    }
    ctx.restore();
  };

  const drawUFO = (ctx: CanvasRenderingContext2D) => {
    const ufo = ufoRef.current;
    if (!ufo) return;
    ctx.save();
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#ff3333';
    ctx.fillStyle = '#ff3333';
    ctx.fillRect(ufo.x + 10, ufo.y, 20, 4);
    ctx.fillRect(ufo.x, ufo.y + 4, 40, 4);
    ctx.fillRect(ufo.x + 4, ufo.y + 8, 32, 4);
    ctx.fillRect(ufo.x + 8, ufo.y + 12, 24, 4);
    ctx.restore();
  };

  const drawBullet = (ctx: CanvasRenderingContext2D, b: Bullet) => {
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = b.color;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x - 2, b.y, 4, b.h);
    ctx.restore();
  };

  const drawParticles = (ctx: CanvasRenderingContext2D) => {
    particlesRef.current.forEach(p => {
      const alpha = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
      ctx.restore();
    });
  };

  // ===================== UPDATE LOGIC =====================
  const updateGame = () => {
    if (gameState !== 'playing') return;

    const keys = keysRef.current;
    const player = playerRef.current;

    // 1. Move Player
    if (keys.left && player.x > player.w / 2 + 10) {
      player.x -= player.speed;
    }
    if (keys.right && player.x < GAME_W - player.w / 2 - 10) {
      player.x += player.speed;
    }

    // 2. Player Firing
    if (keys.fire) {
      const now = Date.now();
      if (now - lastFireTimeRef.current > 280) {
        bulletsRef.current.push({
          x: player.x,
          y: player.y - 12,
          h: 12,
          vy: -8.5,
          color: '#00ffff'
        });
        lastFireTimeRef.current = now;
        beep(880, 0.08, 'square', 0.02);
      }
    }

    // 3. Update Player Bullets
    bulletsRef.current.forEach(b => {
      b.y += b.vy;
    });
    // Filter out off-screen player bullets
    bulletsRef.current = bulletsRef.current.filter(b => b.y > -20);

    // 4. Update Enemy Bullets
    enemyBulletsRef.current.forEach(b => {
      b.y += b.vy;
    });
    enemyBulletsRef.current = enemyBulletsRef.current.filter(b => b.y < GAME_H + 20);

    // 5. Update Enemy Animations (Frames)
    frameToggleRef.current++;
    if (frameToggleRef.current % 24 === 0) {
      enemiesRef.current.forEach(e => {
        if (e.alive) e.frame = 1 - e.frame;
      });
    }

    // 6. Enemy Wave Movement
    const aliveEnemies = enemiesRef.current.filter(e => e.alive);
    if (aliveEnemies.length === 0) {
      // Clear level and advance
      const nextLevel = level + 1;
      setLevel(nextLevel);
      setScore(prev => prev + 500); // Level clear bonus!
      beep(523.25, 0.15, 'square', 0.04);
      setTimeout(() => beep(659.25, 0.15, 'square', 0.04), 150);
      setTimeout(() => beep(783.99, 0.25, 'square', 0.04), 300);
      resetLevel(nextLevel);
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    aliveEnemies.forEach(e => {
      if (e.x < minX) minX = e.x;
      if (e.x + e.w > maxX) maxX = e.x + e.w;
      if (e.y + e.h > maxY) maxY = e.y + e.h;
    });

    let drop = false;
    // Speed increases as fewer enemies remain
    const speedMultiplier = 1 + (55 - aliveEnemies.length) * 0.024;
    const currentSpeed = enemySpeedRef.current * speedMultiplier;

    if (maxX > GAME_W - 20 && enemyDirRef.current > 0) {
      enemyDirRef.current = -1;
      drop = true;
    } else if (minX < 20 && enemyDirRef.current < 0) {
      enemyDirRef.current = 1;
      drop = true;
    }

    enemiesRef.current.forEach(e => {
      if (!e.alive) return;
      e.x += enemyDirRef.current * currentSpeed;
      if (drop) {
        e.y += 16;
      }
    });

    // Check if enemies reached the player or barrier zone limit
    if (maxY > GAME_H - 100) {
      handleGameOver();
      return;
    }

    // 7. Enemy Automatic Fire
    enemyFireTimerRef.current++;
    const fireInterval = Math.max(16, 52 - level * 4);
    if (enemyFireTimerRef.current > fireInterval) {
      enemyFireTimerRef.current = 0;
      // Group alive enemies by column to shoot from bottom-most row
      const columnsMap: { [key: number]: Enemy } = {};
      aliveEnemies.forEach(e => {
        const colKey = Math.round(e.x / 45);
        if (!columnsMap[colKey] || e.y > columnsMap[colKey].y) {
          columnsMap[colKey] = e;
        }
      });

      const potentialShooters = Object.values(columnsMap);
      if (potentialShooters.length > 0) {
        // Pick 1 or 2 shooters randomly depending on level difficulty
        const shots = level >= 3 ? 2 : 1;
        for (let s = 0; s < shots; s++) {
          const shooter = potentialShooters[Math.floor(Math.random() * potentialShooters.length)];
          enemyBulletsRef.current.push({
            x: shooter.x + shooter.w / 2,
            y: shooter.y + shooter.h,
            h: 12,
            vy: 3.8 + level * 0.25,
            color: '#ff00ff'
          });
        }
      }
    }

    // 8. UFO Logic
    ufoTimerRef.current++;
    if (!ufoRef.current && ufoTimerRef.current > 700 + Math.random() * 500) {
      ufoTimerRef.current = 0;
      const spawnLeft = Math.random() > 0.5;
      ufoRef.current = {
        x: spawnLeft ? -45 : GAME_W + 45,
        y: 45,
        w: 42,
        h: 18,
        vx: 2.2,
        dir: spawnLeft ? 1 : -1
      };
      beep(120, 0.1, 'sine', 0.05);
    }

    if (ufoRef.current) {
      const ufo = ufoRef.current;
      ufo.x += ufo.vx * ufo.dir;
      // Play a cyclic high pitching noise for UFO presence
      if (frameToggleRef.current % 15 === 0) {
        beep(587.33, 0.04, 'sine', 0.015);
      }
      if (ufo.x < -60 || ufo.x > GAME_W + 60) {
        ufoRef.current = null;
      }
    }

    // 9. Collision Detections
    // A. Player bullets vs Enemies, Barriers, UFO
    bulletsRef.current.forEach(b => {
      // vs Enemies
      for (let i = 0; i < enemiesRef.current.length; i++) {
        const e = enemiesRef.current[i];
        if (!e.alive) continue;
        if (b.x > e.x && b.x < e.x + e.w && b.y > e.y && b.y < e.y + e.h) {
          e.alive = false;
          b.y = -999; // mark to destroy
          let points = 10;
          if (e.type === 2) points = 20;
          if (e.type === 3) points = 30;

          setScore(prev => {
            const nextScore = prev + points;
            if (nextScore > highScore) {
              setHighScore(nextScore);
              localStorage.setItem('space_invaders_highscore', nextScore.toString());
            }
            return nextScore;
          });

          const particleColor = e.type === 3 ? '#ff00ff' : e.type === 2 ? '#ffff00' : '#39FF14';
          spawnParticles(e.x + e.w / 2, e.y + e.h / 2, particleColor, 12);
          beep(220, 0.12, 'sawtooth', 0.035);
          break;
        }
      }

      // vs UFO
      const ufo = ufoRef.current;
      if (ufo && b.x > ufo.x && b.x < ufo.x + ufo.w && b.y > ufo.y && b.y < ufo.y + ufo.h) {
        setScore(prev => {
          const nextScore = prev + 150;
          if (nextScore > highScore) {
            setHighScore(nextScore);
            localStorage.setItem('space_invaders_highscore', nextScore.toString());
          }
          return nextScore;
        });
        spawnParticles(ufo.x + ufo.w / 2, ufo.y + ufo.h / 2, '#ff3333', 22);
        beep(147, 0.35, 'sawtooth', 0.06);
        ufoRef.current = null;
        b.y = -999;
      }

      // vs Barriers
      for (let i = 0; i < barriersRef.current.length; i++) {
        const bar = barriersRef.current[i];
        if (!bar.alive) continue;
        if (b.x > bar.x && b.x < bar.x + bar.w && b.y > bar.y && b.y < bar.y + bar.h) {
          bar.alive = false;
          b.y = -999;
          spawnParticles(bar.x + bar.w / 2, bar.y + bar.h / 2, '#39FF14', 4);
          break;
        }
      }
    });

    // Clean marked player bullets
    bulletsRef.current = bulletsRef.current.filter(b => b.y !== -999);

    // B. Enemy bullets vs Player & Barriers
    enemyBulletsRef.current.forEach(b => {
      // vs Player
      if (
        b.x > player.x - player.w / 2 &&
        b.x < player.x + player.w / 2 &&
        b.y > player.y &&
        b.y < player.y + player.h
      ) {
        b.y = GAME_H + 999; // destroy bullet
        setLives(prev => {
          const nextLives = prev - 1;
          spawnParticles(player.x, player.y + player.h / 2, '#00ffff', 25);
          beep(82.4, 0.45, 'sawtooth', 0.08);

          if (nextLives <= 0) {
            handleGameOver();
          } else {
            // Reposition player
            player.x = GAME_W / 2;
          }
          return nextLives;
        });
        return;
      }

      // vs Barriers
      for (let i = 0; i < barriersRef.current.length; i++) {
        const bar = barriersRef.current[i];
        if (!bar.alive) continue;
        if (b.x > bar.x && b.x < bar.x + bar.w && b.y > bar.y && b.y < bar.y + bar.h) {
          bar.alive = false;
          b.y = GAME_H + 999;
          spawnParticles(bar.x + bar.w / 2, bar.y + bar.h / 2, '#39FF14', 4);
          break;
        }
      }
    });

    // Clean enemy bullets
    enemyBulletsRef.current = enemyBulletsRef.current.filter(b => b.y < GAME_H + 20);

    // C. Moving enemies eat barriers directly
    enemiesRef.current.forEach(e => {
      if (!e.alive) return;
      barriersRef.current.forEach(bar => {
        if (!bar.alive) return;
        if (
          e.x < bar.x + bar.w &&
          e.x + e.w > bar.x &&
          e.y < bar.y + bar.h &&
          e.y + e.h > bar.y
        ) {
          bar.alive = false;
        }
      });
    });

    // 10. Update Particles
    particlesRef.current.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
    });
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);
  };

  // ===================== GAME RENDER LOOP =====================
  const renderGame = () => {
    const canvas = gameCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear Screen
    ctx.clearRect(0, 0, GAME_W, GAME_H);

    // Ground line (Classic green line)
    ctx.save();
    ctx.strokeStyle = '#39FF14';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#39FF14';
    ctx.beginPath();
    ctx.moveTo(10, GAME_H - 40);
    ctx.lineTo(GAME_W - 10, GAME_H - 40);
    ctx.stroke();
    ctx.restore();

    // Draw Barriers
    barriersRef.current.forEach(b => {
      if (b.alive) {
        ctx.save();
        ctx.fillStyle = '#39FF14';
        ctx.shadowBlur = 6;
        ctx.shadowColor = '#39FF14';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.restore();
      }
    });

    // Draw Enemies
    enemiesRef.current.forEach(e => {
      drawEnemy(ctx, e);
    });

    // Draw UFO
    drawUFO(ctx);

    // Draw Player (If active)
    if (gameState === 'playing') {
      drawPlayer(ctx);
    }

    // Draw Bullets
    bulletsRef.current.forEach(b => drawBullet(ctx, b));
    enemyBulletsRef.current.forEach(b => drawBullet(ctx, b));

    // Draw Particles
    drawParticles(ctx);
  };

  const handleGameOver = () => {
    setGameState('gameover');
    beep(130.81, 0.25, 'sawtooth', 0.08);
    setTimeout(() => beep(110, 0.25, 'sawtooth', 0.08), 250);
    setTimeout(() => beep(82.41, 0.45, 'sawtooth', 0.08), 500);
  };

  // ===================== APP RESIZE HANDLING =====================
  const handleResize = () => {
    const container = containerRef.current;
    const mainContainer = mainRef.current;
    const gameCanvas = gameCanvasRef.current;
    const starsCanvas = starsCanvasRef.current;

    if (!container || !mainContainer || !gameCanvas || !starsCanvas) return;

    const cw = mainContainer.clientWidth;
    const ch = mainContainer.clientHeight;

    // Check device portrait mode to display landscape prompt
    const vcw = container.clientWidth;
    const vch = container.clientHeight;
    setIsPortrait(vch > vcw && vcw < 768);

    const ratio = GAME_W / GAME_H;
    let w = cw;
    let h = w / ratio;

    if (h > ch) {
      h = ch;
      w = h * ratio;
    }

    gameCanvas.style.width = `${w}px`;
    gameCanvas.style.height = `${h}px`;

    // Stars canvas takes the complete background screen
    starsCanvas.width = vcw;
    starsCanvas.height = vch;
    drawStars();
  };

  // ===================== INPUT HANDLERS =====================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;

      if (key === 'ArrowLeft' || key.toLowerCase() === 'a') {
        keysRef.current.left = true;
        if (gameState === 'playing') e.preventDefault();
      } else if (key === 'ArrowRight' || key.toLowerCase() === 'd') {
        keysRef.current.right = true;
        if (gameState === 'playing') e.preventDefault();
      } else if (key === ' ' || key === 'ArrowUp' || key.toLowerCase() === 'w') {
        keysRef.current.fire = true;
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key;
      if (key === 'ArrowLeft' || key.toLowerCase() === 'a') {
        keysRef.current.left = false;
      } else if (key === 'ArrowRight' || key.toLowerCase() === 'd') {
        keysRef.current.right = false;
      } else if (key === ' ' || key === 'ArrowUp' || key.toLowerCase() === 'w') {
        keysRef.current.fire = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('resize', handleResize);

    // Initial resize trigger
    handleResize();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', handleResize);
    };
  }, [gameState, level]);

  // Main Game Loop using requestAnimationFrame
  useEffect(() => {
    let animId: number;

    const loop = () => {
      updateGame();
      renderGame();
      animId = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [gameState, level]);

  // Setup stars canvas once at start
  useEffect(() => {
    handleResize();
    const interval = setInterval(drawStars, 8000); // re-twinkle stars occasionally
    return () => clearInterval(interval);
  }, []);

  // ===================== ACTIONS =====================
  const startNewGame = () => {
    initAudio();
    setScore(0);
    setLevel(1);
    setLives(3);
    resetLevel(1);

    // Reset controls
    keysRef.current = { left: false, right: false, fire: false };

    setGameState('playing');

    // Retro Game Start Beep Chord
    beep(440, 0.1, 'square', 0.04);
    setTimeout(() => beep(554.37, 0.1, 'square', 0.04), 100);
    setTimeout(() => beep(659.25, 0.15, 'square', 0.04), 200);
  };

  const handleExitRequest = () => {
    setGameState('confirmExit');
    beep(300, 0.15, 'sawtooth', 0.03);
  };

  const handleConfirmExit = () => {
    // Redireciona para o site principal solicitado
    window.location.href = 'https://www.matchin.com.br';
  };

  const handleCancelExit = () => {
    setGameState('playing');
    beep(500, 0.1, 'square', 0.03);
  };

  // Touch control helper handlers
  const handleTouchLeft = (active: boolean) => {
    keysRef.current.left = active;
    initAudio();
  };

  const handleTouchRight = (active: boolean) => {
    keysRef.current.right = active;
    initAudio();
  };

  const handleTouchFire = (active: boolean) => {
    keysRef.current.fire = active;
    initAudio();
  };

  return (
    <div
      ref={containerRef}
      id="gameContainer"
      className="relative w-screen h-screen flex flex-col items-center justify-between bg-[#050505] overflow-hidden select-none font-press-start border-2 sm:border-4 border-[#1A1A1A]"
    >
      {/* Subtle CRT Overlay Scanning Lines Layer */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.035] crt-overlay z-50" />

      {/* Stars Background Layer (Fills the entire screen) */}
      <canvas ref={starsCanvasRef} className="absolute inset-0 w-full h-full z-1 pointer-events-none" />

      {/* HEADER BAR (Classic Arcade Cabinet Header) */}
      <header className="hidden sm:flex w-full h-16 sm:h-20 bg-[#0A0A0A] border-b border-[#333] shadow-md flex items-center justify-between px-4 sm:px-8 relative z-40 select-none shrink-0">
        {/* Left Stats Section */}
        <div className="flex items-center space-x-4 sm:space-x-8 text-left">
          <div>
            <span className="text-[#666] text-[8px] sm:text-[10px] block uppercase tracking-widest">Score</span>
            <span className="text-xs sm:text-base font-bold text-[#39FF14] text-shadow-glow">
              {score.toString().padStart(6, '0')}
            </span>
          </div>
          <div>
            <span className="text-[#666] text-[8px] sm:text-[10px] block uppercase tracking-widest font-mono">Hi-Score</span>
            <span className="text-xs sm:text-base font-bold text-yellow-400">
              {highScore.toString().padStart(6, '0')}
            </span>
          </div>
        </div>

        {/* Central Brand Logo / Site Label */}
        <div className="text-center hidden md:block">
          <h1 className="text-xs sm:text-sm md:text-base font-black tracking-[0.3em] text-white opacity-85 italic uppercase">
            MATCHIN.COM.BR
          </h1>
        </div>

        {/* Right Stats & Action Controls */}
        <div className="flex items-center space-x-3 sm:space-x-6 text-right">
          <div className="flex items-center space-x-2">
            <span className="text-[#666] text-[8px] sm:text-[10px] uppercase tracking-widest hidden sm:block">Lives</span>
            <div className="flex space-x-1">
              {Array.from({ length: Math.max(0, lives) }).map((_, idx) => (
                <div
                  key={idx}
                  className="w-4 h-3 sm:w-5 sm:h-4 bg-[#39FF14] shadow-[0_0_8px_#39FF14] rounded-sm"
                  style={{ clipPath: 'polygon(50% 0%, 100% 50%, 100% 100%, 0% 100%, 0% 50%)' }}
                />
              ))}
              {lives <= 0 && <span className="text-red-500 text-[10px] font-bold">0</span>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle Sound */}
            <button
              onClick={() => {
                setSoundEnabled(prev => !prev);
                beep(600, 0.05, 'sine', 0.02);
              }}
              className="p-1.5 sm:p-2 rounded-full border border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:text-[#39FF14] hover:border-[#39FF14] active:scale-95 transition-all shadow-inner cursor-pointer"
              title="Alternar Áudio"
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
            </button>

            {/* EXIT Button matching the design precisely */}
            <button
              onClick={handleExitRequest}
              className="bg-[#CC0000] hover:bg-[#FF0000] text-white px-2.5 sm:px-4 py-1.5 rounded text-[8px] sm:text-[10px] font-bold transition-all border border-black shadow-[inset_0_1px_3px_rgba(255,255,255,0.4)] uppercase cursor-pointer flex items-center justify-center gap-1 active:scale-95"
              title="Sair do Jogo"
            >
              <LogOut className="w-3 h-3" />
              <span className="tracking-wider">Exit</span>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN GAME CONTAINER (Centered responsive wrapper) */}
      <main
        ref={mainRef}
        className="flex-grow w-full relative flex flex-col justify-center items-center px-4 overflow-hidden bg-radial from-[#050505] via-[#090909] to-[#020202]"
      >
        {/* Main Game Screen Canvas */}
        <canvas
          ref={gameCanvasRef}
          width={GAME_W}
          height={GAME_H}
          className="relative z-10 image-render-pixelated max-w-full max-h-full sm:max-h-[85%] border border-[#222] sm:border-2 sm:border-[#1A1A1A] shadow-[0_0_40px_rgba(57,255,20,0.15)] rounded bg-[#030303]"
        />

        {/* Small floating HUD helper on canvas header for compact viewports */}
        {gameState === 'playing' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 hidden sm:flex gap-4 select-none pointer-events-none bg-[#0a0a0a]/90 px-4 py-1.5 rounded-full border border-zinc-800 text-[9px] uppercase tracking-wider text-[#39FF14]">
            <span>Level: {level}</span>
          </div>
        )}
      </main>

      {/* MOBILE FULL-SCREEN HUD OVERLAY (Visible only on mobile/compact) */}
      {gameState === 'playing' && (
        <div className="sm:hidden absolute top-4 left-4 right-4 z-30 flex justify-between items-center select-none pointer-events-none">
          {/* Left stats: Score & Level */}
          <div className="flex gap-3 items-center bg-black/80 px-2.5 py-1 rounded border border-zinc-800 pointer-events-auto shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            <div className="flex flex-col">
              <span className="text-zinc-500 text-[7px] uppercase tracking-widest font-mono">Pts</span>
              <span className="text-[10px] font-bold text-[#39FF14] text-shadow-glow">
                {score.toString().padStart(6, '0')}
              </span>
            </div>
            <div className="flex flex-col border-l border-zinc-800 pl-3">
              <span className="text-zinc-500 text-[7px] uppercase tracking-widest font-mono">Lvl</span>
              <span className="text-[10px] font-bold text-yellow-400">
                {level}
              </span>
            </div>
          </div>

          {/* Center Lives display */}
          <div className="flex items-center gap-1 bg-black/80 px-2.5 py-1.5 rounded border border-zinc-800 pointer-events-auto shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            {Array.from({ length: Math.max(0, lives) }).map((_, idx) => (
              <div
                key={idx}
                className="w-3 h-2 bg-[#39FF14] shadow-[0_0_5px_#39FF14] rounded-sm"
                style={{ clipPath: 'polygon(50% 0%, 100% 50%, 100% 100%, 0% 100%, 0% 50%)' }}
              />
            ))}
            {lives <= 0 && <span className="text-red-500 text-[8px] font-bold">0</span>}
          </div>

          {/* Right Controls: Sound & Exit */}
          <div className="flex items-center gap-1.5 pointer-events-auto">
            {/* Toggle Sound */}
            <button
              onClick={() => {
                setSoundEnabled(prev => !prev);
                beep(600, 0.05, 'sine', 0.02);
              }}
              className="p-1.5 rounded-full border border-zinc-800 bg-black/80 text-zinc-400 hover:text-[#39FF14] cursor-pointer"
              title="Alternar Áudio"
            >
              {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            </button>

            {/* EXIT Button */}
            <button
              onClick={handleExitRequest}
              className="bg-[#CC0000] hover:bg-[#FF0000] text-white px-2 py-1 rounded text-[7px] font-bold border border-black shadow uppercase cursor-pointer"
            >
              Exit
            </button>
          </div>
        </div>
      )}

      {/* MOBILE TOUCH STEERING OVERLAYS (Visible only on mobile/compact) */}
      {gameState === 'playing' && (
        <div className="sm:hidden absolute bottom-4 left-4 right-4 z-30 flex justify-between items-end select-none pointer-events-none">
          {/* Left & Right Arrow Buttons */}
          <div className="flex gap-2 pointer-events-auto">
            <button
              onTouchStart={() => handleTouchLeft(true)}
              onTouchEnd={() => handleTouchLeft(false)}
              onMouseDown={() => handleTouchLeft(true)}
              onMouseUp={() => handleTouchLeft(false)}
              onMouseLeave={() => handleTouchLeft(false)}
              className="w-12 h-12 bg-black/80 border border-zinc-700 hover:border-[#39FF14] text-white active:bg-[#39FF14]/30 flex items-center justify-center text-lg font-bold rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.8)] cursor-pointer select-none touch-none"
            >
              ←
            </button>
            <button
              onTouchStart={() => handleTouchRight(true)}
              onTouchEnd={() => handleTouchRight(false)}
              onMouseDown={() => handleTouchRight(true)}
              onMouseUp={() => handleTouchRight(false)}
              onMouseLeave={() => handleTouchRight(false)}
              className="w-12 h-12 bg-black/80 border border-zinc-700 hover:border-[#39FF14] text-white active:bg-[#39FF14]/30 flex items-center justify-center text-lg font-bold rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.8)] cursor-pointer select-none touch-none"
            >
              →
            </button>
          </div>

          {/* Large Crimson Fire/Shoot Button */}
          <div className="pointer-events-auto">
            <button
              onTouchStart={() => handleTouchFire(true)}
              onTouchEnd={() => handleTouchFire(false)}
              onMouseDown={() => handleTouchFire(true)}
              onMouseUp={() => handleTouchFire(false)}
              onMouseLeave={() => handleTouchFire(false)}
              className="w-18 h-12 bg-[#CC0000] border-2 border-[#800000] text-white active:bg-[#ff0000] flex items-center justify-center text-[10px] font-black uppercase rounded-lg shadow-[0_2px_10px_rgba(204,0,0,0.6)] cursor-pointer select-none touch-none"
            >
              Shoot
            </button>
          </div>
        </div>
      )}

      {/* FOOTER CONTROLS BAR (Classic Retro Control Board Panel) */}
      <footer className="hidden sm:flex w-full h-20 sm:h-24 bg-[#0A0A0A] border-t border-[#333] px-4 sm:px-8 flex items-center justify-between relative z-40 shrink-0">
        
        {/* Left Directional Touch Pads */}
        <div className="flex space-x-3 sm:space-x-4">
          <button
            onTouchStart={() => handleTouchLeft(true)}
            onTouchEnd={() => handleTouchLeft(false)}
            onMouseDown={() => handleTouchLeft(true)}
            onMouseUp={() => handleTouchLeft(false)}
            onMouseLeave={() => handleTouchLeft(false)}
            className="w-12 h-12 sm:w-16 sm:h-16 bg-[#1A1A1A] border-2 border-[#444] rounded-full flex items-center justify-center text-xl sm:text-2xl text-[#39FF14] hover:bg-[#252525] hover:border-[#39FF14] hover:text-white active:bg-[#39FF14]/20 transition-all shadow-[0_2px_8px_rgba(0,0,0,0.8)] cursor-pointer select-none touch-none"
          >
            ←
          </button>
          <button
            onTouchStart={() => handleTouchRight(true)}
            onTouchEnd={() => handleTouchRight(false)}
            onMouseDown={() => handleTouchRight(true)}
            onMouseUp={() => handleTouchRight(false)}
            onMouseLeave={() => handleTouchRight(false)}
            className="w-12 h-12 sm:w-16 sm:h-16 bg-[#1A1A1A] border-2 border-[#444] rounded-full flex items-center justify-center text-xl sm:text-2xl text-[#39FF14] hover:bg-[#252525] hover:border-[#39FF14] hover:text-white active:bg-[#39FF14]/20 transition-all shadow-[0_2px_8px_rgba(0,0,0,0.8)] cursor-pointer select-none touch-none"
          >
            →
          </button>
        </div>

        {/* Center Retro Mode Display Card */}
        <div className="hidden md:block bg-[#111] px-5 py-2.5 border border-[#333] rounded text-[8px] sm:text-[9px] text-zinc-500 uppercase tracking-widest text-center shadow-inner">
          Desktop Mode: Space / W to Shoot | Mobile Mode: Landscape Controls
        </div>

        {/* Right Arcade Fire Button */}
        <div className="flex items-center">
          <button
            onTouchStart={() => handleTouchFire(true)}
            onTouchEnd={() => handleTouchFire(false)}
            onMouseDown={() => handleTouchFire(true)}
            onMouseUp={() => handleTouchFire(false)}
            onMouseLeave={() => handleTouchFire(false)}
            className="w-18 h-12 sm:w-24 sm:h-16 bg-[#CC0000] border-4 border-[#800000] rounded-lg text-white font-black text-xs sm:text-sm uppercase shadow-[0_4px_10px_rgba(204,0,0,0.4)] active:scale-95 active:bg-[#ff0000] transition-all cursor-pointer select-none touch-none flex items-center justify-center text-center"
          >
            Shoot
          </button>
        </div>
      </footer>

      {/* SCREEN OVERLAYS (Main Menu, Game Over, Exit Confirmation) */}
      <AnimatePresence mode="wait">
        {/* MAIN MENU */}
        {gameState === 'menu' && (
          <motion.div
            key="menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#050505]/95 p-6 text-center"
          >
            <motion.h1
              initial={{ scale: 0.85 }}
              animate={{ scale: [0.95, 1.05, 0.95] }}
              transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
              className="text-xl sm:text-4xl font-extrabold text-[#39FF14] drop-shadow-[0_0_15px_rgba(57,255,20,0.65)] mb-6 tracking-widest text-shadow-glow"
            >
              SPACE INVADERS
            </motion.h1>

            <p className="text-[10px] sm:text-xs text-zinc-400 max-w-[460px] leading-relaxed mb-6 font-mono">
              Defenda a Terra dos invasores alienígenas! Destrua todos os inimigos para avançar de nível.
            </p>

            {highScore > 0 && (
              <div className="mb-6 px-6 py-3 bg-[#39FF14]/5 rounded border border-[#39FF14]/20 shadow-inner">
                <span className="text-[8px] sm:text-[9px] text-zinc-500 block mb-1 tracking-widest uppercase">RECORDE ATUAL</span>
                <span className="text-xs sm:text-sm text-yellow-400 font-bold tracking-wider">{highScore} PTS</span>
              </div>
            )}

            <div className="text-[8px] sm:text-[9px] text-pink-500 space-y-2 leading-relaxed bg-[#111] border border-zinc-800 p-4 rounded max-w-sm mb-8 tracking-wide">
              <div>← → / A D para mover</div>
              <div>ESPAÇO / CLIQUE para atirar</div>
            </div>

            <button
              onClick={startNewGame}
              className="px-8 py-4 border-2 border-[#39FF14] text-[#39FF14] bg-transparent text-xs sm:text-sm font-bold shadow-[0_0_25px_rgba(57,255,20,0.45)] cursor-pointer hover:bg-[#39FF14]/10 active:scale-95 transition-all flex items-center gap-3 rounded tracking-wider"
            >
              <Play className="w-4 h-4 fill-[#39FF14]" />
              INICIAR JOGO
            </button>

            <span className="text-[8px] text-zinc-600 mt-6 block tracking-widest">
              WWW.MATCHIN.COM.BR
            </span>
          </motion.div>
        )}

        {/* GAME OVER SCREEN */}
        {gameState === 'gameover' && (
          <motion.div
            key="gameover"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#050505]/95 p-6 text-center"
          >
            <h1 className="text-2xl sm:text-5xl font-extrabold text-red-500 drop-shadow-[0_0_20px_red] mb-4 tracking-widest uppercase">
              GAME OVER
            </h1>

            <h2 className="text-[9px] sm:text-xs text-zinc-500 mb-2 uppercase tracking-widest">
              Pontuação Final
            </h2>
            <div className="text-xl sm:text-4xl text-[#39FF14] drop-shadow-[0_0_15px_rgba(57,255,20,0.5)] font-bold mb-4">
              {score}
            </div>

            <p className="text-[9px] sm:text-xs text-zinc-400 mb-8 font-mono">
              Você alcançou o Nível <span className="text-yellow-400 font-bold">{level}</span>
            </p>

            <button
              onClick={startNewGame}
              className="px-8 py-4 border-2 border-green-400 text-green-400 bg-transparent text-xs sm:text-sm font-bold shadow-[0_0_20px_rgba(74,222,128,0.5)] cursor-pointer hover:bg-green-400/10 active:scale-95 transition-all rounded tracking-wider"
            >
              JOGAR NOVAMENTE
            </button>
          </motion.div>
        )}

        {/* CONFIRM EXIT SCREEN */}
        {gameState === 'confirmExit' && (
          <motion.div
            key="confirmExit"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#050505]/98 p-6 text-center"
          >
            <h2 className="text-lg sm:text-2xl text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.4)] mb-4 uppercase tracking-wider">
              SAIR DO JOGO?
            </h2>
            <p className="text-[10px] sm:text-xs text-zinc-400 max-w-sm leading-relaxed mb-8">
              Deseja sair e voltar para a página da <span className="text-[#39FF14]">Matchin</span>? Seu progresso atual não será salvo.
            </p>

            <div className="flex gap-4">
              <button
                onClick={handleConfirmExit}
                className="px-6 py-3.5 border-2 border-red-500 text-red-500 bg-transparent text-[10px] font-bold shadow-[0_0_15px_rgba(239,68,68,0.4)] cursor-pointer hover:bg-red-500/10 active:scale-95 transition-all rounded tracking-wide uppercase"
              >
                SIM, SAIR
              </button>
              <button
                onClick={handleCancelExit}
                className="px-6 py-3.5 border-2 border-[#39FF14] text-[#39FF14] bg-transparent text-[10px] font-bold shadow-[0_0_15px_rgba(57,255,20,0.4)] cursor-pointer hover:bg-[#39FF14]/10 active:scale-95 transition-all rounded tracking-wide uppercase"
              >
                NÃO, VOLTAR
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PORTRAIT ORIENTATION WARNING (Locks game loop visibility until rotated) */}
      <AnimatePresence>
        {isPortrait && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#050505]/98 text-center p-6 text-white"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              className="text-[#39FF14] mb-6"
            >
              <RotateCw className="w-14 h-14" />
            </motion.div>
            <h2 className="text-sm text-[#39FF14] mb-3 uppercase tracking-wider drop-shadow-[0_0_10px_rgba(57,255,20,0.5)]">
              Gire o Aparelho
            </h2>
            <p className="text-[9px] text-zinc-500 max-w-xs leading-relaxed uppercase tracking-wider">
              Para jogar Space Invaders no celular, coloque seu smartphone deitado na horizontal.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
