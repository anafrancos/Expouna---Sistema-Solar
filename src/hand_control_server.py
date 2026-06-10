# ─────────────────────────────────────────────────────────────
# hand_control_server.py — Solar Explorer · Hand Tracking Server
# ─────────────────────────────────────────────────────────────
import asyncio, json, urllib.request, os, math
import cv2, numpy as np, mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import websockets, threading
from collections import deque

# ─────────────────────────────────────────────
# Configurações
# ─────────────────────────────────────────────
PORTA_WS      = 8765
INDICE_CAMERA = 0
LARGURA_CAM   = 640
ALTURA_CAM    = 480
NOME_JANELA   = 'Solar Explorer — Hand Tracking'

INERCIA_DECAY     = 0.88
INERCIA_THRESHOLD = 0.012
TRAIL_LEN         = 40

CTRL_CX    = 0.75
CTRL_CY    = 0.50
CTRL_RAIO  = 0.28
ZONA_MORTA = 0.06

URL_MODELO = (
    'https://storage.googleapis.com/mediapipe-models/'
    'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
)
_dir = os.path.dirname(os.path.abspath(__file__))
_candidatos = [
    os.path.join(_dir, 'hand_landmarker.task'),
    r'C:\mediapipe_models\hand_landmarker.task',
    '/tmp/hand_landmarker.task',
]
CAMINHO_MODELO = next((p for p in _candidatos if os.path.exists(p)), _candidatos[0])

# ─────────────────────────────────────────────
# Estado global
# ─────────────────────────────────────────────
payload_atual = {'followShip': True}
trava_payload = threading.Lock()
clientes_ws   = []
trava_cli     = threading.Lock()
ultimo_result = None
trava_res     = threading.Lock()

# ─────────────────────────────────────────────
# Modelo
# ─────────────────────────────────────────────
def garantir_modelo():
    os.makedirs(os.path.dirname(os.path.abspath(CAMINHO_MODELO)), exist_ok=True)
    if not os.path.exists(CAMINHO_MODELO):
        print(f'[MODELO] Baixando (~20 MB) → {CAMINHO_MODELO}')
        urllib.request.urlretrieve(URL_MODELO, CAMINHO_MODELO)
        print('[MODELO] Concluido.')
    else:
        print(f'[MODELO] Usando: {CAMINHO_MODELO}')

# ─────────────────────────────────────────────
# Helpers de gesto
# ─────────────────────────────────────────────
def mao_aberta(pts):
    pontas = [8, 12, 16, 20]
    bases  = [6, 10, 14, 18]
    return sum(1 for p, b in zip(pontas, bases) if pts[p].y < pts[b].y) >= 3

def polegar_para_cima(pts):
    polegar_ok = pts[4].y < pts[2].y - 0.04
    pontas = [8, 12, 16, 20]
    bases  = [6, 10, 14, 18]
    dobrados = sum(1 for p, b in zip(pontas, bases) if pts[p].y > pts[b].y)
    return polegar_ok and dobrados >= 3

def centro_palma(pts):
    idxs = [0, 5, 9, 13, 17]
    x = sum(pts[i].x for i in idxs) / len(idxs)
    y = sum(pts[i].y for i in idxs) / len(idxs)
    return x, y

def calcular_joystick(cx_norm, cy_norm,
                      centro_x=CTRL_CX, centro_y=CTRL_CY,
                      raio=CTRL_RAIO, zona=ZONA_MORTA):
    aspect = LARGURA_CAM / ALTURA_CAM
    dx = (cx_norm - centro_x) / raio
    dy = (cy_norm - centro_y) / (raio / aspect)
    dist = math.hypot(dx, dy)
    if dist < zona:
        return 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    dist_clamp = min(dist, 1.0)
    t = (dist_clamp - zona) / (1.0 - zona)
    intensidade = t ** 1.4
    angulo = math.degrees(math.atan2(dy, dx))
    ux = dx / dist
    uy = dy / dist
    sinal_h = 1.0 if ux >= 0 else -1.0
    sinal_v = 1.0 if uy >= 0 else -1.0
    int_h   = abs(ux) * intensidade
    int_v   = abs(uy) * intensidade
    return sinal_h, int_h, sinal_v, int_v, dist_clamp, angulo

def zona_morta_progressiva(v, centro=0.5, zona=ZONA_MORTA):
    d = v - centro
    if abs(d) < zona * 0.5:
        return 0.0, 0.0
    sinal = 1.0 if d > 0 else -1.0
    intensidade = min((abs(d) - zona * 0.5) / (0.5 - zona * 0.5), 1.0) ** 1.4
    return sinal, intensidade

def normal_palma(pts):
    p0  = np.array([pts[0].x,  pts[0].y,  pts[0].z])
    p5  = np.array([pts[5].x,  pts[5].y,  pts[5].z])
    p17 = np.array([pts[17].x, pts[17].y, pts[17].z])
    n   = np.cross(p5 - p0, p17 - p0)
    nm  = np.linalg.norm(n)
    return tuple(float(x) for x in (n / nm if nm > 1e-6 else [0, 0, 1]))

def angulos_palma(pts):
    nx, ny, nz = normal_palma(pts)
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, -ny))))
    yaw   = math.degrees(math.atan2(nx, nz))
    return pitch, yaw

# ─────────────────────────────────────────────
# Paleta de cores
# ─────────────────────────────────────────────
CONEXOES = [
    (0,1),(1,2),(2,3),(3,4),
    (0,5),(5,6),(6,7),(7,8),
    (0,9),(9,10),(10,11),(11,12),
    (0,13),(13,14),(14,15),(15,16),
    (0,17),(17,18),(18,19),(19,20),
    (5,9),(9,13),(13,17),
]

COR_ABERTA  = (57,  255, 137)   # verde
COR_FECHADA = (60,   60, 255)   # vermelho-azul
COR_TURBO   = (0,   200, 255)   # ciano
COR_DIR     = (255, 160,  30)   # laranja
COR_TRAIL_D = (255, 140,  20)
COR_TRAIL_E = (40,  200, 100)
COR_PRETO   = (0, 0, 0)
COR_BRANCO  = (255, 255, 255)

# ─────────────────────────────────────────────
# Utilitário: texto com fundo sólido legível
# ─────────────────────────────────────────────
def texto(frame, txt, pos, escala=0.45, cor=COR_BRANCO, espessura=1,
          fundo=True, cor_fundo=(0, 0, 0), padding=4):
    """Desenha texto com caixa de fundo para garantir legibilidade."""
    fonte = cv2.FONT_HERSHEY_SIMPLEX
    (tw, th), bl = cv2.getTextSize(txt, fonte, escala, espessura)
    x, y = pos
    if fundo:
        overlay = frame.copy()
        cv2.rectangle(overlay,
                      (x - padding, y - th - padding),
                      (x + tw + padding, y + bl + padding),
                      cor_fundo, -1)
        cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
    cv2.putText(frame, txt, (x, y), fonte, escala, cor, espessura, cv2.LINE_AA)

def texto_centrado(frame, txt, cy, escala=0.5, cor=COR_BRANCO, espessura=1,
                   cor_fundo=(0,0,0), padding=6):
    """Texto horizontalmente centralizado com fundo."""
    fonte = cv2.FONT_HERSHEY_SIMPLEX
    (tw, th), bl = cv2.getTextSize(txt, fonte, escala, espessura)
    w = frame.shape[1]
    x = (w - tw) // 2
    y = cy
    overlay = frame.copy()
    cv2.rectangle(overlay,
                  (x - padding, y - th - padding),
                  (x + tw + padding, y + bl + padding),
                  cor_fundo, -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
    cv2.rectangle(frame,
                  (x - padding, y - th - padding),
                  (x + tw + padding, y + bl + padding),
                  cor, 1)
    cv2.putText(frame, txt, (x, y), fonte, escala, cor, espessura, cv2.LINE_AA)

# ─────────────────────────────────────────────
# Landmarks
# ─────────────────────────────────────────────
def cor_mao(gesto, e_direcao=False):
    if e_direcao:          return COR_DIR
    if gesto == 'TURBO':   return COR_TURBO
    if gesto == 'ABERTA':  return COR_ABERTA
    return COR_FECHADA

def desenhar_landmarks(frame, pts, gesto, lado_real, w, h,
                       e_direcao=False, intensidade=0.0):
    cor   = cor_mao(gesto, e_direcao)
    thick = max(1, int(1 + intensidade * 3))

    # ── Conexões ──
    for a, b in CONEXOES:
        x1, y1 = int(pts[a].x * w), int(pts[a].y * h)
        x2, y2 = int(pts[b].x * w), int(pts[b].y * h)
        # Sombra fina para destacar sobre fundo claro
        cv2.line(frame, (x1,y1), (x2,y2), COR_PRETO, thick + 2, cv2.LINE_AA)
        cv2.line(frame, (x1,y1), (x2,y2), cor,       thick,     cv2.LINE_AA)

    # ── Pontos dos landmarks ──
    for i, pt in enumerate(pts):
        cx_, cy_ = int(pt.x * w), int(pt.y * h)
        r = max(3, int(3 + intensidade * 4))
        # Ponta dos dedos: maior destaque
        if i in (4, 8, 12, 16, 20):
            cv2.circle(frame, (cx_, cy_), r + 2, COR_PRETO, -1, cv2.LINE_AA)
            cv2.circle(frame, (cx_, cy_), r + 2, COR_BRANCO, 1, cv2.LINE_AA)
            cv2.circle(frame, (cx_, cy_), r,     cor,        -1, cv2.LINE_AA)
        else:
            cv2.circle(frame, (cx_, cy_), r,     COR_PRETO,  -1, cv2.LINE_AA)
            cv2.circle(frame, (cx_, cy_), r,     cor,         1, cv2.LINE_AA)

    # ── Círculo na palma ──
    px, py    = centro_palma(pts)
    pcx, pcy  = int(px * w), int(py * h)
    raio_p    = max(14, int(14 + intensidade * 10))
    cv2.circle(frame, (pcx, pcy), raio_p + 2, COR_PRETO, 2, cv2.LINE_AA)
    cv2.circle(frame, (pcx, pcy), raio_p,     cor,        2, cv2.LINE_AA)

    # ── Tag da mão — acima da palma com fundo legível ──
    if e_direcao:
        tag = 'DIR  DIRECAO'
    else:
        mapa = {'ABERTA': 'ESQ  FRENTE', 'FECHADA': 'ESQ  RE', 'TURBO': 'ESQ  TURBO'}
        tag  = mapa.get(gesto, f'ESQ  {gesto}')

    texto(frame, tag,
          (pcx - 52, pcy - raio_p - 10),
          escala=0.44, cor=cor, espessura=2,
          cor_fundo=(0, 0, 0))

# ─────────────────────────────────────────────
# Ângulo 3D da palma — redesenhado com mais clareza
# ─────────────────────────────────────────────
def desenhar_angulo_3d(frame, pts, w, h, e_direcao=False):
    px, py = centro_palma(pts)
    cx     = int(px * w)
    cy     = int(py * h)

    nx, ny, nz = normal_palma(pts)
    pitch, yaw = angulos_palma(pts)
    cor        = COR_DIR if e_direcao else COR_ABERTA

    # ── Seta do vetor normal ──
    escala = 70
    ex = int(cx + nx * escala)
    ey = int(cy - ny * escala)
    # Sombra
    cv2.arrowedLine(frame, (cx, cy), (ex, ey), COR_PRETO, 5,
                    tipLength=0.28, line_type=cv2.LINE_AA)
    # Seta colorida
    cv2.arrowedLine(frame, (cx, cy), (ex, ey), COR_BRANCO, 2,
                    tipLength=0.28, line_type=cv2.LINE_AA)
    cv2.arrowedLine(frame, (cx, cy), (ex, ey), cor,        2,
                    tipLength=0.28, line_type=cv2.LINE_AA)

    # ── Linha base dos dedos (indica orientação da palma) ──
    x5,  y5  = int(pts[5].x * w),  int(pts[5].y * h)
    x17, y17 = int(pts[17].x * w), int(pts[17].y * h)
    cv2.line(frame, (x5, y5), (x17, y17), (160, 160, 50), 1, cv2.LINE_AA)

    # ── Texto pitch/yaw com fundo ──
    txt_angulo = f'P:{pitch:+.0f}  Y:{yaw:+.0f}'
    texto(frame, txt_angulo,
          (cx - 38, cy + 44),
          escala=0.40, cor=cor, espessura=1,
          cor_fundo=(0, 0, 0))

# ─────────────────────────────────────────────
# Trail de trajetória
# ─────────────────────────────────────────────
trail_direita  = deque(maxlen=TRAIL_LEN)
trail_esquerda = deque(maxlen=TRAIL_LEN)

def atualizar_trail(lado, cx_norm, cy_norm, w, h):
    px, py = int(cx_norm * w), int(cy_norm * h)
    (trail_direita if lado == 'Right' else trail_esquerda).append((px, py))

def desenhar_trail(frame):
    for trail, cor_base in [(trail_direita, COR_TRAIL_D),
                             (trail_esquerda, COR_TRAIL_E)]:
        pts_t = list(trail)
        n     = len(pts_t)
        for i in range(1, n):
            alpha = i / n
            thick = max(1, int(alpha * 3))
            cor   = tuple(int(c * alpha) for c in cor_base)
            cv2.line(frame, pts_t[i-1], pts_t[i], cor, thick, cv2.LINE_AA)
        if pts_t:
            cv2.circle(frame, pts_t[-1], 5, cor_base, -1, cv2.LINE_AA)
            cv2.circle(frame, pts_t[-1], 5, COR_BRANCO, 1, cv2.LINE_AA)

def limpar_trail(lado):
    (trail_direita if lado == 'Right' else trail_esquerda).clear()

# ─────────────────────────────────────────────
# Círculo de controle (joystick visual)
# ─────────────────────────────────────────────
def desenhar_circulo_controle(frame, cx_norm, cy_norm,
                               sinal_h, int_h, sinal_v, int_v,
                               dist_norm, angulo_deg, w, h):
    ocx    = int(CTRL_CX * w)
    ocy    = int(CTRL_CY * h)
    raio_px = int(CTRL_RAIO * w)
    ativo   = dist_norm > ZONA_MORTA

    # ── Fundo translúcido ──
    overlay = frame.copy()
    cv2.circle(overlay, (ocx, ocy), raio_px, (0, 8, 25), -1)
    cv2.addWeighted(overlay, 0.38, frame, 0.62, 0, frame)

    # ── Divisões em 8 setores (como um joystick real) ──
    for ang_setor in range(0, 360, 45):
        rad = math.radians(ang_setor)
        ex  = int(ocx + raio_px * math.cos(rad))
        ey  = int(ocy + raio_px * math.sin(rad))
        cv2.line(frame, (ocx, ocy), (ex, ey), (30, 40, 60), 1, cv2.LINE_AA)

    # ── Círculos concêntricos de referência (25%, 50%, 75%, 100%) ──
    for frac, cor_anel in [
        (0.25, (30, 40, 55)),
        (0.50, (40, 55, 75)),
        (0.75, (55, 70, 95)),
        (1.00, COR_DIR if ativo else (60, 65, 85)),
    ]:
        r = int(raio_px * frac)
        thick = 2 if frac == 1.0 else 1
        cv2.circle(frame, (ocx, ocy), r, cor_anel, thick, cv2.LINE_AA)

    # ── Zona morta ──
    raio_zm = max(4, int(ZONA_MORTA * raio_px))
    cv2.circle(frame, (ocx, ocy), raio_zm, (80, 80, 60), 1, cv2.LINE_AA)

    # ── Cruz central ──
    cv2.line(frame, (ocx - raio_px, ocy), (ocx + raio_px, ocy), (35, 45, 65), 1, cv2.LINE_AA)
    cv2.line(frame, (ocx, ocy - raio_px), (ocx, ocy + raio_px), (35, 45, 65), 1, cv2.LINE_AA)

    # ── Arco de intensidade preenchido ──
    if ativo:
        mag      = math.hypot(int_h, int_v)
        ang_arco = int(mag * 360)
        cv2.ellipse(frame, (ocx, ocy), (raio_px - 5, raio_px - 5),
                    -90, 0, ang_arco, COR_DIR, 3, cv2.LINE_AA)

    # ── Setas de direção com intensidade proporcional ──
    comp = int(raio_px * 0.62)
    if int_h > 0.05:
        dx  = int(comp * int_h) * (1 if sinal_h > 0 else -1)
        cv2.arrowedLine(frame, (ocx, ocy), (ocx + dx, ocy),
                        COR_DIR, max(1, int(int_h * 4)),
                        tipLength=0.35, line_type=cv2.LINE_AA)
    if int_v > 0.05:
        dy  = int(comp * int_v) * (1 if sinal_v > 0 else -1)
        cv2.arrowedLine(frame, (ocx, ocy), (ocx, ocy + dy),
                        COR_DIR, max(1, int(int_v * 4)),
                        tipLength=0.35, line_type=cv2.LINE_AA)

    # ── Ponto da palma dentro do círculo ──
    aspect  = LARGURA_CAM / ALTURA_CAM
    dx_vis  = (cx_norm - CTRL_CX) / CTRL_RAIO * raio_px
    dy_vis  = (cy_norm - CTRL_CY) / (CTRL_RAIO / aspect) * raio_px
    mag_vis = math.hypot(dx_vis, dy_vis)
    if mag_vis > raio_px:
        dx_vis = dx_vis / mag_vis * raio_px
        dy_vis = dy_vis / mag_vis * raio_px
    px_p = int(ocx + dx_vis)
    py_p = int(ocy + dy_vis)

    # Linha do centro ao ponto
    cv2.line(frame, (ocx, ocy), (px_p, py_p), (*COR_DIR[:3],), 1, cv2.LINE_AA)
    # Ponto: cor muda com a intensidade
    cor_ponto = COR_TURBO if dist_norm > 0.8 else (COR_DIR if ativo else (90, 90, 110))
    cv2.circle(frame, (px_p, py_p), 12, COR_PRETO,  -1, cv2.LINE_AA)
    cv2.circle(frame, (px_p, py_p), 10, cor_ponto,  -1, cv2.LINE_AA)
    cv2.circle(frame, (px_p, py_p), 10, COR_BRANCO,  1, cv2.LINE_AA)

    # ── Labels de direção nos 4 eixos com fundo ──
    offs = raio_px - 14
    texto(frame, 'D', (ocx + offs, ocy + 5),  escala=0.42, cor=(80,110,140), fundo=False)
    texto(frame, 'E', (ocx - offs - 12, ocy + 5), escala=0.42, cor=(80,110,140), fundo=False)
    texto(frame, '^', (ocx - 5, ocy - offs + 8),  escala=0.5,  cor=(80,110,140), fundo=False)
    texto(frame, 'v', (ocx - 5, ocy + offs + 4),  escala=0.5,  cor=(80,110,140), fundo=False)

    # ── Intensidade % abaixo do círculo ──
    pct = int(math.hypot(int_h, int_v) * 100)
    cor_pct = COR_DIR if ativo else (60, 60, 80)
    texto(frame, f'{pct}%',
          (ocx - 14, ocy + raio_px + 20),
          escala=0.48, cor=cor_pct,
          cor_fundo=(0, 0, 0))

    # ── Label "JOYSTICK DIR" acima ──
    texto(frame, 'JOYSTICK DIR',
          (ocx - 42, ocy - raio_px - 10),
          escala=0.40, cor=(100, 130, 160),
          cor_fundo=(0, 5, 15))

# ─────────────────────────────────────────────
# Mini-mapa das palmas
# ─────────────────────────────────────────────
def desenhar_minimap(frame, maos, w, h):
    mm_w, mm_h = 150, 120
    mm_x = w - mm_w - 12
    mm_y = 62          # abaixo do HUD topo
    pad  = 14

    # Fundo
    overlay = frame.copy()
    cv2.rectangle(overlay, (mm_x, mm_y), (mm_x+mm_w, mm_y+mm_h), (0, 6, 20), -1)
    cv2.addWeighted(overlay, 0.85, frame, 0.15, 0, frame)
    cv2.rectangle(frame, (mm_x, mm_y), (mm_x+mm_w, mm_y+mm_h), (50, 100, 170), 1)

    # Título
    texto(frame, 'POSICAO MAOS',
          (mm_x + 8, mm_y + 14),
          escala=0.36, cor=(90, 140, 200), fundo=False)

    # Área útil do mapa
    ax0 = mm_x + pad
    ay0 = mm_y + 22
    ax1 = mm_x + mm_w - pad
    ay1 = mm_y + mm_h - pad
    aw  = ax1 - ax0
    ah  = ay1 - ay0

    # Grade de fundo suave
    cv2.rectangle(frame, (ax0, ay0), (ax1, ay1), (20, 28, 45), -1)
    # Grade 3×3
    for gi in range(1, 3):
        gx = ax0 + aw * gi // 3
        gy = ay0 + ah * gi // 3
        cv2.line(frame, (gx, ay0), (gx, ay1), (30, 40, 60), 1)
        cv2.line(frame, (ax0, gy), (ax1, gy), (30, 40, 60), 1)

    # Ponto central
    cx_m = (ax0 + ax1) // 2
    cy_m = (ay0 + ay1) // 2
    cv2.drawMarker(frame, (cx_m, cy_m), (50, 60, 80), cv2.MARKER_CROSS, 10, 1)

    # Zona morta no mapa
    raio_zm_mm = int(ZONA_MORTA * aw // 2)
    cv2.circle(frame, (cx_m, cy_m), raio_zm_mm, (70, 70, 50), 1, cv2.LINE_AA)

    for lado, info in maos.items():
        cx_n, cy_n = info['cx'], info['cy']
        px_m = ax0 + int(cx_n * aw)
        py_m = ay0 + int(cy_n * ah)
        px_m = max(ax0 + 6, min(ax1 - 6, px_m))
        py_m = max(ay0 + 6, min(ay1 - 6, py_m))

        cor = COR_DIR if lado == 'Right' else cor_mao(info['gesto'])
        label_letra = 'D' if lado == 'Right' else 'E'

        # Sombra
        cv2.circle(frame, (px_m, py_m), 9, COR_PRETO,  -1, cv2.LINE_AA)
        cv2.circle(frame, (px_m, py_m), 8, cor,        -1, cv2.LINE_AA)
        cv2.circle(frame, (px_m, py_m), 8, COR_BRANCO,  1, cv2.LINE_AA)
        cv2.putText(frame, label_letra, (px_m - 4, py_m + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, COR_PRETO, 1, cv2.LINE_AA)

    # Legenda compacta abaixo
    texto(frame, 'D=direcao  E=aceleracao',
          (mm_x + 6, mm_y + mm_h + 14),
          escala=0.32, cor=(70, 90, 110), fundo=False)

# ─────────────────────────────────────────────
# Barras de status
# ─────────────────────────────────────────────
def barra(frame, x, y, w_b, h_b, valor, vmin, vmax, cor, label, negativo=False):
    frac = max(0.0, min(1.0, (valor - vmin) / max(vmax - vmin, 1e-6)))
    # Fundo
    cv2.rectangle(frame, (x, y), (x + w_b, y + h_b), (15, 18, 35), -1)
    # Preenchimento
    if negativo:
        meio  = x + w_b // 2
        fill  = int((w_b // 2) * abs(frac * 2 - 1))
        x0    = meio - fill if valor < (vmax + vmin) / 2 else meio
        cv2.rectangle(frame, (x0, y), (x0 + fill, y + h_b), cor, -1)
        # Linha central
        cv2.line(frame, (meio, y), (meio, y + h_b), (60, 70, 90), 1)
    else:
        cv2.rectangle(frame, (x, y), (x + int(w_b * frac), y + h_b), cor, -1)
    # Borda
    cv2.rectangle(frame, (x, y), (x + w_b, y + h_b), (60, 80, 110), 1)
    # Label com fundo
    texto(frame, label, (x + w_b + 6, y + h_b),
          escala=0.34, cor=(160, 185, 210), fundo=False)

def desenhar_barras_nave(frame, vel_h, vel_v, vel_frente, turbo, w, h):
    bx, by = 12, h - 160
    bw, bh = 160, 9

    # Fundo do painel de barras
    overlay = frame.copy()
    cv2.rectangle(overlay, (bx - 6, by - 18), (bx + bw + 80, by + 90), (0, 5, 18), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
    cv2.rectangle(frame, (bx - 6, by - 18), (bx + bw + 80, by + 90), (30, 45, 70), 1)
    texto(frame, 'TELEMETRIA', (bx, by - 6), escala=0.36, cor=(70, 100, 140), fundo=False)

    barra(frame, bx, by,      bw, bh, vel_h,  -1, 1, COR_DIR,
          f'H {vel_h:+.2f}', negativo=True)
    barra(frame, bx, by + 18, bw, bh, vel_v,  -1, 1, COR_DIR,
          f'V {vel_v:+.2f}', negativo=True)
    barra(frame, bx, by + 36, bw, bh, abs(vel_frente), 0, 1,
          COR_ABERTA if vel_frente >= 0 else COR_FECHADA,
          'FRENTE' if vel_frente >= 0 else 'RE   ')
    barra(frame, bx, by + 54, bw, bh,
          1.0 if turbo else 0.0, 0, 1, COR_TURBO, 'TURBO')

    # Velocímetro semicircular
    vc_x  = bx + bw // 2
    vc_y  = by + 82
    rv    = 26
    mag   = abs(vel_frente)
    cor_v = COR_TURBO if turbo else (COR_ABERTA if vel_frente >= 0 else COR_FECHADA)

    cv2.ellipse(frame, (vc_x, vc_y), (rv, rv), 0, 180, 360, (25, 28, 48), 3)
    ang_fim = int(180 + mag * 180)
    cv2.ellipse(frame, (vc_x, vc_y), (rv, rv), 0, 180, ang_fim, cor_v, 3)
    ang_rad = math.radians(180 + mag * 180)
    cv2.line(frame,
             (vc_x, vc_y),
             (int(vc_x + rv * 0.78 * math.cos(ang_rad)),
              int(vc_y + rv * 0.78 * math.sin(ang_rad))),
             cor_v, 2, cv2.LINE_AA)
    cv2.circle(frame, (vc_x, vc_y), 3, cor_v, -1, cv2.LINE_AA)
    texto(frame, f'{mag:.0%}', (vc_x - 14, vc_y + 13),
          escala=0.38, cor=cor_v, fundo=False)

def desenhar_barras_geral(frame, rotX, rotY, velocidade, w, h):
    bx, by = 12, h - 120
    bw, bh = 160, 9

    overlay = frame.copy()
    cv2.rectangle(overlay, (bx-6, by-18), (bx+bw+80, by+55), (18, 0, 20), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
    cv2.rectangle(frame, (bx-6, by-18), (bx+bw+80, by+55), (80, 30, 100), 1)
    texto(frame, 'CONTROLE', (bx, by-6), escala=0.36, cor=(120, 60, 160), fundo=False)

    barra(frame, bx, by,      bw, bh, rotY, -2.0, 2.0,
          (200, 80, 255), f'rotY {rotY:+.2f}', negativo=True)
    barra(frame, bx, by + 20, bw, bh, rotX, -1.1, 1.1,
          (200, 80, 255), f'rotX {rotX:+.2f}', negativo=True)
    barra(frame, bx, by + 40, bw, bh, velocidade, 0, 3.0,
          COR_TURBO, f'vel  {velocidade:.2f}x')

# ─────────────────────────────────────────────
# HUD topo e rodapés
# ─────────────────────────────────────────────
def hud_topo(frame, titulo, cor_titulo, n_clientes, w):
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 56), (0, 3, 14), -1)
    cv2.addWeighted(overlay, 0.82, frame, 0.18, 0, frame)
    # Linha decorativa inferior
    cv2.line(frame, (0, 56), (w, 56), (*cor_titulo, ), 1)

    cv2.putText(frame, titulo, (12, 22),
                cv2.FONT_HERSHEY_SIMPLEX, 0.58, cor_titulo, 1, cv2.LINE_AA)
    ws_cor = COR_ABERTA if n_clientes else (65, 65, 65)
    ws_txt = f'WS  {n_clientes} cliente(s)  CONECTADO' if n_clientes else 'WS  AGUARDANDO NAVEGADOR'
    cv2.putText(frame, ws_txt, (12, 44),
                cv2.FONT_HERSHEY_SIMPLEX, 0.40, ws_cor, 1, cv2.LINE_AA)

def hud_rodape_nave(frame, keys_ativas, w, h):
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, h - 42), (w, h), (0, 3, 14), -1)
    cv2.addWeighted(overlay, 0.82, frame, 0.18, 0, frame)
    cv2.line(frame, (0, h - 42), (w, h - 42), (0, 80, 120), 1)

    legenda = [
        'DIR: posicao palma = girar/subir/descer',
        'ESQ: aberta=frente  fechada=re  joinha=turbo',
    ]
    for i, txt in enumerate(legenda):
        cv2.putText(frame, txt, (12, h - 27 + i * 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.34, (120, 170, 200), 1, cv2.LINE_AA)

    # Chips de comando ativos
    nomes = {'KeyW':'FRENTE','KeyS':'RE','KeyA':'ESQ','KeyD':'DIR',
             'Space':'SOBE','ShiftLeft':'DESCE','KeyE':'TURBO'}
    x_chip = w - 8
    for k in sorted(keys_ativas, reverse=True):
        txt = nomes.get(k, k)
        (tw, _), _ = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, 0.38, 1)
        x_chip -= tw + 20
        cv2.rectangle(frame, (x_chip - 4, h - 62), (x_chip + tw + 8, h - 45),
                      (0, 45, 12), -1)
        cv2.rectangle(frame, (x_chip - 4, h - 62), (x_chip + tw + 8, h - 45),
                      COR_ABERTA, 1)
        cv2.putText(frame, txt, (x_chip, h - 48),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, COR_ABERTA, 1, cv2.LINE_AA)

def hud_rodape_geral(frame, w, h):
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, h - 28), (w, h), (18, 0, 20), -1)
    cv2.addWeighted(overlay, 0.82, frame, 0.18, 0, frame)
    cv2.line(frame, (0, h - 28), (w, h - 28), (80, 30, 100), 1)
    cv2.putText(frame,
                'DIR: rotacionar sistema solar   dist. maos: velocidade orbita',
                (12, h - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.36, (150, 100, 190), 1, cv2.LINE_AA)

# ─────────────────────────────────────────────
# Indicador de gesto (mão esquerda) — modo nave
# ─────────────────────────────────────────────
def indicador_gesto(frame, gesto_esq, w):
    mapa_txt = {
        'ABERTA':  'FRENTE',
        'FECHADA': 'RE',
        'TURBO':   'TURBO',
        None:      'SEM MAO',
    }
    mapa_cor = {
        'ABERTA':  COR_ABERTA,
        'FECHADA': COR_FECHADA,
        'TURBO':   COR_TURBO,
        None:      (55, 55, 65),
    }
    txt = mapa_txt.get(gesto_esq, '---')
    cor = mapa_cor.get(gesto_esq, (55, 55, 65))

    # Caixa centralizada
    fonte  = cv2.FONT_HERSHEY_SIMPLEX
    escala = 0.80
    thick  = 2
    (tw, th), bl = cv2.getTextSize(txt, fonte, escala, thick)
    cx_box = (w - tw) // 2
    cy_box = 90
    pad    = 8

    # Fundo com borda colorida
    overlay = frame.copy()
    cv2.rectangle(overlay,
                  (cx_box - pad - 2,  cy_box - th - pad),
                  (cx_box + tw + pad, cy_box + bl + pad),
                  (0, 6, 20), -1)
    cv2.addWeighted(overlay, 0.80, frame, 0.20, 0, frame)
    cv2.rectangle(frame,
                  (cx_box - pad - 2,  cy_box - th - pad),
                  (cx_box + tw + pad, cy_box + bl + pad),
                  cor, 2)

    # Texto
    cv2.putText(frame, txt, (cx_box, cy_box), fonte, escala, cor, thick, cv2.LINE_AA)

    # Sub-label "MAO ESQ"
    texto(frame, 'MAO ESQ',
          (cx_box, cy_box + bl + 16),
          escala=0.32, cor=(80, 100, 120), fundo=False)

# ─────────────────────────────────────────────
# Indicador modo visão geral
# ─────────────────────────────────────────────
def indicador_geral(frame, rot_x, rot_y, velocidade, tem_dir, tem_esq, w, h):
    """Painel central com status do modo visão geral."""
    px_w = 220
    px_h = 70
    px_x = (w - px_w) // 2
    px_y = 62

    overlay = frame.copy()
    cv2.rectangle(overlay, (px_x, px_y), (px_x+px_w, px_y+px_h), (18, 0, 22), -1)
    cv2.addWeighted(overlay, 0.80, frame, 0.20, 0, frame)
    cor_borda = (180, 60, 220) if (tem_dir or tem_esq) else (60, 30, 80)
    cv2.rectangle(frame, (px_x, px_y), (px_x+px_w, px_y+px_h), cor_borda, 1)

    # Título
    texto(frame, 'VISAO GERAL',
          (px_x + 8, px_y + 16),
          escala=0.40, cor=(180, 80, 220), fundo=False)

    # Status das mãos
    cor_d = COR_DIR     if tem_dir else (50, 50, 60)
    cor_e = COR_ABERTA  if tem_esq else (50, 50, 60)
    texto(frame, 'DIR: rotacao',     (px_x + 8, px_y + 34), escala=0.36, cor=cor_d, fundo=False)
    texto(frame, 'ESQ: velocidade',  (px_x + 8, px_y + 50), escala=0.36, cor=cor_e, fundo=False)

    # Valores numéricos à direita
    texto(frame, f'{rot_y:+.2f}',      (px_x + 150, px_y + 34), escala=0.38, cor=(200, 80, 255), fundo=False)
    texto(frame, f'{velocidade:.2f}x', (px_x + 150, px_y + 50), escala=0.38, cor=COR_TURBO,      fundo=False)

# ─────────────────────────────────────────────
# Callback MediaPipe
# ─────────────────────────────────────────────
def ao_detectar(resultado, imagem_saida, timestamp_ms):
    global ultimo_result
    with trava_res:
        ultimo_result = resultado

# ─────────────────────────────────────────────
# Thread de rastreamento + janela
# ─────────────────────────────────────────────
def thread_rastreamento():
    garantir_modelo()

    opcoes = mp_vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=CAMINHO_MODELO),
        running_mode=mp_vision.RunningMode.LIVE_STREAM,
        num_hands=2,
        min_hand_detection_confidence=0.6,
        min_hand_presence_confidence=0.6,
        min_tracking_confidence=0.5,
        result_callback=ao_detectar,
    )

    cap = cv2.VideoCapture(INDICE_CAMERA)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  LARGURA_CAM)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, ALTURA_CAM)
    cap.set(cv2.CAP_PROP_FPS, 30)

    if not cap.isOpened():
        print('[ERRO] Nao foi possivel abrir a webcam.')
        return

    print('[CAM]  Webcam iniciada.')
    print(f'[WIN]  Janela "{NOME_JANELA}" aberta. Q para sair.\n')
    cv2.namedWindow(NOME_JANELA, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(NOME_JANELA, LARGURA_CAM, ALTURA_CAM)

    timestamp      = 0
    inercia_h      = 0.0
    inercia_v      = 0.0
    inercia_frente = 0.0
    rot_x_acum     = 0.0
    rot_y_acum     = 0.0
    vel_acum       = 1.0

    with mp_vision.HandLandmarker.create_from_options(opcoes) as detector:
        while True:
            ok, frame = cap.read()
            if not ok:
                continue

            frame = cv2.flip(frame, 1)
            h, w  = frame.shape[:2]

            rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img_mp = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            timestamp += 33
            detector.detect_async(img_mp, timestamp)

            with trava_res:
                resultado = ultimo_result
            with trava_payload:
                modo_nave = payload_atual.get('followShip', True)

            # ── Organizar mãos ──
            maos = {}
            if resultado and resultado.hand_landmarks:
                for pts, cls in zip(resultado.hand_landmarks,
                                    resultado.handedness):
                    lado_mp   = cls[0].category_name
                    lado_real = 'Left' if lado_mp == 'Right' else 'Right'
                    aberta    = mao_aberta(pts)
                    turbo     = polegar_para_cima(pts)
                    cx, cy    = centro_palma(pts)
                    gesto     = ('TURBO' if turbo
                                 else ('ABERTA' if aberta else 'FECHADA'))
                    maos[lado_real] = {
                        'pts': pts, 'aberta': aberta, 'turbo': turbo,
                        'gesto': gesto, 'cx': cx, 'cy': cy,
                    }

            dir_ = maos.get('Right')
            esq_ = maos.get('Left')
            novo_payload = {}

            # ════════════════════════════════════════
            # MODO NAVE
            # ════════════════════════════════════════
            if modo_nave:

                if dir_:
                    atualizar_trail('Right', dir_['cx'], dir_['cy'], w, h)
                    sinal_h, int_h, sinal_v, int_v, dist_norm, ang_deg = \
                        calcular_joystick(dir_['cx'], dir_['cy'])
                    inercia_h = sinal_h * int_h * 0.35 + inercia_h * 0.65
                    inercia_v = sinal_v * int_v * 0.35 + inercia_v * 0.65
                else:
                    limpar_trail('Right')
                    inercia_h *= INERCIA_DECAY
                    inercia_v *= INERCIA_DECAY
                    if abs(inercia_h) < INERCIA_THRESHOLD: inercia_h = 0.0
                    if abs(inercia_v) < INERCIA_THRESHOLD: inercia_v = 0.0
                    sinal_h = int_h = sinal_v = int_v = dist_norm = ang_deg = 0.0

                if esq_:
                    atualizar_trail('Left', esq_['cx'], esq_['cy'], w, h)
                    if esq_['turbo']:
                        inercia_frente = inercia_frente * 0.6 + 0.4
                    elif esq_['aberta']:
                        pontas = [8,12,16,20]; bases = [6,10,14,18]
                        n_ext  = sum(1 for p,b in zip(pontas,bases)
                                     if esq_['pts'][p].y < esq_['pts'][b].y)
                        inercia_frente = inercia_frente * 0.55 + (n_ext/4.0) * 0.45
                    else:
                        pontas = [8,12,16,20]; bases = [6,10,14,18]
                        n_dob  = sum(1 for p,b in zip(pontas,bases)
                                     if esq_['pts'][p].y > esq_['pts'][b].y)
                        inercia_frente = inercia_frente * 0.55 + (-(n_dob/4.0)) * 0.45
                else:
                    limpar_trail('Left')
                    inercia_frente *= INERCIA_DECAY
                    if abs(inercia_frente) < INERCIA_THRESHOLD:
                        inercia_frente = 0.0

                keys_ativas = set()
                if inercia_h     < -0.05: keys_ativas.add('KeyA')
                if inercia_h     >  0.05: keys_ativas.add('KeyD')
                if inercia_v     < -0.05: keys_ativas.add('Space')
                if inercia_v     >  0.05: keys_ativas.add('ShiftLeft')
                if inercia_frente >  0.05: keys_ativas.add('KeyW')
                if inercia_frente < -0.05: keys_ativas.add('KeyS')
                if esq_ and esq_['turbo']:  keys_ativas.add('KeyE')

                novo_payload = {
                    'keys': list(keys_ativas),
                    'analog': {
                        'h':      round(inercia_h,      3),
                        'v':      round(inercia_v,      3),
                        'thrust': round(inercia_frente, 3),
                    }
                }

                # ── Desenho modo nave ──
                desenhar_trail(frame)

                # Círculo de controle (sempre visível, mesmo sem mão)
                desenhar_circulo_controle(
                    frame,
                    dir_['cx'] if dir_ else CTRL_CX,
                    dir_['cy'] if dir_ else CTRL_CY,
                    sinal_h, int_h, sinal_v, int_v,
                    dist_norm, ang_deg, w, h
                )

                if dir_:
                    desenhar_landmarks(frame, dir_['pts'], dir_['gesto'],
                                       'Right', w, h, e_direcao=True,
                                       intensidade=math.hypot(inercia_h, inercia_v))
                    desenhar_angulo_3d(frame, dir_['pts'], w, h, e_direcao=True)

                if esq_:
                    desenhar_landmarks(frame, esq_['pts'], esq_['gesto'],
                                       'Left', w, h,
                                       intensidade=abs(inercia_frente))
                    desenhar_angulo_3d(frame, esq_['pts'], w, h)

                with trava_cli:
                    n = len(clientes_ws)
                hud_topo(frame, 'SOLAR EXPLORER  |  MODO NAVE', (0, 212, 255), n, w)
                hud_rodape_nave(frame, keys_ativas, w, h)
                desenhar_barras_nave(frame, inercia_h, inercia_v,
                                     inercia_frente,
                                     esq_ is not None and esq_['turbo'], w, h)
                desenhar_minimap(frame, maos, w, h)
                indicador_gesto(frame, esq_['gesto'] if esq_ else None, w)

            # ════════════════════════════════════════
            # MODO VISÃO GERAL
            # ════════════════════════════════════════
            else:
                if dir_:
                    atualizar_trail('Right', dir_['cx'], dir_['cy'], w, h)
                    alvo_rotY    = (dir_['cx'] - 0.5) * 4.0
                    alvo_rotX    = (dir_['cy'] - 0.5) * 2.2
                    rot_y_acum  += (alvo_rotY - rot_y_acum) * 0.18
                    rot_x_acum  += (alvo_rotX - rot_x_acum) * 0.18
                    desenhar_landmarks(frame, dir_['pts'], dir_['gesto'],
                                       'Right', w, h, e_direcao=True)
                    desenhar_angulo_3d(frame, dir_['pts'], w, h, e_direcao=True)

                    # Mira com grade de direção
                    px_d = int(dir_['cx'] * w)
                    py_d = int(dir_['cy'] * h)
                    # Linhas de referência suaves
                    cv2.line(frame, (px_d, 56), (px_d, h - 28),
                             (50, 30, 70), 1, cv2.LINE_AA)
                    cv2.line(frame, (0, py_d), (w, py_d),
                             (50, 30, 70), 1, cv2.LINE_AA)
                    # Mira
                    cv2.circle(frame, (px_d, py_d), 18, (80, 30, 100), 1, cv2.LINE_AA)
                    cv2.circle(frame, (px_d, py_d),  5, COR_DIR,       -1, cv2.LINE_AA)
                    cv2.drawMarker(frame, (px_d, py_d), COR_DIR,
                                   cv2.MARKER_CROSS, 28, 2, cv2.LINE_AA)
                else:
                    limpar_trail('Right')

                if esq_:
                    atualizar_trail('Left', esq_['cx'], esq_['cy'], w, h)
                    if dir_:
                        dist     = math.hypot(dir_['cx'] - esq_['cx'],
                                              dir_['cy'] - esq_['cy'])
                        alvo_vel = min(dist * 7.0, 3.0)
                        vel_acum += (alvo_vel - vel_acum) * 0.10

                        # Linha entre palmas com indicador de distância
                        px1, py1 = int(dir_['cx']*w), int(dir_['cy']*h)
                        px2, py2 = int(esq_['cx']*w), int(esq_['cy']*h)
                        cv2.line(frame, (px1,py1), (px2,py2), (120, 50, 160), 1, cv2.LINE_AA)
                        mid = ((px1+px2)//2, (py1+py2)//2)
                        # Ponto do meio
                        cv2.circle(frame, mid, 5, (180, 80, 220), -1, cv2.LINE_AA)
                        texto(frame, f'{vel_acum:.1f}x',
                              (mid[0] + 8, mid[1] - 6),
                              escala=0.50, cor=(200, 100, 255),
                              cor_fundo=(15, 0, 20))

                    desenhar_landmarks(frame, esq_['pts'], esq_['gesto'],
                                       'Left', w, h)
                    desenhar_angulo_3d(frame, esq_['pts'], w, h)
                else:
                    limpar_trail('Left')

                desenhar_trail(frame)

                novo_payload = {
                    'keys':       [],
                    'rotX':       round(rot_x_acum, 4),
                    'rotY':       round(rot_y_acum, 4),
                    'velocidade': round(vel_acum,   4),
                }

                with trava_cli:
                    n = len(clientes_ws)
                hud_topo(frame, 'SOLAR EXPLORER  |  VISAO GERAL', (200, 80, 255), n, w)
                hud_rodape_geral(frame, w, h)
                desenhar_barras_geral(frame, rot_x_acum, rot_y_acum, vel_acum, w, h)
                desenhar_minimap(frame, maos, w, h)
                indicador_geral(frame, rot_x_acum, rot_y_acum, vel_acum,
                                bool(dir_), bool(esq_), w, h)

            with trava_payload:
                payload_atual.update(novo_payload)

            cv2.imshow(NOME_JANELA, frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                print('\n[WIN] Janela fechada pelo usuario.')
                break

    cap.release()
    cv2.destroyAllWindows()

# ─────────────────────────────────────────────
# WebSocket
# ─────────────────────────────────────────────
async def ao_conectar(websocket):
    with trava_cli:
        clientes_ws.append(websocket)
    print(f'[WS] Cliente conectado. Total: {len(clientes_ws)}')
    try:
        async for msg in websocket:
            try:
                dados = json.loads(msg)
                if 'followShip' in dados:
                    with trava_payload:
                        payload_atual['followShip'] = bool(dados['followShip'])
                    modo = 'NAVE' if dados['followShip'] else 'VISAO GERAL'
                    print(f'[WS] Modo -> {modo}')
            except Exception:
                pass
    finally:
        with trava_cli:
            if websocket in clientes_ws:
                clientes_ws.remove(websocket)
        print(f'[WS] Cliente desconectado. Total: {len(clientes_ws)}')

async def loop_broadcast():
    anterior = None
    while True:
        await asyncio.sleep(0.033)
        with trava_payload:
            atual = dict(payload_atual)
        if atual == anterior:
            continue
        msg = json.dumps(atual)
        with trava_cli:
            copia = list(clientes_ws)
        falhos = []
        for ws in copia:
            try:
                await ws.send(msg)
            except Exception:
                falhos.append(ws)
        if falhos:
            with trava_cli:
                for ws in falhos:
                    if ws in clientes_ws:
                        clientes_ws.remove(ws)
        anterior = atual

async def iniciar_servidor():
    print(f'[WS] Servidor em ws://localhost:{PORTA_WS}')
    async with websockets.serve(ao_conectar, 'localhost', PORTA_WS):
        await loop_broadcast()

if __name__ == '__main__':
    t = threading.Thread(target=thread_rastreamento, daemon=True)
    t.start()
    asyncio.run(iniciar_servidor())