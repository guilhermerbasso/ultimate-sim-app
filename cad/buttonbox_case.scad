/**
 * Button Box V2 — Caixa 3D
 * Projeto P2.3 — Guilherme Basso / iRacing SimRacing DIY
 *
 * Dimensões: 200 x 120 x 40mm
 * Material: PETG
 * Impressora: Bambu A1
 * Tempo estimado: ~4 horas
 *
 * Conteúdo:
 *   - Tampa superior: 6 furos para encoders + janela OLED
 *   - Base inferior: slot USB + 4 furos M3 para parafusos de fechamento
 *   - Paredes: 3mm de espessura
 */

// ─── Parâmetros globais ──────────────────────────────────────────────────────
box_w  = 200;   // Largura (eixo X)
box_d  = 120;   // Profundidade (eixo Y)
box_h  = 40;    // Altura total (eixo Z)
wall   = 3;     // Espessura das paredes
base_h = 2;     // Espessura da base inferior
lid_h  = 2;     // Espessura da tampa superior

// Parâmetros de fechamento
lid_lip    = 1.5;   // Profundidade do encaixe tampa/base
fit_gap    = 0.3;   // Folga para impressão (tolerância)

// ─── Encoders ────────────────────────────────────────────────────────────────
enc_d     = 7.2;    // Diâmetro do furo do eixo EC11 (7mm + 0.2 tolerância)
enc_rows  = 2;      // 2 linhas de encoders
enc_cols  = 3;      // 3 encoders por linha
enc_y_offset = 35;  // Distância do centro ao topo (eixo Y)
enc_y_step   = 50;  // Passo entre linhas
enc_x_start  = 40;  // X do primeiro encoder
enc_x_step   = 60;  // Passo entre colunas (60mm = 6cm entre centros)

// ─── OLED ─────────────────────────────────────────────────────────────────────
oled_w    = 28;     // Largura da janela de visualização
oled_h    = 16;     // Altura da janela de visualização
oled_x    = box_w - 45;  // Canto direito, 45mm da borda
oled_y    = 15;           // 15mm da borda superior

// ─── USB ──────────────────────────────────────────────────────────────────────
usb_w     = 12;    // Largura do slot USB Micro-B
usb_h     = 8;     // Altura do slot USB
usb_z     = base_h + 5;  // Posição Z do slot na parede

// ─── Parafusos M3 ─────────────────────────────────────────────────────────────
m3_d         = 3.4;   // Diâmetro do furo M3 passante (3mm + 0.4)
m3_head_d    = 6.5;   // Diâmetro da cabeça M3
m3_head_h    = 2.5;   // Profundidade da caixa da cabeça
corner_inset = 8;     // Distância dos furos das quinas à borda

// ─── Módulos ─────────────────────────────────────────────────────────────────

/**
 * Posições dos 4 furos de parafuso (quinas)
 */
function corner_positions() = [
  [corner_inset, corner_inset],
  [box_w - corner_inset, corner_inset],
  [box_w - corner_inset, box_d - corner_inset],
  [corner_inset, box_d - corner_inset]
];

/**
 * Coluna/pilar interno para prender parafuso
 * Altura total - tampas
 */
module screw_post(x, y) {
  post_h = box_h - lid_h - base_h;
  translate([x, y, base_h])
    difference() {
      cylinder(h = post_h, d = m3_head_d + 4, $fn = 32);
      cylinder(h = post_h + 1, d = m3_d, $fn = 32);
    }
}

/**
 * Base inferior da caixa
 */
module base() {
  difference() {
    union() {
      // Placa base
      cube([box_w, box_d, base_h]);

      // Paredes laterais (altura = box_h - tampa)
      wall_h = box_h - lid_h;
      // Parede frontal (y=0)
      translate([0, 0, 0])
        cube([box_w, wall, wall_h]);
      // Parede traseira (y=box_d-wall)
      translate([0, box_d - wall, 0])
        cube([box_w, wall, wall_h]);
      // Parede esquerda (x=0)
      translate([0, 0, 0])
        cube([wall, box_d, wall_h]);
      // Parede direita (x=box_w-wall)
      translate([box_w - wall, 0, 0])
        cube([wall, box_d, wall_h]);

      // Rebaixo (lábio) interno para encaixe da tampa
      translate([wall, wall, wall_h - lid_lip])
        difference() {
          cube([box_w - 2*wall, box_d - 2*wall, lid_lip + base_h]);
          translate([fit_gap, fit_gap, -1])
            cube([box_w - 2*wall - 2*fit_gap,
                  box_d - 2*wall - 2*fit_gap,
                  lid_lip + base_h + 2]);
        }

      // Pilares de parafuso nos 4 cantos
      for (pos = corner_positions())
        screw_post(pos[0], pos[1]);
    }

    // Slot USB na parede frontal (y=0)
    translate([wall + 15, -1, usb_z])
      cube([usb_w, wall + 2, usb_h]);
  }
}

/**
 * Tampa superior com furos para encoders, OLED e parafusos
 */
module lid() {
  difference() {
    union() {
      // Placa da tampa
      cube([box_w, box_d, lid_h]);

      // Lábio de encaixe (saliente para baixo)
      translate([wall + fit_gap, wall + fit_gap, -lid_lip])
        cube([box_w - 2*wall - 2*fit_gap,
              box_d - 2*wall - 2*fit_gap,
              lid_lip]);
    }

    // ── Furos dos 6 encoders ─────────────────────────────────────────────
    for (row = [0 : enc_rows - 1])
      for (col = [0 : enc_cols - 1]) {
        enc_x = enc_x_start + col * enc_x_step;
        enc_y = enc_y_offset + row * enc_y_step;
        translate([enc_x, enc_y, -1])
          cylinder(h = lid_h + 2, d = enc_d, $fn = 32);
      }

    // ── Janela do OLED ───────────────────────────────────────────────────
    translate([oled_x, oled_y, -1])
      cube([oled_w, oled_h, lid_h + 2]);

    // ── Furos M3 passantes nos cantos (para os pilares da base) ──────────
    for (pos = corner_positions())
      translate([pos[0], pos[1], -1]) {
        // Furo passante
        cylinder(h = lid_h + 2, d = m3_d, $fn = 32);
        // Rebaixo para cabeça do parafuso
        cylinder(h = m3_head_h + 1, d = m3_head_d, $fn = 32);
      }
  }
}

// ─── Renderização ─────────────────────────────────────────────────────────────
// Para exportar STL, descomente apenas UM dos módulos abaixo
// e use File > Export > Export as STL

// Opção 1: Visualização completa (explodida)
translate([0, 0, 0])
  color("SteelBlue", 0.85) base();

translate([0, 0, box_h + 5])   // +5 = explosão visual
  color("LightSteelBlue", 0.85) lid();

// Opção 2: Apenas base (para exportar base.stl)
// base();

// Opção 3: Apenas tampa (para exportar lid.stl)
// lid();
