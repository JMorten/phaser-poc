// Phaser 4.2.1 - POC Action RPG top-down
// Direcoes dos sprites Blender (render_v2.py: root.rotation_euler.z = 45*d, CCW visto de cima;
// frente do modelo = -Y local, camera em (0,-6.2,6.2) olhando para +Y):
//   dir0 = S (baixo), dir1 = SE, dir2 = E, dir3 = NE, dir4 = N, dir5 = NW, dir6 = W, dir7 = SW.
// Vetores: [x,y] em tela (y positivo para baixo)
const VEC = [
  [0, 1], [0.7071, 0.7071], [1, 0], [0.7071, -0.7071],
  [0, -1], [-0.7071, -0.7071], [-1, 0], [-0.7071, 0.7071]
];

// Converte angulo de tela atan2(y,x) (0 = leste, +PI/2 = sul) para o indice de sprite Blender.
// atan2 quartetiza na ordem E,SE,S,SW,W,NW,N,NE; a ordem Blender e S,SE,E,NE,N,NW,W,SW;
// dir = (2 - i) mod 8, onde i e o indice do quarteto.
function dirFromAngle(a) {
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return ((2 - i) % 8 + 8) % 8;
}
function dirFromVector(x, y) {
  return dirFromAngle(Math.atan2(y, x));
}

const WALK_SPEED_U = 2.17;      // unidades/s (aprovada)
const DODGE_DIST_U = 4;         // unidades (aprovada)
// DODGE_TIME aprovado no lote de balanceamento: 0,3 s = 4 quadros a 0,075 s/quadro
// (taxa do ciclo de caminhada: 0,6 s / 8 quadros, cf. "duracao_assumida" da spec).
const DODGE_TIME = 0.3;         // s (4 quadros @ 0,075 s)
// Os sprites renderizados ficaram 180° invertidos em relacao a VEC/dir (frente/costas).
// A direcao logica (this.dir, VEC, cunha/area de ataque) permanece correta; so a arte exibida gira 180°.
function faceDir(d) { return (d + 4) % 8; }
const ATTACK_TIME = 0.25;       // s (4 quadros @ 16 fps: trava da animacao de ataque)
const HIT_RANGE = 85;           // px: alcance do ataque (centro a centro)
const HIT_HALF_COS = 0.764;     // cosseno do meio-angulo (~40 graus): setor de ataque
const PX_PER_UNIT = 64;         // 1 unidade do Blender ~= 64 px na tela
const WALK_SPEED = WALK_SPEED_U * PX_PER_UNIT;   // ~139 px/s
const DODGE_SPEED = (DODGE_DIST_U / DODGE_TIME) * PX_PER_UNIT; // ~853 px/s
// Formata milissegundos como m:ss.cs (ex.: 1:05.42)
function fmtTime(ms) {
  const cs = Math.floor(ms / 10) % 100, s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / 60000);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
const WORLD_W = 2400;         // mapa maior (era 1600)
const WORLD_H = 1800;         // (era 1200)
const AGGRO_R = 420;          // px: inimigo patrulha ate o jogador estar a < 420 px
const POTION_HEAL = 40;       // HP recuperado por pocao
// Blocos de pedra [x, y, largura, altura] (centro). Evitam spawn do jogador, pocoes e inimigos.
const OBSTACLES = [
  [700, 900, 160, 60],
  [1320, 470, 60, 220],
  [1000, 1300, 220, 60],
  [1750, 880, 80, 240],
  [380, 420, 150, 60],
];

// Balanceamento (lote aprovado): dano/velocidade/cooldowns centralizados.
const BK = {
  atkDmg: 12,       // dano do ataque do jogador (era 10)
  atkCd: 0.35,      // cooldown do ataque (era 0,4 s)
  chaseDmg: 10,     // dano chaser (era 8)
  chaseCd: 1.4,     // cooldown chaser (era 1,6 s)
  chaseSpeed: 100,  // velocidade chaser (era 90) — jogador (139) continua mais rapido
  flankDmg: 10,     // dano flanker (era 8)
  flankCd: 1.6,     // cooldown flanker (era 1,8 s)
  flankSpeed: 105,  // velocidade flanker (era 95)
  stalkerDmg: 15,   // dano do dash do stalker (era 12)
  stalkerCd: 2.0,   // cooldown do dash (era 2,2 s)
  stalkerSpeed: 85, // velocidade de abordagem (era 75)
  dashSpeed: 300,   // velocidade do dash (era 280)
  patrolSpeed: 55,  // velocidade de patrulha (era 45)
};

class Arena extends Phaser.Scene {
  constructor() { super('arena'); }

  preload() {
    const keys = [];
    for (let d = 0; d < 8; d++) {
      for (let f = 0; f < 8; f++) keys.push({ key: `walk_${d}_${f}`, url: `assets/sprites/walk_dir${d}_f${f}.png` });
      for (let f = 0; f < 4; f++) keys.push({ key: `attack_${d}_${f}`, url: `assets/sprites/attack_dir${d}_f${f}.png` });
      for (let f = 0; f < 4; f++) keys.push({ key: `dodge_${d}_${f}`, url: `assets/sprites/dodge_dir${d}_f${f}.png` });
    }
    this.load.image(keys);
  }

  create() {
    // Fundo: textura de chao gerada em runtime (CanvasTexture; sem PNG novo).
    // Paleta fria/gotica inspirada em Diablo/Dark Eden.
    const ct = this.textures.createCanvas('ground', 256, 256);
    const c = ct.context;
    c.fillStyle = '#10141b'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) { // ruido fino (granulos)
      const a = 0.02 + Math.random() * 0.08;
      if (Math.random() < 0.45) c.fillStyle = `rgba(120,140,170,${a})`;
      else c.fillStyle = `rgba(0,0,0,${a + 0.04})`;
      c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    for (let i = 0; i < 40; i++) { // mottling amplo (variacao tonal)
      const r = 20 + Math.random() * 40;
      c.fillStyle = `rgba(70,90,120,${Math.random() * 0.035})`;
      c.beginPath(); c.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2); c.fill();
    }
    ct.refresh();
    this.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'ground').setOrigin(0).setDepth(0);

    // Pedras decorativas (sem colisao; textura do chao via elipses)
    for (let i = 0; i < 36; i++) {
      const sx = 60 + Math.random() * (WORLD_W - 120), sy = 60 + Math.random() * (WORLD_H - 120);
      const sw = 18 + Math.random() * 34, sh = 8 + Math.random() * 12;
      this.add.ellipse(sx, sy, sw, sh, 0x202833, 0.6).setDepth(0);
      this.add.ellipse(sx - sw * 0.12, sy - sh * 0.18, sw * 0.6, sh * 0.45, 0x2c3644, 0.55).setDepth(0);
    }

    // Sombras dinamicas (abaixo dos personagens; redesenhadas a cada quadro)
    this.shadowFx = this.add.graphics().setDepth(0.5);

    // Blocos de pedra colidiveis (bloqueiam jogador e inimigos). Fora das areas de spawn/pocao.
    this.blocks = this.physics.add.staticGroup();
    for (const [bx, by, bw, bh] of OBSTACLES) {
      const r = this.add.rectangle(bx, by, bw, bh, 0x3a4450).setDepth(1).setStrokeStyle(3, 0x222a33);
      this.physics.add.existing(r, true);
      this.blocks.add(r);
    }

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    // Corpo fisico ancorado nos PES: sprite 256x256 em escala 0.5 (128 px de tela);
    // pes visuais em y≈233 do quadro (+52,5 px tela abaixo do centro).
    // Circulo r=20 centrado em +40 px tela (12 px acima dos pes): borda inferior
    // a ~7,5 px abaixo dos pes (antes: +23 px). Offsets em px de quadro (escala aplicada).
    this.player = this.physics.add.sprite(WORLD_W / 2, WORLD_H / 2, 'walk_0_0').setScale(0.5).setDepth(2);
    this.player.body.setCircle(20, 108, 188);

    // Efeito transiente do setor de ataque (mundo, acima dos personagens)
    this.atkFx = this.add.graphics().setDepth(3);
    // Indicadores de ameaca/alcance (clareza de combate)
    this.threatFx = this.add.graphics().setDepth(2.8);

    // 3 inimigos com comportamentos distintos (mesma arte; diferem tint/comportamento).
    // Variedade de encontros: posicoes sorteadas por partida e 1 elite ocasional.
    this.enemies = [];
    const slots = {
      chaser:  [[1500,800],[1650,1100],[1400,500]],
      flanker: [[600,600],[450,1000],[800,350]],
      stalker: [[1800,1200],[1950,750],[1700,1450]],
    };
    const pick = (arr) => arr[Phaser.Math.Between(0, arr.length - 1)];
    const elitePick = Phaser.Math.Between(0, 2); // 1 inimigo elite por partida (variedade)
    const base = [
      { ...(() => { const p = pick(slots.chaser); return {x:p[0],y:p[1]}; })(), tint: 0xff8a8a, behavior: 'chaser',  hp: 60, side: 1  },
      { ...(() => { const p = pick(slots.flanker); return {x:p[0],y:p[1]}; })(), tint: 0xffb86a, behavior: 'flanker', hp: 50, side: Phaser.Math.Between(0,1)?1:-1 },
      { ...(() => { const p = pick(slots.stalker); return {x:p[0],y:p[1]}; })(), tint: 0xc9a6ff, behavior: 'stalker', hp: 80, side: -1 },
    ];
    base.forEach((sp, i) => {
      if (i === elitePick) { sp.elite = true; sp.hp = Math.round(sp.hp * 1.4); sp.tint = 0xfff0a0; }
    });
    const spawns = [
      ...base,
      // Chefe: comeca adormecido fora do mapa; ativa quando os outros 3 caem.
      { x: -400, y: -400, tint: 0xff3355, behavior: 'boss', hp: 150, side: 1, dormant: true },
    ];
    for (const sp of spawns) {
      const s = this.physics.add.sprite(sp.x, sp.y, 'walk_4_0').setScale(0.5).setDepth(1).setTint(sp.tint);
      s.body.setCircle(20, 108, 188).setImmovable(true);
      const isBoss = sp.behavior === 'boss';
      const bw = isBoss ? 90 : 36;
      const barBg = this.add.rectangle(0, -64, bw, 5, 0x222222, 0.85).setDepth(3);
      const barFg = this.add.rectangle(-bw / 2, -64, bw, 5, isBoss ? 0xff3355 : 0xff5555, 1).setOrigin(0, 0.5).setDepth(4);
      this.enemies.push({ s, hp: sp.hp, maxHp: sp.hp, tint: sp.tint, behavior: sp.behavior, side: sp.side,
        atkCd: Math.random() * 0.5, state: 'approach', stateT: 0, animT: 0, barBg, barFg,
        hx: sp.x, hy: sp.y, wx: sp.x, wy: sp.y, alerted: false,
        barOff: -bw / 2, dormant: !!sp.dormant, rage: false, pattern: 'slam', ax: 0, ay: 0, hitOnce: false });
      if (sp.dormant) { s.setVisible(false); barBg.setVisible(false); barFg.setVisible(false); }
      // Aura por tipo (vida no mundo): glow aditivo seguindo o inimigo.
      if (!this.textures.exists('enemyAura')) {
        const ta = this.textures.createCanvas('enemyAura', 96, 96);
        const ag = ta.context.createRadialGradient(48, 48, 4, 48, 48, 48);
        ag.addColorStop(0, 'rgba(255,255,255,0.22)');
        ag.addColorStop(0.45, 'rgba(255,255,255,0.08)');
        ag.addColorStop(1, 'rgba(0,0,0,0)');
        ta.context.fillStyle = ag; ta.context.fillRect(0, 0, 96, 96); ta.refresh();
      }
      const isElite = !!sp.elite;
      const auraColor = isBoss ? 0xff3355 : (isElite ? 0xffd966 : sp.tint);
      const aura = this.add.image(sp.x, sp.y, 'enemyAura').setDepth(0.8).setAlpha(isBoss ? 0.3 : (isElite ? 0.3 : 0.18)).setTint(auraColor).setScale(isBoss ? 1.8 : (isElite ? 1.65 : 1.15));
      if (Phaser.BlendModes && Phaser.BlendModes.ADD !== undefined) aura.setBlendMode(Phaser.BlendModes.ADD);
      if (sp.dormant) aura.setVisible(false);
      const en = this.enemies[this.enemies.length - 1];
      en.aura = aura; en.elite = isElite;
      if (isElite) this.floatText(sp.x, sp.y - 80, 'ELITE', '#ffd966', 14);
      this.physics.add.collider(this.player, s);
    }
    this.boss = this.enemies.find((e) => e.behavior === 'boss');
    // Inimigos nao se sobrepoem entre si
    for (let i = 0; i < this.enemies.length; i++)
      for (let j = i + 1; j < this.enemies.length; j++)
        this.physics.add.collider(this.enemies[i].s, this.enemies[j].s);
    // Pedras bloqueiam jogador e inimigos
    this.physics.add.collider(this.player, this.blocks);
    for (const e of this.enemies) this.physics.add.collider(e.s, this.blocks);

    // Contadores da partida (abates e tempo)
    this.kills = 0;
    this.startedAt = this.time.now;
    this.elapsed = 0;

    // Pocao de vida (textura gerada em runtime; sem PNG novo).
    this.potions = [];
    const pg = this.add.graphics();
    pg.fillStyle(0x2ecc71, 1); pg.fillCircle(12, 12, 10);
    pg.fillStyle(0xb6ffd8, 0.95); pg.fillCircle(9, 9, 4);
    pg.fillStyle(0xd5f5e3, 1); pg.fillRect(9, 4, 6, 16); pg.fillRect(4, 9, 16, 6);
    pg.fillStyle(0x145a32, 1); pg.fillRoundedRect(7, 1, 10, 5, 2);
    pg.generateTexture('potion', 24, 24); pg.destroy();
    if (!this.textures.exists('potionGlow')) {
      const tg = this.textures.createCanvas('potionGlow', 64, 64);
      const gg = tg.context.createRadialGradient(32, 32, 2, 32, 32, 32);
      gg.addColorStop(0, 'rgba(120,255,170,0.45)');
      gg.addColorStop(0.5, 'rgba(60,220,120,0.18)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      tg.context.fillStyle = gg; tg.context.fillRect(0, 0, 64, 64); tg.refresh();
    }
    const potionSpots = [[500, 1200], [1900, 600], [1100, 1500], [300, 900], [2100, 1100]];
    const chosen = potionSpots.slice(0, 2);
    if (Math.random() < 0.5) chosen.push(potionSpots[2 + Phaser.Math.Between(0, 2)]);
    for (const [px, py] of chosen) {
      const glow = this.add.image(px, py, 'potionGlow').setDepth(0.9).setAlpha(0.75).setScale(1);
      if (Phaser.BlendModes && Phaser.BlendModes.ADD !== undefined) glow.setBlendMode(Phaser.BlendModes.ADD);
      const ps = this.add.sprite(px, py, 'potion').setScale(1.25).setDepth(1);
      this.potions.push({ s: ps, glow, t: Math.random() * 1000, by: py });
    }

    for (let d = 0; d < 8; d++) {
      this.anims.create({ key: `walk${d}`, frames: Array.from({length:8},(_,i)=>({key:`walk_${d}_${i}`})), frameRate: 12, repeat: -1 });
      this.anims.create({ key: `attack${d}`, frames: Array.from({length:4},(_,i)=>({key:`attack_${d}_${i}`})), frameRate: 16, repeat: 0 });
      this.anims.create({ key: `dodge${d}`, frames: Array.from({length:4},(_,i)=>({key:`dodge_${d}_${i}`})), frameRate: 13, repeat: 0 });
    }

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,J,K');
    this.dir = 0; this.hp = 100;
    this.atkCd = 0; this.dodgeCd = 0; this.enemyCd = 0; this.dodging = false; this.atkLock = 0;
    this._hud = { hp: -1, ehp: -1, dodge: -1, souls: -1 };
    this.over = false;
    this.souls = 0;
    this.wave = 1;
    this.wave2Pending = false;
    this.soulDrops = [];

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // Atmosfera (Diablo/Dark Eden): vinheta fixa + luz suave ao redor do jogador.
    this.setupAtmosphere();
    this.setupAmbience();

    // Multi-toque (iPhone): ponteiros extras para joystick + ATK/ESQ simultaneos
    this.input.addPointer(3);

    // Controles touch: joystick esquerda, botoes direita
    this.joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    const cam = this.cameras.main;
    // Raio do joystick proporcional a tela (toque confortavel no iPhone).
    this.joyRadius = Math.max(40, Math.min(70, cam.width * 0.12));
    this.input.on('pointerdown', p => {
      if (p.x < cam.width / 2 && !this.joy.active) {
        this.joy = { active: true, id: p.id, ox: p.x, oy: p.y, dx: 0, dy: 0 };
        this._drawJoy?.();
      }
    });
    this.input.on('pointermove', p => {
      if (this.joy.active && p.id === this.joy.id) {
        const r = this.joyRadius || 40;
        let dx = (p.x - this.joy.ox) / r, dy = (p.y - this.joy.oy) / r;
        const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
        this.joy.dx = dx; this.joy.dy = dy;
        this._drawJoy?.();
      }
    });
    this.input.on('pointerup', p => { if (p.id === this.joy.id) { this.joy.active = false; this.joyGfx?.clear(); } });
    this.touchAttack = false; this.touchDodge = false;
    // Joystick visual (tela): base fixa no ponto de toque + polegar segue o dedo.
    this.joyGfx = this.add.graphics().setDepth(18).setScrollFactor(0);
    const drawJoy = () => {
      this.joyGfx.clear();
      if (!this.joy.active) return;
      const r = this.joyRadius || 40;
      this.joyGfx.fillStyle(0xffffff, 0.12);
      this.joyGfx.fillCircle(this.joy.ox, this.joy.oy, r + 10);
      const tx = this.joy.ox + this.joy.dx * r, ty = this.joy.oy + this.joy.dy * r;
      this.joyGfx.fillStyle(0xffffff, 0.35);
      this.joyGfx.fillCircle(tx, ty, Math.max(18, r * 0.45));
    };
    this._drawJoy = drawJoy;
    this.add.rectangle(0, 0, 0, 0).setOrigin(0).setInteractive().setVisible(false);
    // Botoes touch fixos a tela (scrollFactor 0), canto inferior direito;
    // maiores e mais proximos da borda em telas pequenas (iPhone em retrato).
    const small = cam.width < 600;
    const style = { fontSize: small ? '20px' : '18px', backgroundColor: '#333', padding: small ? {x:22,y:18} : {x:18,y:14} };
    const pos = (w, h) => ({ x: w - (w < 600 ? 120 : 170), y1: h - (h < 700 ? 170 : 150), y2: h - (h < 700 ? 95 : 80) });
    const p0 = pos(cam.width, cam.height);
    this.btnAtk = this.add.text(p0.x, p0.y1, 'ATK', style)
      .setOrigin(0).setDepth(18).setScrollFactor(0).setInteractive().on('pointerdown', () => { this.touchAttack = true; });
    this.btnDodge = this.add.text(p0.x, p0.y2, 'ESQ', style)
      .setOrigin(0).setDepth(18).setScrollFactor(0).setInteractive().on('pointerdown', () => { this.touchDodge = true; });
    this.scale.on('resize', (gameSize) => {
      const p = pos(gameSize.width, gameSize.height);
      this.btnAtk.setPosition(p.x, p.y1);
      this.btnDodge.setPosition(p.x, p.y2);
      this.joyRadius = Math.max(40, Math.min(70, gameSize.width * 0.12));
      if (this.atmoVignette) {
        this.atmoVignette.setPosition(gameSize.width / 2, gameSize.height / 2);
        this.atmoVignette.setDisplaySize(gameSize.width, gameSize.height);
      }
    });

    // Ataque dos inimigos: por inimigo (ver update), sem timer global.
  }

  setupAmbience() {
    // Motes ambientais (vida no mundo): particulas lentas e sutis.
    this.motes = [];
    for (let i = 0; i < 22; i++) {
      const m = this.add.ellipse(
        Phaser.Math.Between(0, WORLD_W), Phaser.Math.Between(0, WORLD_H),
        Phaser.Math.Between(2, 5), Phaser.Math.Between(2, 5),
        0xc8d8f0, Phaser.Math.FloatBetween(0.04, 0.12)
      ).setDepth(2.4).setScrollFactor(0.9);
      m._vx = Phaser.Math.FloatBetween(-6, 6); m._vy = Phaser.Math.FloatBetween(-10, -2);
      m._baseA = m.alpha;
      this.motes.push(m);
    }
    // Neblina baixa sutil
    this.fogBands = [];
    for (let i = 0; i < 3; i++) {
      const f = this.add.ellipse(WORLD_W * (0.2 + i * 0.3), WORLD_H * (0.55 + i * 0.12), 520, 90, 0x8090b0, 0.035)
        .setDepth(0.6).setScrollFactor(0.6);
      f._ox = f.x;
      this.fogBands.push(f);
    }
  }

  spawnSoul(x, y, big) {
    if (!this.textures.exists('soulOrb')) {
      const t = this.textures.createCanvas('soulOrb', 32, 32);
      const g = t.context.createRadialGradient(16, 16, 2, 16, 16, 16);
      g.addColorStop(0, 'rgba(220,240,255,0.95)');
      g.addColorStop(0.45, 'rgba(120,180,255,0.55)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      t.context.fillStyle = g; t.context.fillRect(0, 0, 32, 32); t.refresh();
    }
    const sc = big ? 1.35 : 1;
    const s = this.add.image(x, y - 10, 'soulOrb').setDepth(2.2).setScale(sc).setAlpha(0.95);
    if (Phaser.BlendModes && Phaser.BlendModes.ADD !== undefined) s.setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: s, y: y - 28, duration: 280, ease: 'Quad.easeOut' });
    this.soulDrops.push({ s, by: y - 28, t: Math.random() * 1000, big: !!big });
  }

  spawnBonusWave() {
    // Progressao: onda bonus mais dificil (mesmas mecanicas; HP +30%). Sem mexer no balanceamento da Onda 1.
    const spawns = [
      { x: 1600, y: 500,  tint: 0xff6666, behavior: 'chaser',  hp: 78, side: 1  },
      { x: 500,  y: 1300, tint: 0xffaa55, behavior: 'flanker', hp: 65, side: -1 },
      { x: 1900, y: 1400, tint: 0xd39bff, behavior: 'stalker', hp: 104, side: 1 },
    ];
    for (const sp of spawns) {
      const s = this.physics.add.sprite(sp.x, sp.y, 'walk_4_0').setScale(0.5).setDepth(1).setTint(sp.tint);
      s.body.setCircle(20, 108, 188).setImmovable(true);
      const bw = 36;
      const barBg = this.add.rectangle(0, -64, bw, 5, 0x222222, 0.85).setDepth(3);
      const barFg = this.add.rectangle(-bw / 2, -64, bw, 5, 0xff5555, 1).setOrigin(0, 0.5).setDepth(4);
      if (!this.textures.exists('enemyAura')) {
        const ta = this.textures.createCanvas('enemyAura', 96, 96);
        const ag = ta.context.createRadialGradient(48, 48, 4, 48, 48, 48);
        ag.addColorStop(0, 'rgba(255,255,255,0.22)'); ag.addColorStop(0.45, 'rgba(255,255,255,0.08)'); ag.addColorStop(1, 'rgba(0,0,0,0)');
        ta.context.fillStyle = ag; ta.context.fillRect(0, 0, 96, 96); ta.refresh();
      }
      const aura = this.add.image(sp.x, sp.y, 'enemyAura').setDepth(0.8).setAlpha(0.22).setTint(sp.tint).setScale(1.25);
      if (Phaser.BlendModes && Phaser.BlendModes.ADD !== undefined) aura.setBlendMode(Phaser.BlendModes.ADD);
      this.enemies.push({ s, hp: sp.hp, maxHp: sp.hp, tint: sp.tint, behavior: sp.behavior, side: sp.side,
        atkCd: Math.random() * 0.5, state: 'approach', stateT: 0, animT: 0, barBg, barFg,
        hx: sp.x, hy: sp.y, wx: sp.x, wy: sp.y, alerted: true, aura,
        barOff: -bw / 2, dormant: false, rage: false, pattern: 'slam', ax: 0, ay: 0, hitOnce: false });
      this.physics.add.collider(this.player, s);
      if (this.blocks) this.physics.add.collider(s, this.blocks);
      for (let i = 0; i < this.enemies.length - 1; i++) this.physics.add.collider(this.enemies[i].s, s);
    }
    // Uma pocao extra como recompensa de progressao
    if (!this.textures.exists('potion')) {
      const pg = this.add.graphics(); pg.fillStyle(0x2ecc71, 1); pg.fillCircle(12, 12, 10);
      pg.fillStyle(0xb6ffd8, 0.95); pg.fillCircle(9, 9, 4); pg.fillStyle(0xd5f5e3, 1); pg.fillRect(9, 4, 6, 16); pg.fillRect(4, 9, 16, 6);
      pg.fillStyle(0x145a32, 1); pg.fillRoundedRect(7, 1, 10, 5, 2); pg.generateTexture('potion', 24, 24); pg.destroy();
    }
    if (!this.textures.exists('potionGlow')) {
      const tg = this.textures.createCanvas('potionGlow', 64, 64);
      const gg = tg.context.createRadialGradient(32, 32, 2, 32, 32, 32);
      gg.addColorStop(0, 'rgba(120,255,170,0.45)'); gg.addColorStop(0.5, 'rgba(60,220,120,0.18)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
      tg.context.fillStyle = gg; tg.context.fillRect(0, 0, 64, 64); tg.refresh();
    }
    const px = 1200, py = 900;
    const glow = this.add.image(px, py, 'potionGlow').setDepth(0.9).setAlpha(0.75).setScale(1);
    if (Phaser.BlendModes && Phaser.BlendModes.ADD !== undefined) glow.setBlendMode(Phaser.BlendModes.ADD);
    const ps = this.add.sprite(px, py, 'potion').setScale(1.25).setDepth(1);
    this.potions.push({ s: ps, glow, t: Math.random() * 1000, by: py });
    this.floatText(px, py - 40, 'Onda Bônus!', '#ffdd88', 22);
  }

  setupAtmosphere() {
    const cam = this.cameras.main;
    // Luz do heroi (mundo): gradiente radial aditivo, segue o jogador.
    if (!this.textures.exists('heroLight')) {
      const t = this.textures.createCanvas('heroLight', 512, 512);
      const g = t.context.createRadialGradient(256, 256, 10, 256, 256, 256);
      g.addColorStop(0, 'rgba(255,244,214,0.22)');
      g.addColorStop(0.25, 'rgba(210,225,255,0.10)');
      g.addColorStop(0.55, 'rgba(140,170,220,0.04)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      t.context.fillStyle = g;
      t.context.fillRect(0, 0, 512, 512);
      t.refresh();
    }
    this.heroLight = this.add.image(this.player.x, this.player.y, 'heroLight').setDepth(0.55).setScale(1.15).setAlpha(0.9);
    if (Phaser.BlendModes && Phaser.BlendModes.ADD !== undefined) this.heroLight.setBlendMode(Phaser.BlendModes.ADD);

    // Vinheta permanente (tela): bordas escuras, centro mais limpo.
    if (!this.textures.exists('atmoVignette')) {
      const t = this.textures.createCanvas('atmoVignette', 512, 512);
      const g = t.context.createRadialGradient(256, 256, 90, 256, 256, 360);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.45, 'rgba(0,0,0,0.10)');
      g.addColorStop(0.78, 'rgba(0,0,0,0.42)');
      g.addColorStop(1, 'rgba(0,0,0,0.72)');
      t.context.fillStyle = g;
      t.context.fillRect(0, 0, 512, 512);
      t.refresh();
    }
    this.atmoVignette = this.add.image(cam.width / 2, cam.height / 2, 'atmoVignette')
      .setScrollFactor(0).setDepth(17).setAlpha(1);
    this.atmoVignette.setDisplaySize(cam.width, cam.height);
  }

  // Aviso grande no centro da tela (ex.: CHEFE!, FURIA!) que some sozinho.
  showBanner(txt) {
    const cam = this.cameras.main;
    const t = this.add.text(cam.width / 2, cam.height * 0.3, txt, { fontSize: '40px', fontStyle: 'bold', color: '#ff4d6d', stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(22);
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 30, delay: 900, duration: 500, onComplete: () => t.destroy() });
  }

  // Texto flutuante (dano, etc.) que sobe e desaparece.
  floatText(x, y, txt, color, size = 18) {
    const t = this.add.text(x, y - 20, txt, { fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(12);
    this.tweens.add({ targets: t, y: y - 65, alpha: 0, scale: 1.15, duration: 720, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }

  // Faiscas simples no ponto de impacto.
  sparks(x, y, color, n = 8, spread = 42) {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.6;
      const s = 3 + Math.random() * 4;
      const p = this.add.rectangle(x, y, s, s, color).setDepth(6);
      this.tweens.add({ targets: p, x: x + Math.cos(a) * spread * (0.6 + Math.random() * 0.5), y: y + Math.sin(a) * spread * (0.6 + Math.random() * 0.5), alpha: 0, rotation: Math.random() * 2, duration: 280 + Math.random() * 180, onComplete: () => p.destroy() });
    }
  }

  // Hitstop curto: pausa a fisica/simulacao por ms (sensacao de impacto).
  hitstop(ms = 55) {
    if (this._hitstop) return;
    this._hitstop = true;
    this.physics.world.pause();
    this.time.delayedCall(ms, () => { this.physics.world.resume(); this._hitstop = false; });
  }

  // Vinheta vermelha rapida ao levar dano.
  damageVignette() {
    const cam = this.cameras.main;
    if (!this._vig) this._vig = this.add.rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, 0xff0000, 0)
      .setScrollFactor(0).setDepth(19);
    this._vig.setAlpha(0.22);
    this.tweens.add({ targets: this._vig, alpha: 0, duration: 220 });
  }

  // Poeira no chao (passos/esquiva).
  dust(x, y, n = 3) {
    for (let i = 0; i < n; i++) {
      const d = this.add.ellipse(x + (Math.random() - 0.5) * 10, y + 42 + (Math.random() - 0.5) * 6, 6 + Math.random() * 8, 3 + Math.random() * 4, 0xb8b0a0, 0.35).setDepth(1);
      this.tweens.add({ targets: d, x: d.x + (Math.random() - 0.5) * 18, y: d.y - 4 - Math.random() * 8, alpha: 0, scaleX: 1.6, duration: 420, onComplete: () => d.destroy() });
    }
  }

  hurtPlayer(dmg, source) {
    if (this.dodging || this.over) return;
    this.hp -= dmg;
    this.lastHitBy = source || 'inimigo';
    this.floatText(this.player.x, this.player.y, `-${dmg}`, '#ff6b6b', 22);
    this.damageVignette();
    this.cameras.main.shake(100, 0.0045);
    if (this.hp <= 0) this.showEnd('DERROTA', `Causa: ${this.lastHitBy} · Tempo ${fmtTime(this.time.now - this.startedAt)} · Almas ${this.souls} · Abates ${this.kills}`);
  }

  showEnd(title, sub) {
    if (this.over) return;
    this.over = true;
    this.player.setVelocity(0, 0);
    for (const e of this.enemies) e.s.setVelocity(0, 0);
    const cam = this.cameras.main;
    this.add.rectangle(0, 0, cam.width, cam.height, 0x000000, 0.7).setOrigin(0).setScrollFactor(0).setDepth(20);
    this.add.text(cam.width / 2, cam.height / 2 - 40, title, { fontSize: '42px', color: '#ffffff' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(21);
    if (sub) this.add.text(cam.width / 2, cam.height / 2 + 6, sub, { fontSize: '18px', color: '#ffe08a' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(21);
    this.add.text(cam.width / 2, cam.height / 2 + 40, 'Toque ou aperte R para jogar novamente', { fontSize: '16px', color: '#cccccc' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(21);
    this.input.keyboard.on('keydown-R', () => this.scene.restart());
    this.input.once('pointerdown', () => this.scene.restart());
  }

  update(time, delta) {
    if (this.over) return; // tela de fim: so reinicia (R ou toque)
    const dt = delta / 1000;
    this.atkCd = Math.max(0, this.atkCd - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.atkLock = Math.max(0, this.atkLock - dt);

    // Direcao de movimento (teclado ou joystick)
    let x = 0, y = 0;
    if (this.keys.A.isDown || this.cursors.left.isDown) x -= 1;
    if (this.keys.D.isDown || this.cursors.right.isDown) x += 1;
    if (this.keys.W.isDown || this.cursors.up.isDown) y -= 1;
    if (this.keys.S.isDown || this.cursors.down.isDown) y += 1;
    if (this.joy.active) { x = this.joy.dx; y = this.joy.dy; }
    const moving = Math.hypot(x, y) > 0.15;
    if (moving) this.dir = dirFromVector(x, y);

    // Esquiva: deslocamento do objeto de 4 unidades em 0,3 s (o jogo move o personagem)
    const wantDodge = Phaser.Input.Keyboard.JustDown(this.keys.K) || this.touchDodge;
    this.touchDodge = false;
    if (wantDodge && this.dodgeCd <= 0 && !this.dodging) {
      this.dodging = true; this.dodgeCd = 0.8;
      const v = VEC[this.dir];
      this.player.setVelocity(v[0] * DODGE_SPEED, v[1] * DODGE_SPEED);
      this.player.play(`dodge${faceDir(this.dir)}`);
      this.ghostAt = 0;
      this.dust(this.player.x, this.player.y, 5);
      this.time.delayedCall(DODGE_TIME * 1000, () => { this.dodging = false; this.player.setVelocity(0, 0); this.dust(this.player.x, this.player.y, 4); });
    }
    // Rastro fantasma durante a esquiva (um a cada ~45 ms).
    if (this.dodging && time - (this.ghostAt || 0) > 45) {
      this.ghostAt = time;
      const gh = this.add.sprite(this.player.x, this.player.y, this.player.texture.key, this.player.frame.name)
        .setScale(0.5).setTint(0x66ccff).setAlpha(0.45).setDepth(1.5);
      this.tweens.add({ targets: gh, alpha: 0, scale: 0.42, duration: 260, onComplete: () => gh.destroy() });
    }

    if (!this.dodging) {
      if (moving) {
        const m = Math.hypot(x, y) || 1;
        this.player.setVelocity((x / m) * WALK_SPEED, (y / m) * WALK_SPEED);
        // Durante a trava de ataque (0,25 s) a animacao de ataque permanece,
        // mesmo com tecla de movimento pressionada (velocidade continua normal).
        const fd = faceDir(this.dir);
        if (this.atkLock <= 0 && (!this.player.anims.isPlaying || this.player.anims.currentAnim?.key !== `walk${fd}`))
          this.player.play(`walk${fd}`);
        if (time - (this._stepDust || 0) > 180) { this._stepDust = time; this.dust(this.player.x, this.player.y, 1); }
      } else {
        this.player.setVelocity(0, 0);
        if (this.atkLock <= 0 && this.player.anims.currentAnim && this.player.anims.currentAnim.key.startsWith('walk'))
          this.player.setTexture(`walk_${faceDir(this.dir)}_0`);
      }
    }

    // Ataque direto: acerta apenas inimigos dentro do alcance E do setor frontal.
    const wantAtk = Phaser.Input.Keyboard.JustDown(this.keys.J) || this.touchAttack;
    this.touchAttack = false;
    if (wantAtk && this.atkCd <= 0) {
      this.atkCd = BK.atkCd;
      this.atkLock = ATTACK_TIME;
      this.atkDir = this.dir; // direcao logica travada para o arco visual
      this.player.play(`attack${faceDir(this.dir)}`);
      this.time.delayedCall(ATTACK_TIME * 1000, () => { this.atkLock = 0; this.atkFx.clear(); });
      const v = VEC[this.dir];
      let hitAny = false;
      for (const e of this.enemies) {
        if (e.hp <= 0 || e.dormant) continue;
        const dx = e.s.x - this.player.x, dy = e.s.y - this.player.y;
        const dist = Math.hypot(dx, dy);
        if (dist > HIT_RANGE) continue;
        const facing = dist < 1 || (v[0] * (dx / dist) + v[1] * (dy / dist)) >= HIT_HALF_COS;
        if (!facing) continue;
        hitAny = true;
        e.hp -= BK.atkDmg;
        e.barFg.setScale(Math.max(0, e.hp) / e.maxHp, 1);
        this.floatText(e.s.x, e.s.y, `-${BK.atkDmg}`, e.behavior === 'boss' ? '#ff6688' : '#ffe08a', e.behavior === 'boss' ? 22 : 18);
        this.sparks(e.s.x, e.s.y, e.behavior === 'boss' ? 0xff4466 : 0xffe08a, e.behavior === 'boss' ? 12 : 8, e.behavior === 'boss' ? 55 : 42);
        // Flash branco de impacto (restaura o tint original; morte vira alpha).
        if (e.hp <= 0) {
          e.s.setVelocity(0, 0); e.s.clearTint();
          if (e.s.body) e.s.body.enable = false;
          e.barBg.setVisible(false); e.barFg.setVisible(false);
          if (e.aura) e.aura.setVisible(false);
          this.spawnSoul(e.s.x, e.s.y, e.behavior === 'boss' || !!e.elite);
          this.sparks(e.s.x, e.s.y, e.tint || 0xffffff, e.behavior === 'boss' ? 22 : (e.elite ? 18 : 14), e.behavior === 'boss' ? 90 : (e.elite ? 80 : 70));
          this.dust(e.s.x, e.s.y, e.behavior === 'boss' ? 8 : 4);
          this.tweens.add({ targets: e.s, alpha: 0, scale: e.behavior === 'boss' ? 0.35 : 0.3, y: e.s.y + 8, duration: e.behavior === 'boss' ? 700 : 450, ease: 'Quad.easeIn' });
          if (e.behavior === 'boss') this.cameras.main.flash(140, 255, 220, 180);
        }
        else {
          e.s.setTint(0xffffff);
          if (e.s.setTintMode) e.s.setTintMode(Phaser.TintModes ? Phaser.TintModes.FILL : 0);
          this.time.delayedCall(80, () => { if (e.hp > 0) { e.s.clearTint(); e.s.setTint(e.tint); } });
        }
      }
      if (hitAny) { this.hitstop(55); this.cameras.main.shake(70, 0.003); }
    }

    // Arco animado do ataque: varre o setor frontal durante a trava (substitui a cunha estatica).
    if (this.atkLock > 0) {
      const p = 1 - this.atkLock / ATTACK_TIME; // 0..1
      const v = VEC[this.atkDir ?? this.dir];
      const a = Math.atan2(v[1], v[0]), half = 0.75;
      const sweep = -half + (half * 2) * Math.min(1, p * 1.25);
      this.atkFx.clear();
      // rastro
      this.atkFx.fillStyle(0xffdd88, 0.18 * (1 - p * 0.5));
      this.atkFx.beginPath(); this.atkFx.moveTo(this.player.x, this.player.y);
      this.atkFx.arc(this.player.x, this.player.y, HIT_RANGE, a - half, a + sweep, false);
      this.atkFx.closePath(); this.atkFx.fillPath();
      // lamina brilhante (borda do varrimento)
      this.atkFx.lineStyle(4, 0xfff4cc, 0.85 * (1 - p * 0.6));
      this.atkFx.beginPath();
      this.atkFx.arc(this.player.x, this.player.y, HIT_RANGE - 6, a + sweep - 0.12, a + sweep + 0.04, false);
      this.atkFx.strokePath();
      this.atkFx.lineStyle(2, 0xffffff, 0.5);
      this.atkFx.beginPath();
      this.atkFx.arc(this.player.x, this.player.y, HIT_RANGE - 14, a - half * 0.2, a + sweep, false);
      this.atkFx.strokePath();
    }

    // Inimigos: 3 comportamentos (mesma arte; diferem em movimentacao/ataque).
    // Abates contados aqui (valem para qualquer causa de morte).
    for (const e of this.enemies) if (e.hp <= 0 && !e.dead) { e.dead = true; this.kills++; }
    if (this.threatFx) {
      this.threatFx.clear();
      // Indicador sutil de alcance/ameaca ao redor do jogador
      const threatNear = this.enemies.some((e) => e.hp > 0 && !e.dormant && e.alerted && Phaser.Math.Distance.Between(this.player.x, this.player.y, e.s.x, e.s.y) < 180);
      if (threatNear) {
        this.threatFx.lineStyle(1, 0xffdd88, 0.12);
        this.threatFx.strokeCircle(this.player.x, this.player.y, HIT_RANGE);
      }
    }

    // Chefe ativa quando todos os outros inimigos caem.
    if (this.boss && this.boss.dormant && this.enemies.filter((e) => e !== this.boss).every((e) => e.hp <= 0)) {
      const b = this.boss;
      b.dormant = false; b.alerted = true; b.state = 'approach'; b.stateT = 1.5;
      b.s.setPosition(1200, 300).setVisible(true);
      b.barBg.setVisible(true); b.barFg.setVisible(true);
      if (b.aura) b.aura.setVisible(true);
      this.showBanner('CHEFE!');
      this.cameras.main.shake(180, 0.006);
      this.sparks(1200, 300, 0xff3355, 16, 80);
    }

    for (const e of this.enemies) {
      if (e.hp <= 0 || e.dormant) continue;
      e.atkCd = Math.max(0, e.atkCd - dt);
      const ex = e.s.x, ey = e.s.y;
      const px = this.player.x, py = this.player.y;
      const ang = Phaser.Math.Angle.Between(ex, ey, px, py);
      const d = Phaser.Math.Distance.Between(ex, ey, px, py);
      let vx = 0, vy = 0, showWalk = true;
      // Patrulha/aggro: fora do raio de alerta, anda lento entre pontos na area inicial.
      if (!e.alerted && d < AGGRO_R) {
        e.alerted = true;
        e.state = 'approach'; e.stateT = 0;
      }
      if (!e.alerted) {
        const dw = Phaser.Math.Distance.Between(ex, ey, e.wx, e.wy);
        if (dw < 12) {
          const wa = Math.random() * Math.PI * 2, wr = 40 + Math.random() * 90;
          e.wx = Phaser.Math.Clamp(e.hx + Math.cos(wa) * wr, 60, WORLD_W - 60);
          e.wy = Phaser.Math.Clamp(e.hy + Math.sin(wa) * wr, 60, WORLD_H - 60);
        }
        const pang = Phaser.Math.Angle.Between(ex, ey, e.wx, e.wy);
        vx = Math.cos(pang) * BK.patrolSpeed; vy = Math.sin(pang) * BK.patrolSpeed;
        e.s.setVelocity(vx, vy);
        const edir = dirFromAngle(pang);
        const efd = faceDir(edir);
        if (e.s.anims.currentAnim?.key !== `walk${efd}`) e.s.play(`walk${efd}`);
        e.barBg.setPosition(ex, ey - 64);
        e.barFg.setPosition(ex + e.barOff, ey - 64);
        if (e.aura) e.aura.setPosition(ex, ey + 6).setAlpha(0.14 + Math.sin(time * 0.004 + ex) * 0.03);
        continue;
      }
      if (e.behavior === 'chaser') {
        // Persegue em linha reta; ataca de perto.
        if (d > 55) { vx = Math.cos(ang) * BK.chaseSpeed; vy = Math.sin(ang) * BK.chaseSpeed; }
        // Aviso sutil: brilho quando esta no alcance e pronto para golpear.
        if (d < 90 && e.atkCd <= 0.15 && !e._wind) { e._wind = true; e.s.setTint(0xffdddd); this.time.delayedCall(120, () => { e._wind = false; if (e.hp > 0 && !e.dead) e.s.setTint(e.tint); }); }
        if (d < 75 && e.atkCd <= 0) {
          this.hurtPlayer(BK.chaseDmg, e.elite ? 'Perseguidor de elite' : 'Perseguidor'); e.atkCd = BK.chaseCd;
          e.s.setScale(0.58).setTint(0xffffff);
          this.tweens.add({ targets: e.s, scale: 0.5, duration: 120, onComplete: () => { if (e.hp > 0) e.s.setTint(e.tint); } });
          this.sparks((ex + px) / 2, (ey + py) / 2, 0xff8888, 5, 22);
        }
      } else if (e.behavior === 'flanker') {
        // Circula o jogador: soma tangente ao vetor de perseguicao.
        if (d > 60) {
          const pa = ang + Math.PI / 2 * e.side;
          vx = (Math.cos(ang) + Math.cos(pa) * 0.7) * 70;
          vy = (Math.sin(ang) + Math.sin(pa) * 0.7) * 70;
          const m = Math.hypot(vx, vy) || 1;
          vx = (vx / m) * BK.flankSpeed; vy = (vy / m) * BK.flankSpeed;
        }
        if (d < 90 && e.atkCd <= 0.15 && !e._wind) { e._wind = true; e.s.setTint(0xffe0c0); this.time.delayedCall(120, () => { e._wind = false; if (e.hp > 0 && !e.dead) e.s.setTint(e.tint); }); }
        if (d < 75 && e.atkCd <= 0) {
          this.hurtPlayer(BK.flankDmg, e.elite ? 'Flanqueador de elite' : 'Flanqueador'); e.atkCd = BK.flankCd;
          e.s.setScale(0.58).setTint(0xffffff);
          this.tweens.add({ targets: e.s, scale: 0.5, duration: 120, onComplete: () => { if (e.hp > 0) e.s.setTint(e.tint); } });
          this.sparks((ex + px) / 2, (ey + py) / 2, 0xffc080, 5, 22);
        }
      } else if (e.behavior === 'boss') {
        // Chefe: persegue; alterna SOCO (area ao redor) e INVESTIDA (dash em linha reta).
        // Abaixo de 50% de HP entra em furia: ataques mais rapidos e velozes.
        if (!e.rage && e.hp <= e.maxHp / 2) { e.rage = true; e.s.setTint(0xff0033); this.showBanner('FÚRIA!'); this.cameras.main.shake(140, 0.005); this.sparks(ex, ey, 0xff0033, 12, 65); }
        const cd = e.rage ? 1.3 : 2.0;
        const telegraph = e.rage ? 0.6 : 0.85;
        e.stateT = Math.max(0, e.stateT - dt);
        if (e.state === 'approach') {
          if (d > 90) { const sp = e.rage ? 115 : 85; vx = Math.cos(ang) * sp; vy = Math.sin(ang) * sp; }
          if (e.stateT <= 0) {
            if (d < 150) { // so ataca de perto: soco e investida alcançam o jogador
              e.state = 'warn'; e.stateT = telegraph; e.animT = 0;
              e.ax = Math.cos(ang); e.ay = Math.sin(ang);
            } else e.stateT = 0.3; // ainda longe: continua se aproximando
          }
        } else if (e.state === 'warn') {
          showWalk = false;
          e.animT += dt;
          e.s.setTint(e.animT % 0.16 < 0.08 ? 0xffffff : (e.rage ? 0xff0033 : e.tint));
          if (e.pattern === 'charge') {
            e.ax = Math.cos(ang); e.ay = Math.sin(ang); // mira ate o fim
            // Indicador de investida: linha de perigo na direcao travada
            if (this.threatFx) {
              const lx = ex + e.ax * 170, ly = ey + e.ay * 170;
              this.threatFx.lineStyle(4, 0xff5577, 0.28 + Math.sin(time * 0.018) * 0.1);
              this.threatFx.lineBetween(ex, ey, lx, ly);
              this.threatFx.fillStyle(0xff3355, 0.18);
              this.threatFx.fillCircle(lx, ly, 14);
            }
          } else if (this.threatFx) {
            // Area do soco
            this.threatFx.lineStyle(2, 0xff6688, 0.22 + Math.sin(time * 0.02) * 0.08);
            this.threatFx.strokeCircle(ex, ey, 150);
          }
          if (e.stateT <= 0) {
            e.s.setTint(e.rage ? 0xff0033 : e.tint);
            if (e.pattern === 'slam') {
              // Onda de choque: area de raio 150 px ao redor do chefe
              const ring = this.add.circle(ex, ey, 30, 0xff3355, 0.35).setDepth(2).setStrokeStyle(5, 0xff99aa, 0.9);
              this.tweens.add({ targets: ring, scale: 155 / 30, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
              const ring2 = this.add.circle(ex, ey, 30, 0xffffff, 0.12).setDepth(2);
              this.tweens.add({ targets: ring2, scale: 120 / 30, alpha: 0, duration: 320, onComplete: () => ring2.destroy() });
              this.cameras.main.shake(120, 0.005);
              this.sparks(ex, ey, 0xff5577, 10, 60);
              if (d < 150) this.hurtPlayer(20, 'Chefe (onda de choque)');
              e.pattern = 'charge';
              e.state = 'idle'; e.stateT = cd;
            } else {
              e.state = 'dash'; e.stateT = 0.5; e.hitOnce = false;
              this.dust(ex, ey, 4);
            }
          }
        } else if (e.state === 'dash') {
          showWalk = false;
          const ds = e.rage ? 380 : 320;
          vx = e.ax * ds; vy = e.ay * ds;
          if (time - (e._dashDust || 0) > 50) { e._dashDust = time; this.dust(ex, ey, 2); }
          if (d < 60 && !e.hitOnce) { e.hitOnce = true; this.hurtPlayer(18, 'Chefe (investida)'); this.cameras.main.shake(120, 0.006); }
          if (e.stateT <= 0) {
            e.pattern = 'slam';
            e.state = 'idle'; e.stateT = cd;
          }
        } else if (e.state === 'idle') {
          // Recuperacao curta entre ataques: segue o jogador devagar.
          if (d > 90) { const sp = e.rage ? 70 : 50; vx = Math.cos(ang) * sp; vy = Math.sin(ang) * sp; }
          if (e.stateT <= 0) { e.state = 'approach'; e.stateT = 0.8; }
        }
      } else { // 'stalker': aproxima, flasheia (telegraph), avanca
        e.stateT = Math.max(0, e.stateT - dt);
        if (e.state === 'approach') {
          if (d > 130) { vx = Math.cos(ang) * BK.stalkerSpeed; vy = Math.sin(ang) * BK.stalkerSpeed; }
          else { e.state = 'warn'; e.stateT = 0.7; }
        } else if (e.state === 'warn') {
          e.animT += dt;
          e.s.setTint(e.animT % 0.14 < 0.07 ? 0xffffff : e.tint);
          // Telegraph claro: anel de perigo no chao (vai investir)
          if (this.threatFx) {
            const pulse = 0.25 + Math.sin(time * 0.02) * 0.12;
            this.threatFx.lineStyle(3, 0xd39bff, pulse);
            this.threatFx.strokeCircle(ex, ey, 48 + Math.sin(time * 0.015) * 6);
            this.threatFx.fillStyle(0xc084fc, 0.08);
            this.threatFx.fillCircle(ex, ey, 44);
          }
          if (e.stateT <= 0) { e.state = 'dash'; e.stateT = 0.35; e.s.clearTint(); }
          showWalk = false;
        } else if (e.state === 'dash') {
          vx = Math.cos(ang) * BK.dashSpeed; vy = Math.sin(ang) * BK.dashSpeed;
          if (d < 60 && e.atkCd <= 0) { this.hurtPlayer(BK.stalkerDmg, e.elite ? 'Espreitador de elite' : 'Espreitador'); e.atkCd = BK.stalkerCd; }
          if (e.stateT <= 0 || d < 45) { e.state = 'recover'; e.stateT = 0.9; }
          showWalk = false;
        } else if (e.state === 'recover') {
          if (e.stateT <= 0) e.state = 'approach';
          showWalk = false;
        }
      }
      e.s.setVelocity(vx, vy);
      const edir = dirFromAngle(ang); // mesmo mapeamento do jogador
      const efd = faceDir(edir);
      if (showWalk && e.s.anims.currentAnim?.key !== `walk${efd}`) e.s.play(`walk${efd}`);
      e.barBg.setPosition(ex, ey - 64);
      e.barFg.setPosition(ex + e.barOff, ey - 64);
      if (e.aura) e.aura.setPosition(ex, ey + 6).setAlpha((e.behavior === 'boss' ? (e.rage ? 0.38 : 0.28) : 0.18) + Math.sin(time * 0.005 + ex) * 0.04);
    }

    // Sombras dinamicas sob os personagens (pes a ~+52 px abaixo do centro).
    this.shadowFx.clear();
    this.shadowFx.fillStyle(0x000000, 0.38);
    this.shadowFx.fillEllipse(this.player.x, this.player.y + 52, 48, 15);
    for (const e of this.enemies) {
      if (e.hp > 0) this.shadowFx.fillEllipse(e.s.x, e.s.y + 52, 48, 15);
    }
    // Luz do heroi segue o jogador (atmosfera).
    if (this.heroLight) this.heroLight.setPosition(this.player.x, this.player.y);

    // Motes e neblina (vida no mundo)
    if (this.motes) for (const m of this.motes) {
      m.x += (m._vx || 0) * dt; m.y += (m._vy || -4) * dt;
      m.alpha = (m._baseA || 0.08) + Math.sin(time * 0.001 + m.x * 0.01) * 0.03;
      if (m.y < -20) m.y = WORLD_H + 20;
      if (m.x < -20) m.x = WORLD_W + 20; if (m.x > WORLD_W + 20) m.x = -20;
    }
    if (this.fogBands) for (let i = 0; i < this.fogBands.length; i++) {
      const f = this.fogBands[i]; f.x = f._ox + Math.sin(time * 0.00018 + i) * 80;
    }

    // Pocao: coleta por distancia (ignora o offset dos pes do corpo fisico).
    for (let i = this.potions.length - 1; i >= 0; i--) {
      const p = this.potions[i];
      const pulse = Math.sin(time * 0.006 + p.t) * 0.12;
      p.s.setScale(1.25 + pulse);
      p.s.y = p.by + Math.sin(time * 0.0035 + p.t) * 4; // leve flutuacao
      p.glow.setPosition(p.s.x, p.s.y).setAlpha(0.55 + (pulse + 0.12) * 1.1).setScale(1.1 + pulse * 0.6);
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, p.s.x, p.s.y) < 40) {
        this.hp = Math.min(100, this.hp + POTION_HEAL);
        this.floatText(p.s.x, p.s.y, `+${POTION_HEAL} HP`, '#6cff9a', 20);
        this.sparks(p.s.x, p.s.y, 0x66ff99, 10, 45);
        const ring = this.add.circle(p.s.x, p.s.y, 10, 0x66ff99, 0.22).setDepth(2);
        this.tweens.add({ targets: ring, scale: 4.2, alpha: 0, duration: 380, onComplete: () => ring.destroy() });
        p.s.destroy(); p.glow.destroy();
        this.potions.splice(i, 1);
      }
    }

    // Almas (progressao): caem dos inimigos, curam pouco e contam no HUD.
    for (let i = this.soulDrops.length - 1; i >= 0; i--) {
      const o = this.soulDrops[i];
      o.s.y = o.by + Math.sin(time * 0.004 + o.t) * 3;
      o.s.setAlpha(0.75 + Math.sin(time * 0.006 + o.t) * 0.2);
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, o.s.x, o.s.y) < 46) {
        this.souls++;
        this.hp = Math.min(100, this.hp + 10);
        this.floatText(o.s.x, o.s.y, '+10 HP · Alma', '#9fd0ff', 16);
        this.sparks(o.s.x, o.s.y, 0x88ccff, 8, 34);
        o.s.destroy();
        this.soulDrops.splice(i, 1);
      }
    }

    // Progressao: Onda 1 concluida (3 + chefe) -> Onda Bonus; Onda Bonus concluida -> vitoria final.
    if (this.enemies.every((e) => e.hp <= 0)) {
      if (this.wave === 1) {
        if (!this.wave2Pending) {
          this.wave2Pending = true;
          this.showBanner('ONDA BÔNUS');
          this.time.delayedCall(1800, () => {
            if (this.over) return;
            this.wave = 2; this.wave2Pending = false;
            this.spawnBonusWave();
          });
        }
        return; // aguarda transicao (nao repete spawn)
      }
      if (this.wave === 2) {
        this.elapsed = this.time.now - this.startedAt;
        const best = Number(localStorage.getItem('pocBestMs')) || 0;
        if (!best || this.elapsed < best) localStorage.setItem('pocBestMs', String(Math.round(this.elapsed)));
        this.showEnd('PURIFICADO!', `Tempo ${fmtTime(this.elapsed)} · Recorde ${fmtTime(!best || this.elapsed < best ? this.elapsed : best)} · Almas ${this.souls}`);
        return;
      }
    }

    // HUD: escreve no DOM apenas quando muda (evita layout/repaint a 60 fps).
    this.elapsed = this.time.now - this.startedAt;
    const hpTxt = `Mago HP ${Math.max(0, this.hp)}`;
    const alive = this.enemies.filter((e) => e.hp > 0 && !e.dormant).length;
    const waveTxt = this.wave === 2 ? ' · Onda Bônus' : '';
    const ehpTxt = `Abates ${this.kills}/${this.enemies.length}${waveTxt} · Restam ${alive} · ${fmtTime(this.elapsed)}`;
    const soulsTxt = `Almas ${this.souls} · Poções ${this.potions.length}`;
    const dodgePct = Math.round((1 - this.dodgeCd / 0.8) * 100);
    if (this._hud.hp !== this.hp) { this._hud.hp = this.hp; document.getElementById('hp').textContent = hpTxt; }
    if (this._hud.ehp !== ehpTxt) { this._hud.ehp = ehpTxt; document.getElementById('ehp').textContent = ehpTxt; }
    if (this._hud.souls !== soulsTxt) { this._hud.souls = soulsTxt; const el = document.getElementById('souls'); if (el) el.textContent = soulsTxt; }
    if (this._hud.dodge !== dodgePct) { this._hud.dodge = dodgePct; document.getElementById('dodgeFill').style.width = `${dodgePct}%`; }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#0c0e11',
  physics: { default: 'arcade', arcade: { debug: false } },
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [Arena]
});
