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
    const ct = this.textures.createCanvas('ground', 256, 256);
    const c = ct.context;
    c.fillStyle = '#171c22'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) { // ruido fino (granulos)
      const a = 0.03 + Math.random() * 0.09;
      c.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a + 0.05})`;
      c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    for (let i = 0; i < 40; i++) { // mottling amplo (variacao tonal)
      const r = 20 + Math.random() * 40;
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
      c.beginPath(); c.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2); c.fill();
    }
    ct.refresh();
    this.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'ground').setOrigin(0).setDepth(0);

    // Pedras decorativas (sem colisao; textura do chao via elipses)
    for (let i = 0; i < 36; i++) {
      const sx = 60 + Math.random() * (WORLD_W - 120), sy = 60 + Math.random() * (WORLD_H - 120);
      const sw = 18 + Math.random() * 34, sh = 8 + Math.random() * 12;
      this.add.ellipse(sx, sy, sw, sh, 0x2a323d, 0.55).setDepth(0);
      this.add.ellipse(sx - sw * 0.12, sy - sh * 0.18, sw * 0.6, sh * 0.45, 0x38424f, 0.5).setDepth(0);
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

    // 3 inimigos com comportamentos distintos (mesma arte; diferem tint/comportamento).
    this.enemies = [];
    const spawns = [
      { x: 1500, y: 800,  tint: 0xff8a8a, behavior: 'chaser',  hp: 60, side: 1  },
      { x: 600,  y: 600,  tint: 0xffb86a, behavior: 'flanker', hp: 50, side: 1  },
      { x: 1800, y: 1200, tint: 0xc9a6ff, behavior: 'stalker', hp: 80, side: -1 },
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
    pg.fillStyle(0xd5f5e3, 1); pg.fillRect(9, 5, 6, 14); pg.fillRect(4, 10, 16, 5);
    pg.generateTexture('potion', 24, 24); pg.destroy();
    for (const [px, py] of [[500, 1200], [1900, 600]]) {
      const ps = this.add.sprite(px, py, 'potion').setScale(1.2).setDepth(1);
      this.potions.push(ps);
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
    this._hud = { hp: -1, ehp: -1, dodge: -1 };
    this.over = false;

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

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
    this.joyGfx = this.add.graphics().setDepth(11).setScrollFactor(0);
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
      .setOrigin(0).setDepth(10).setScrollFactor(0).setInteractive().on('pointerdown', () => { this.touchAttack = true; });
    this.btnDodge = this.add.text(p0.x, p0.y2, 'ESQ', style)
      .setOrigin(0).setDepth(10).setScrollFactor(0).setInteractive().on('pointerdown', () => { this.touchDodge = true; });
    this.scale.on('resize', (gameSize) => {
      const p = pos(gameSize.width, gameSize.height);
      this.btnAtk.setPosition(p.x, p.y1);
      this.btnDodge.setPosition(p.x, p.y2);
      this.joyRadius = Math.max(40, Math.min(70, gameSize.width * 0.12));
    });

    // Ataque dos inimigos: por inimigo (ver update), sem timer global.
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

  hurtPlayer(dmg) {
    if (this.dodging || this.over) return;
    this.hp -= dmg;
    this.floatText(this.player.x, this.player.y, `-${dmg}`, '#ff6b6b', 22);
    this.damageVignette();
    this.cameras.main.shake(100, 0.0045);
    if (this.hp <= 0) this.showEnd('DERROTA');
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
          e.s.setVelocity(0, 0); e.s.clearTint(); e.s.setAlpha(0.35);
          this.sparks(e.s.x, e.s.y, e.tint || 0xffffff, 14, 70);
          if (e.behavior === 'boss') this.cameras.main.flash(120, 255, 220, 180);
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

    // Chefe ativa quando todos os outros inimigos caem.
    if (this.boss && this.boss.dormant && this.enemies.filter((e) => e !== this.boss).every((e) => e.hp <= 0)) {
      const b = this.boss;
      b.dormant = false; b.alerted = true; b.state = 'approach'; b.stateT = 1.5;
      b.s.setPosition(1200, 300).setVisible(true);
      b.barBg.setVisible(true); b.barFg.setVisible(true);
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
        continue;
      }
      if (e.behavior === 'chaser') {
        // Persegue em linha reta; ataca de perto.
        if (d > 55) { vx = Math.cos(ang) * BK.chaseSpeed; vy = Math.sin(ang) * BK.chaseSpeed; }
        if (d < 75 && e.atkCd <= 0) { this.hurtPlayer(BK.chaseDmg); e.atkCd = BK.chaseCd; }
      } else if (e.behavior === 'flanker') {
        // Circula o jogador: soma tangente ao vetor de perseguicao.
        if (d > 60) {
          const pa = ang + Math.PI / 2 * e.side;
          vx = (Math.cos(ang) + Math.cos(pa) * 0.7) * 70;
          vy = (Math.sin(ang) + Math.sin(pa) * 0.7) * 70;
          const m = Math.hypot(vx, vy) || 1;
          vx = (vx / m) * BK.flankSpeed; vy = (vy / m) * BK.flankSpeed;
        }
        if (d < 75 && e.atkCd <= 0) { this.hurtPlayer(BK.flankDmg); e.atkCd = BK.flankCd; }
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
          if (e.pattern === 'charge') { e.ax = Math.cos(ang); e.ay = Math.sin(ang); } // mira ate o fim
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
              if (d < 150) this.hurtPlayer(20);
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
          if (d < 60 && !e.hitOnce) { e.hitOnce = true; this.hurtPlayer(18); this.cameras.main.shake(120, 0.006); }
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
          if (e.stateT <= 0) { e.state = 'dash'; e.stateT = 0.35; e.s.clearTint(); }
          showWalk = false;
        } else if (e.state === 'dash') {
          vx = Math.cos(ang) * BK.dashSpeed; vy = Math.sin(ang) * BK.dashSpeed;
          if (d < 60 && e.atkCd <= 0) { this.hurtPlayer(BK.stalkerDmg); e.atkCd = BK.stalkerCd; }
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
    }

    // Sombras dinamicas sob os personagens (pes a ~+52 px abaixo do centro).
    this.shadowFx.clear();
    this.shadowFx.fillStyle(0x000000, 0.32);
    this.shadowFx.fillEllipse(this.player.x, this.player.y + 52, 48, 15);
    for (const e of this.enemies) {
      if (e.hp > 0) this.shadowFx.fillEllipse(e.s.x, e.s.y + 52, 48, 15);
    }

    // Pocao: coleta por distancia (ignora o offset dos pes do corpo fisico).
    for (let i = this.potions.length - 1; i >= 0; i--) {
      const ps = this.potions[i];
      ps.setScale(1.2 + Math.sin(time * 0.006 + ps.x) * 0.12); // pulsacao
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, ps.x, ps.y) < 40) {
        this.hp = Math.min(100, this.hp + POTION_HEAL);
        ps.destroy();
        this.potions.splice(i, 1);
      }
    }

    // Vitoria: todos os inimigos derrotados. Tempo registrado e recorde salvo.
    if (this.enemies.every((e) => e.hp <= 0)) {
      this.elapsed = this.time.now - this.startedAt;
      const best = Number(localStorage.getItem('pocBestMs')) || 0;
      if (!best || this.elapsed < best) localStorage.setItem('pocBestMs', String(Math.round(this.elapsed)));
      this.showEnd('VITÓRIA!', `Tempo ${fmtTime(this.elapsed)} · Recorde ${fmtTime(!best || this.elapsed < best ? this.elapsed : best)}`);
      return;
    }

    // HUD: escreve no DOM apenas quando muda (evita layout/repaint a 60 fps).
    this.elapsed = this.time.now - this.startedAt;
    const hpTxt = `Mago HP ${Math.max(0, this.hp)}`;
    const ehpTxt = `Abates ${this.kills}/${this.enemies.length} · ${fmtTime(this.elapsed)} · Poções ${this.potions.length}`;
    const dodgePct = Math.round((1 - this.dodgeCd / 0.8) * 100);
    if (this._hud.hp !== this.hp) { this._hud.hp = this.hp; document.getElementById('hp').textContent = hpTxt; }
    if (this._hud.ehp !== ehpTxt) { this._hud.ehp = ehpTxt; document.getElementById('ehp').textContent = ehpTxt; }
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
