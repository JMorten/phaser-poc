# Phaser POC — Action RPG (protótipo independente)

> Protótipo independente de **Phaser 4.2.1** — **não é o A Última Lua** e não compartilha código com o jogo original. Sprites 3D pré-renderizados (pipeline Blender) — 128 quadros (walk/attack/dodge × 8 direções).

## Jogar

**Online:** https://jmorten.github.io/phaser-poc/
**Local:** sirva a pasta (`python -m http.server 8099`) e abra `http://127.0.0.1:8099`

## Controles

- **WASD / setas** — mover (8 direções)
- **J** — ataque (setor frontal visível)
- **K** — esquiva (dash)
- **Touch (iPhone)** — joystick na metade esquerda + botões ATK/ESQ; multi-toque simultâneo

## Conteúdo

Mapa 2400×1800, 3 inimigos com patrulha/aggro e comportamentos próprios (chaser, flanker, stalker), poções de vida, telas de VITÓRIA/DERROTA (reinicia com R ou toque).
