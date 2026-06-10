import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

// ─────────────────────────────────────────────
//  ESTADO GLOBAL
// ─────────────────────────────────────────────
let spaceship
let followShip = true
let firstPerson = false
let jwstGroup
let globalOrbitSpeedMultiplier = 1.0
let shipSpeed = 0
let shipThrust = false
let warpActive = false
let warpParticles = null
let clock = new THREE.Clock()

// ─────────────────────────────────────────────
//  CONTROLE POR MÃOS — estado interno
// ─────────────────────────────────────────────
const handKeys   = {}                          // teclas binárias (liga/desliga)
const handAnalog = { h: 0, v: 0, thrust: 0 }  // valores contínuos -1..1 com inércia

// Acumuladores de rotação para o modo visão geral
let cvRotX = 0
let cvRotY = 0

const systemGroup = new THREE.Group()

// ─────────────────────────────────────────────
//  CENA
// ─────────────────────────────────────────────
const scene = new THREE.Scene()
scene.add(systemGroup)
scene.background = new THREE.Color(0x00020f)   // azul-noite profundo, não puro preto
scene.fog = new THREE.FogExp2(0x00020f, 0.0000012)

// ─────────────────────────────────────────────
//  CÂMERA
// ─────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 600000)
camera.position.set(0, 100, 300)

// FOV alvo suavizado
let targetFOV = 75

// ─────────────────────────────────────────────
//  RENDERER
// ─────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.2
document.body.appendChild(renderer.domElement)

// ─────────────────────────────────────────────
//  PÓS-PROCESSAMENTO
// ─────────────────────────────────────────────
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5,   // strength
    0.5,   // radius
    0.78   // threshold
)
composer.addPass(bloomPass)

// Shader de aberração cromática sutil (efeito lente espacial)
const chromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        amount: { value: 0.0008 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float amount;
        varying vec2 vUv;
        void main() {
            vec2 dir = vUv - vec2(0.5);
            float dist = length(dir);
            vec4 r = texture2D(tDiffuse, vUv + dir * amount * dist);
            vec4 g = texture2D(tDiffuse, vUv);
            vec4 b = texture2D(tDiffuse, vUv - dir * amount * dist);
            gl_FragColor = vec4(r.r, g.g, b.b, 1.0);
        }
    `
}
const caPass = new ShaderPass(chromaticAberrationShader)
composer.addPass(caPass)

// ─────────────────────────────────────────────
//  CSS2D LABEL RENDERER
// ─────────────────────────────────────────────
const labelRenderer = new CSS2DRenderer()
labelRenderer.setSize(window.innerWidth, window.innerHeight)
labelRenderer.domElement.style.position = 'absolute'
labelRenderer.domElement.style.top = '0px'
labelRenderer.domElement.style.pointerEvents = 'none'
document.body.appendChild(labelRenderer.domElement)

// ─────────────────────────────────────────────
//  FONTE NASA (injetar no head)
// ─────────────────────────────────────────────
const fontLink = document.createElement('link')
fontLink.rel = 'stylesheet'
fontLink.href = 'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@300;400;600;700&display=swap'
document.head.appendChild(fontLink)

// ─────────────────────────────────────────────
//  ESTILOS GLOBAIS
// ─────────────────────────────────────────────
const globalStyle = document.createElement('style')
globalStyle.textContent = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { overflow: hidden; background: #00010a; }
    canvas { display: block; }

    :root {
        --nasa-blue:    #0b3d91;
        --nasa-red:     #fc3d21;
        --hud-cyan:     #00d4ff;
        --hud-green:    #39ff89;
        --hud-amber:    #ffb300;
        --hud-dim:      rgba(0, 212, 255, 0.12);
        --hud-border:   rgba(0, 212, 255, 0.35);
        --hud-bg:       rgba(0, 6, 20, 0.82);
        --font-mono:    'Share Tech Mono', monospace;
        --font-ui:      'Barlow Condensed', sans-serif;
    }

    /* ── SCANLINES overlay sutil ── */
    body::after {
        content: '';
        position: fixed;
        inset: 0;
        background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.04) 2px,
            rgba(0,0,0,0.04) 4px
        );
        pointer-events: none;
        z-index: 9999;
    }

    /* ── LABELS dos planetas ── */
    .planet-label {
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #c8dff0;
        white-space: nowrap;
        pointer-events: none;
        user-select: none;
        transition: opacity 0.3s ease;
    }
    .planet-label .label-name {
        display: inline-block;
        padding: 1px 5px;
        background: rgba(0, 6, 20, 0.65);
        border: 1px solid rgba(0, 212, 255, 0.28);
        border-radius: 2px;
    }
    .planet-label .label-name::before {
        content: '· ';
        color: rgba(0, 212, 255, 0.6);
        font-size: 8px;
    }

    /* label luas menor */
    .moon-label {
        font-family: var(--font-mono);
        font-size: 7px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #6a8ea8;
        white-space: nowrap;
        padding: 1px 4px;
        background: rgba(0,6,20,0.55);
        border: 1px solid rgba(100, 180, 220, 0.18);
        border-radius: 2px;
        transition: opacity 0.3s ease;
    }

    /* label JWST */
    .jwst-label {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #39ff89;
        white-space: nowrap;
        padding: 2px 7px;
        background: rgba(0,20,10,0.8);
        border: 1px solid rgba(57,255,137,0.4);
        border-radius: 2px;
    }

    /* label nave */
    .ship-label {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--hud-cyan);
        white-space: nowrap;
        padding: 2px 7px;
        background: rgba(0,10,20,0.8);
        border: 1px solid rgba(0,212,255,0.35);
        border-radius: 2px;
    }

    /* ═══════════════════════════════
       HUD PRINCIPAL – canto inferior direito
    ═══════════════════════════════ */
    #hud-nav {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 290px;
        font-family: var(--font-ui);
        font-size: 13px;
        background: var(--hud-bg);
        border: 1px solid var(--hud-border);
        border-radius: 4px;
        overflow: hidden;
        backdrop-filter: blur(8px);
        box-shadow:
            0 0 0 1px rgba(0,212,255,0.08),
            0 0 30px rgba(0,100,200,0.15),
            inset 0 0 30px rgba(0,20,60,0.3);
        z-index: 1000;
    }

    #hud-nav .hud-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 14px;
        background: linear-gradient(90deg, rgba(0,212,255,0.15) 0%, transparent 100%);
        border-bottom: 1px solid var(--hud-border);
    }
    #hud-nav .hud-header .nasa-badge {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: var(--hud-cyan);
        box-shadow: 0 0 6px var(--hud-cyan);
        flex-shrink: 0;
    }
    #hud-nav .hud-header span {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.18em;
        color: var(--hud-cyan);
        text-transform: uppercase;
    }
    #hud-nav .hud-header .mission-id {
        margin-left: auto;
        font-size: 9px;
        color: rgba(0,212,255,0.45);
        letter-spacing: 0.05em;
    }

    #hud-nav .hud-section {
        padding: 8px 14px;
        border-bottom: 1px solid rgba(0,212,255,0.08);
    }
    #hud-nav .hud-section:last-child { border-bottom: none; }

    #hud-nav .hud-section-title {
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 0.2em;
        color: rgba(0,212,255,0.5);
        text-transform: uppercase;
        margin-bottom: 7px;
    }

    #hud-nav .hud-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 5px;
        line-height: 1;
    }
    #hud-nav .hud-row:last-child { margin-bottom: 0; }

    #hud-nav .key {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 26px;
        height: 20px;
        padding: 0 5px;
        background: rgba(0,212,255,0.1);
        border: 1px solid rgba(0,212,255,0.4);
        border-bottom: 2px solid rgba(0,212,255,0.6);
        border-radius: 3px;
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--hud-cyan);
        flex-shrink: 0;
        white-space: nowrap;
    }
    #hud-nav .key.key-amber {
        background: rgba(255,179,0,0.1);
        border-color: rgba(255,179,0,0.5);
        border-bottom-color: rgba(255,179,0,0.7);
        color: var(--hud-amber);
    }
    #hud-nav .key.key-green {
        background: rgba(57,255,137,0.08);
        border-color: rgba(57,255,137,0.4);
        border-bottom-color: rgba(57,255,137,0.6);
        color: var(--hud-green);
    }
    #hud-nav .key.key-magenta {
        background: rgba(255,0,200,0.08);
        border-color: rgba(255,0,200,0.35);
        border-bottom-color: rgba(255,0,200,0.55);
        color: #ff55dd;
    }

    #hud-nav .action-desc {
        font-size: 12px;
        font-weight: 300;
        color: rgba(200,220,240,0.8);
        letter-spacing: 0.02em;
    }
    #hud-nav .action-note {
        font-size: 10px;
        color: rgba(0,212,255,0.4);
        margin-left: auto;
        white-space: nowrap;
    }

    /* ═══════════════════════════════
       TELEMETRIA – canto superior esquerdo
    ═══════════════════════════════ */
    #hud-telemetry {
        position: fixed;
        top: 24px;
        left: 24px;
        width: 240px;
        font-family: var(--font-mono);
        background: var(--hud-bg);
        border: 1px solid var(--hud-border);
        border-radius: 4px;
        overflow: hidden;
        backdrop-filter: blur(8px);
        box-shadow:
            0 0 0 1px rgba(0,212,255,0.08),
            0 0 30px rgba(0,100,200,0.12);
        z-index: 1000;
    }

    #hud-telemetry .tele-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: linear-gradient(90deg, rgba(0,212,255,0.12) 0%, transparent 100%);
        border-bottom: 1px solid var(--hud-border);
    }
    #hud-telemetry .tele-header .tele-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: var(--hud-green);
        box-shadow: 0 0 5px var(--hud-green);
        animation: blink 2s infinite;
    }
    @keyframes blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
    }
    #hud-telemetry .tele-header span {
        font-size: 10px;
        letter-spacing: 0.2em;
        color: var(--hud-cyan);
        text-transform: uppercase;
    }

    #hud-telemetry .tele-body { padding: 10px 12px; }

    #hud-telemetry .tele-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 6px;
        border-bottom: 1px solid rgba(0,212,255,0.05);
        padding-bottom: 5px;
    }
    #hud-telemetry .tele-row:last-child { margin-bottom: 0; border-bottom: none; }

    #hud-telemetry .tele-label {
        font-size: 9px;
        letter-spacing: 0.15em;
        color: rgba(0,212,255,0.5);
        text-transform: uppercase;
    }
    #hud-telemetry .tele-value {
        font-size: 13px;
        color: #e0f0ff;
        letter-spacing: 0.05em;
    }
    #hud-telemetry .tele-value.highlight { color: var(--hud-amber); }
    #hud-telemetry .tele-value.active    { color: var(--hud-green); }
    #hud-telemetry .tele-value.warning   { color: var(--nasa-red); animation: blink 0.5s infinite; }

    /* Barra de velocidade */
    #hud-telemetry .speed-bar-wrap {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(0,212,255,0.1);
    }
    #hud-telemetry .speed-bar-label {
        font-size: 8px;
        letter-spacing: 0.2em;
        color: rgba(0,212,255,0.4);
        text-transform: uppercase;
        margin-bottom: 4px;
    }
    #hud-telemetry .speed-bar-track {
        height: 3px;
        background: rgba(0,212,255,0.1);
        border-radius: 2px;
        overflow: hidden;
    }
    #hud-telemetry .speed-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--hud-cyan), var(--hud-green));
        border-radius: 2px;
        transition: width 0.1s ease;
        box-shadow: 0 0 6px var(--hud-cyan);
        width: 0%;
    }

    /* ═══════════════════════════════
       WARP OVERLAY
    ═══════════════════════════════ */
    #warp-overlay {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 500;
        opacity: 0;
        transition: opacity 0.3s ease;
        background: radial-gradient(ellipse at center,
            rgba(0,200,255,0.0) 0%,
            rgba(0,100,200,0.15) 60%,
            rgba(0,50,150,0.35) 100%
        );
    }
    #warp-overlay.active { opacity: 1; }
    #warp-overlay::after {
        content: 'WARP DRIVE ENGAGED';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-family: var(--font-mono);
        font-size: 18px;
        letter-spacing: 0.4em;
        color: rgba(0,212,255,0.6);
        text-shadow: 0 0 20px var(--hud-cyan);
        animation: warp-text 0.5s infinite alternate;
    }
    @keyframes warp-text {
        from { opacity: 0.4; letter-spacing: 0.4em; }
        to   { opacity: 0.9; letter-spacing: 0.5em; }
    }

    /* ═══════════════════════════════
       CROSSHAIR (modo nave)
    ═══════════════════════════════ */
    #crosshair {
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 24px; height: 24px;
        pointer-events: none;
        z-index: 800;
        opacity: 0;
        transition: opacity 0.3s;
    }
    #crosshair.visible { opacity: 1; }
    #crosshair::before, #crosshair::after {
        content: '';
        position: absolute;
        background: rgba(0,212,255,0.7);
    }
    #crosshair::before { width: 1px; height: 100%; left: 50%; top: 0; }
    #crosshair::after  { width: 100%; height: 1px; top: 50%; left: 0; }
    #crosshair .ch-ring {
        position: absolute;
        inset: 4px;
        border: 1px solid rgba(0,212,255,0.4);
        border-radius: 50%;
    }

    /* ═══════════════════════════════
       LOADING SCREEN
    ═══════════════════════════════ */
    #loading-screen {
        position: fixed;
        inset: 0;
        background: #00010a;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 9998;
        transition: opacity 0.8s ease;
    }
    #loading-screen.hidden { opacity: 0; pointer-events: none; }
    #loading-screen .nasa-logo-text {
        font-family: var(--font-ui);
        font-size: 11px;
        letter-spacing: 0.5em;
        color: rgba(0,212,255,0.5);
        text-transform: uppercase;
        margin-bottom: 32px;
    }
    #loading-screen .mission-title {
        font-family: var(--font-ui);
        font-size: 38px;
        font-weight: 700;
        letter-spacing: 0.1em;
        color: #e8f4ff;
        text-transform: uppercase;
        margin-bottom: 6px;
    }
    #loading-screen .mission-subtitle {
        font-family: var(--font-mono);
        font-size: 12px;
        letter-spacing: 0.3em;
        color: rgba(0,212,255,0.6);
        margin-bottom: 48px;
    }
    #loading-screen .load-bar-track {
        width: 280px; height: 2px;
        background: rgba(0,212,255,0.15);
        border-radius: 2px;
        overflow: hidden;
        margin-bottom: 16px;
    }
    #loading-screen .load-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--hud-cyan), var(--hud-green));
        box-shadow: 0 0 8px var(--hud-cyan);
        animation: load-progress 2.5s cubic-bezier(0.2,0.8,0.8,1) forwards;
    }
    @keyframes load-progress { from { width: 0% } to { width: 100% } }
    #loading-screen .load-status {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.15em;
        color: rgba(0,212,255,0.4);
        animation: cycle-status 2.5s steps(1) forwards;
    }
    @keyframes cycle-status {
        0%   { content: 'INICIALIZANDO SISTEMAS…'; }
        33%  { content: 'CARREGANDO TEXTURAS…'; }
        66%  { content: 'CALIBRANDO TELEMETRIA…'; }
        100% { content: 'PRONTO PARA LANÇAMENTO'; }
    }

    /* coords bottom-center */
    #coords-display {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.12em;
        color: rgba(0,212,255,0.35);
        pointer-events: none;
        z-index: 900;
        text-align: center;
    }
`
document.head.appendChild(globalStyle)

// ─────────────────────────────────────────────
//  TELA DE LOADING
// ─────────────────────────────────────────────
function createLoadingScreen() {
    const screen = document.createElement('div')
    screen.id = 'loading-screen'
    screen.innerHTML = `
        <div class="nasa-logo-text">Simulação do Sistema Solar</div>
        <div class="mission-title">SOLAR EXPLORER</div>
        <div class="mission-subtitle">MISSION CONTROL · REV 2.0</div>
        <div class="load-bar-track"><div class="load-bar-fill"></div></div>
        <div class="load-status">INICIALIZANDO SISTEMAS…</div>
    `
    document.body.appendChild(screen)

    // Ciclar textos manualmente
    const statuses = [
        'INICIALIZANDO SISTEMAS…',
        'CARREGANDO TEXTURAS…',
        'CALIBRANDO TELEMETRIA…',
        'PRONTO PARA LANÇAMENTO'
    ]
    let idx = 0
    const statusEl = screen.querySelector('.load-status')
    const interval = setInterval(() => {
        idx++
        if (idx < statuses.length) statusEl.textContent = statuses[idx]
    }, 700)

    setTimeout(() => {
        clearInterval(interval)
        screen.classList.add('hidden')
        setTimeout(() => screen.remove(), 900)
    }, 2800)
}
createLoadingScreen()

// ─────────────────────────────────────────────
//  HUD DE NAVEGAÇÃO
// ─────────────────────────────────────────────
function createHUD() {
    const hud = document.createElement('div')
    hud.id = 'hud-nav'
    hud.innerHTML = `
        <div class="hud-header">
            <div class="nasa-badge"></div>
            <span>Nav · Control</span>
            <span class="mission-id">MCC-SX-2.0</span>
        </div>

        <div class="hud-section">
            <div class="hud-section-title">Propulsão</div>
            <div class="hud-row">
                <span class="key key-amber">W A S D</span>
                <span class="action-desc">Mover nave / câmera</span>
            </div>
            <div class="hud-row">
                <span class="key key-amber">SPC</span>
                <span class="key key-amber">SHF</span>
                <span class="action-desc">Subir / Descer</span>
            </div>
            <div class="hud-row">
                <span class="key key-amber">E</span>
                <span class="action-desc">Turbo / Warp Drive</span>
            </div>
        </div>

        <div class="hud-section">
            <div class="hud-section-title">Câmera</div>
            <div class="hud-row">
                <span class="key key-green">N</span>
                <span class="action-desc">Câmera da nave</span>
                <span class="action-note">OpenCV</span>
            </div>
            <div class="hud-row">
                <span class="key key-green">F</span>
                <span class="action-desc">Primeira pessoa</span>
            </div>
        </div>

        <div class="hud-section">
            <div class="hud-section-title">Teleporte</div>
            <div class="hud-row">
                <span class="key key-magenta">G</span>
                <span class="action-desc">Visão geral</span>
                <span class="action-note">OpenCV</span>
            </div>
            <div class="hud-row">
                <span class="key key-magenta">T</span>
                <span class="action-desc">Focar na Terra</span>
            </div>
            <div class="hud-row">
                <span class="key key-magenta">K</span>
                <span class="action-desc">Focar em Saturno</span>
            </div>
        </div>
    `
    document.body.appendChild(hud)
}
createHUD()

// ─────────────────────────────────────────────
//  HUD DE TELEMETRIA
// ─────────────────────────────────────────────
function createTelemetry() {
    const tel = document.createElement('div')
    tel.id = 'hud-telemetry'
    tel.innerHTML = `
        <div class="tele-header">
            <div class="tele-dot"></div>
            <span>Telemetria da Nave</span>
        </div>
        <div class="tele-body">
            <div class="tele-row">
                <span class="tele-label">Modo</span>
                <span class="tele-value active" id="tel-mode">FOLLOW</span>
            </div>
            <div class="tele-row">
                <span class="tele-label">Propulsão</span>
                <span class="tele-value" id="tel-thrust">OFF</span>
            </div>
            <div class="tele-row">
                <span class="tele-label">Warp</span>
                <span class="tele-value" id="tel-warp">STANDBY</span>
            </div>
            <div class="tele-row">
                <span class="tele-label">Vel. Órbita</span>
                <span class="tele-value highlight" id="tel-orbit">1.00×</span>
            </div>
            <div class="tele-row">
                <span class="tele-label">Posição</span>
                <span class="tele-value" id="tel-pos">—</span>
            </div>
            <div class="speed-bar-wrap">
                <div class="speed-bar-label">Velocidade relativa</div>
                <div class="speed-bar-track">
                    <div class="speed-bar-fill" id="tel-speedbar"></div>
                </div>
            </div>
        </div>
    `
    document.body.appendChild(tel)
}
createTelemetry()

// ─────────────────────────────────────────────
//  WARP OVERLAY
// ─────────────────────────────────────────────
const warpOverlay = document.createElement('div')
warpOverlay.id = 'warp-overlay'
document.body.appendChild(warpOverlay)

// ─────────────────────────────────────────────
//  CROSSHAIR
// ─────────────────────────────────────────────
const crosshair = document.createElement('div')
crosshair.id = 'crosshair'
crosshair.innerHTML = '<div class="ch-ring"></div>'
document.body.appendChild(crosshair)

// ─────────────────────────────────────────────
//  COORDS DISPLAY
// ─────────────────────────────────────────────
const coordsDisplay = document.createElement('div')
coordsDisplay.id = 'coords-display'
document.body.appendChild(coordsDisplay)

// ─────────────────────────────────────────────
//  ATUALIZAR TELEMETRIA
// ─────────────────────────────────────────────
function updateTelemetry() {
    const isTurbo = keys['KeyE']
    const isMoving = keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD']

    const modeEl      = document.getElementById('tel-mode')
    const thrustEl    = document.getElementById('tel-thrust')
    const warpEl      = document.getElementById('tel-warp')
    const orbitEl     = document.getElementById('tel-orbit')
    const posEl       = document.getElementById('tel-pos')
    const speedBarEl  = document.getElementById('tel-speedbar')

    if (modeEl) {
        if (firstPerson)      { modeEl.textContent = 'FPS'; modeEl.className = 'tele-value highlight' }
        else if (followShip)  { modeEl.textContent = 'FOLLOW'; modeEl.className = 'tele-value active' }
        else                  { modeEl.textContent = 'ORBIT CAM'; modeEl.className = 'tele-value' }
    }

    if (thrustEl) {
        if (isMoving) { thrustEl.textContent = 'ATIVO'; thrustEl.className = 'tele-value active' }
        else          { thrustEl.textContent = 'OFF'; thrustEl.className = 'tele-value' }
    }

    if (warpEl) {
        if (isTurbo) { warpEl.textContent = 'ENGAJADO'; warpEl.className = 'tele-value warning' }
        else         { warpEl.textContent = 'STANDBY'; warpEl.className = 'tele-value' }
    }

    if (orbitEl) {
        orbitEl.textContent = globalOrbitSpeedMultiplier.toFixed(2) + '×'
    }

    if (spaceship && posEl) {
        const p = spaceship.position
        posEl.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`
    }

    if (speedBarEl) {
        const pct = isTurbo ? 100 : (isMoving ? 25 : 0)
        speedBarEl.style.width = pct + '%'
        speedBarEl.style.background = isTurbo
            ? 'linear-gradient(90deg, #fc3d21, #ffb300)'
            : 'linear-gradient(90deg, var(--hud-cyan), var(--hud-green))'
    }

    // Crosshair
    if (followShip || firstPerson) crosshair.classList.add('visible')
    else crosshair.classList.remove('visible')

    // Warp overlay
    if (isTurbo && followShip) warpOverlay.classList.add('active')
    else warpOverlay.classList.remove('active')

    // Coords
    if (camera) {
        const cp = camera.position
        coordsDisplay.textContent = `CAM  X:${Math.round(cp.x)}  Y:${Math.round(cp.y)}  Z:${Math.round(cp.z)}`
    }
}

// ─────────────────────────────────────────────
//  CONTROLES
// ─────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.maxDistance = 250000

const fps = new PointerLockControls(camera, document.body)
const keys = {}

window.addEventListener('keydown', (e) => {
    keys[e.code] = true

    if (e.code === 'KeyF') {
        firstPerson = !firstPerson; followShip = false
        controls.enabled = !firstPerson
        firstPerson ? fps.lock() : fps.unlock()
    }
    if (e.code === 'KeyN') {
        followShip = !followShip; firstPerson = false
        if (followShip) fps.unlock()
    }
    if (e.code === 'KeyG') {
        disableShipModes()
        // Mais próximo do sistema — planetas aparecem colossais
        camera.position.set(0, 28000, 38000)
        controls.target.set(0, 0, 0)
        controls.update()
    }
    if (e.code === 'KeyT') focusOnPlanet('Terra',   new THREE.Vector3(0, 2200, 5500))
    if (e.code === 'KeyK') focusOnPlanet('Saturno', new THREE.Vector3(0, 6000, 14000))
})
window.addEventListener('keyup', (e) => { keys[e.code] = false })

function disableShipModes() {
    followShip = false; firstPerson = false
    fps.unlock(); controls.enabled = true
}

function focusOnPlanet(name, offset) {
    const target = planets.find(p => p.name === name)
    if (!target) return
    disableShipModes()
    const pos = new THREE.Vector3()
    target.group.getWorldPosition(pos)
    camera.position.copy(pos).add(offset)
    controls.target.copy(pos)
}

function updateFPSMovement() {
    const speed = 40.0
    if (keys['KeyW']) fps.moveForward(speed)
    if (keys['KeyS']) fps.moveForward(-speed)
    if (keys['KeyA']) fps.moveRight(-speed)
    if (keys['KeyD']) fps.moveRight(speed)
    if (keys['Space'])     camera.position.y += speed
    if (keys['ShiftLeft']) camera.position.y -= speed
}

// ─────────────────────────────────────────────
//  ILUMINAÇÃO
// ─────────────────────────────────────────────
function setupLighting() {
    scene.add(new THREE.AmbientLight(0xffffff, 1.8))

    const sunLight = new THREE.PointLight(0xfff3e0, 3.0, 0, 0)
    sunLight.castShadow = true
    sunLight.shadow.mapSize.width  = 2048
    sunLight.shadow.mapSize.height = 2048
    sunLight.shadow.camera.near = 100
    sunLight.shadow.camera.far  = 500000
    systemGroup.add(sunLight)

    // Luz de preenchimento fria vinda de trás
    const fillLight = new THREE.DirectionalLight(0x2244aa, 0.2)
    fillLight.position.set(-50000, 20000, -50000)
    scene.add(fillLight)

    // Luz dedicada à nave — segue a cena, garante visibilidade sem reflexo
    const shipLight = new THREE.DirectionalLight(0xfff5e0, 1.2)
    shipLight.position.set(1, 1, 2)
    scene.add(shipLight)
}

const textureLoader = new THREE.TextureLoader()

// ─────────────────────────────────────────────
//  LABEL HELPERS
// ─────────────────────────────────────────────
function createPlanetLabel(name) {
    const div = document.createElement('div')
    div.className = 'planet-label'
    div.innerHTML = `<span class="label-name">${name}</span>`
    const obj = new CSS2DObject(div)
    obj._labelEl = div
    return obj
}

function createMoonLabel(name) {
    const div = document.createElement('div')
    div.className = 'moon-label'
    div.textContent = name
    const obj = new CSS2DObject(div)
    obj._labelEl = div
    return obj
}

function createJWSTLabel() {
    const div = document.createElement('div')
    div.className = 'jwst-label'
    div.textContent = 'JWST · James Webb'
    return new CSS2DObject(div)
}

function createShipLabel() {
    const div = document.createElement('div')
    div.className = 'ship-label'
    div.textContent = '▶ SX-01 · Nave'
    return new CSS2DObject(div)
}

// ─────────────────────────────────────────────
//  ESTRELAS  (campo duplo – próximo + distante)
// ─────────────────────────────────────────────
function createStars() {
    const layers = [
        { count: 8000, rMin: 150000, rMax: 200000, size: 3.5, opacity: 0.9 },
        { count: 5000, rMin: 80000,  rMax: 150000, size: 2.0, opacity: 0.6 }
    ]
    layers.forEach(({ count, rMin, rMax, size, opacity }) => {
        const geo  = new THREE.BufferGeometry()
        const pos  = new Float32Array(count * 3)
        const col  = new Float32Array(count * 3)
        for (let i = 0; i < count * 3; i += 3) {
            const r     = rMin + Math.random() * (rMax - rMin)
            const u     = Math.random()
            const v     = Math.random()
            const theta = u * 2 * Math.PI
            const phi   = Math.acos(2 * v - 1)
            pos[i]   = r * Math.sin(phi) * Math.cos(theta)
            pos[i+1] = r * Math.sin(phi) * Math.sin(theta)
            pos[i+2] = r * Math.cos(phi)
            const t  = Math.random()
            col[i]   = 0.7 + t * 0.3
            col[i+1] = 0.8 + t * 0.15
            col[i+2] = 1.0
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geo.setAttribute('color',    new THREE.BufferAttribute(col, 3))
        scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
            size, vertexColors: true, transparent: true, opacity,
            sizeAttenuation: true
        })))
    })
}

// ─────────────────────────────────────────────
//  FUNDO ESPACIAL — Via Láctea + nebulosa sutil
// ─────────────────────────────────────────────
function createNebula() {
    // ── Faixa da Via Láctea (poeira galáctica concentrada no plano) ──
    const mwCount = 8000
    const mwGeo   = new THREE.BufferGeometry()
    const mwPos   = new Float32Array(mwCount * 3)
    const mwCol   = new Float32Array(mwCount * 3)

    for (let i = 0; i < mwCount * 3; i += 3) {
        const r      = 160000 + Math.random() * 35000
        const theta  = Math.random() * Math.PI * 2
        // concentrado perto do plano galáctico (y achatado)
        const phi    = Math.PI / 2 + (Math.random() - 0.5) * 0.55
        mwPos[i]   = r * Math.sin(phi) * Math.cos(theta)
        mwPos[i+1] = r * Math.cos(phi)
        mwPos[i+2] = r * Math.sin(phi) * Math.sin(theta)

        // cor: branco-azulado com toque cálido em alguns pontos
        const warm = Math.random() < 0.25
        mwCol[i]   = warm ? 0.9 : 0.75
        mwCol[i+1] = warm ? 0.82 : 0.80
        mwCol[i+2] = warm ? 0.70 : 0.95
    }
    mwGeo.setAttribute('position', new THREE.BufferAttribute(mwPos, 3))
    mwGeo.setAttribute('color',    new THREE.BufferAttribute(mwCol, 3))
    scene.add(new THREE.Points(mwGeo, new THREE.PointsMaterial({
        size: 8, vertexColors: true, transparent: true, opacity: 0.12, sizeAttenuation: true
    })))

    // ── Nebulosa colorida — só 2 regiões distantes, bem suave ──
    const regions = [
        { count: 600, color: [0.12, 0.22, 0.65], phi0: 1.1, spread: 0.4 },  // azul profundo
        { count: 400, color: [0.55, 0.08, 0.30], phi0: 2.2, spread: 0.3 },  // vermelho/vinho
    ]
    regions.forEach(({ count, color, phi0, spread }) => {
        const geo = new THREE.BufferGeometry()
        const pos = new Float32Array(count * 3)
        const col = new Float32Array(count * 3)
        for (let i = 0; i < count * 3; i += 3) {
            const r     = 185000 + Math.random() * 12000
            const theta = Math.random() * Math.PI * 2
            const phi   = phi0 + (Math.random() - 0.5) * spread
            pos[i]   = r * Math.sin(phi) * Math.cos(theta)
            pos[i+1] = r * Math.cos(phi)
            pos[i+2] = r * Math.sin(phi) * Math.sin(theta)
            const br = 0.4 + Math.random() * 0.6
            col[i]   = color[0] * br
            col[i+1] = color[1] * br
            col[i+2] = color[2] * br
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geo.setAttribute('color',    new THREE.BufferAttribute(col, 3))
        scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
            size: 18, vertexColors: true, transparent: true, opacity: 0.09, sizeAttenuation: true
        })))
    })
}

// ─────────────────────────────────────────────
//  CINTURÃO DE ASTERÓIDES — variado e realista
// ─────────────────────────────────────────────
const asteroids = []
function createAsteroidBelt() {
    const group = new THREE.Group()

    // Paleta de cores geológicas reais
    const colorPalette = [
        new THREE.Color(0x3a3028), // condrito escuro
        new THREE.Color(0x5a4a38), // carbonáceo
        new THREE.Color(0x6e5c42), // silicato
        new THREE.Color(0x4a3a2a), // rocha escura
        new THREE.Color(0x8a7a60), // silicato claro
        new THREE.Color(0x2e2420), // carbono puro
        new THREE.Color(0x9a8060), // olivina
    ]

    // Geometrias variadas (mistura de formas irregulares)
    const geoFactories = [
        (s) => new THREE.DodecahedronGeometry(s, 1),
        (s) => new THREE.IcosahedronGeometry(s, 0),
        (s) => new THREE.OctahedronGeometry(s, 0),
        (s) => new THREE.TetrahedronGeometry(s * 1.3, 0),
    ]

    for (let i = 0; i < 1800; i++) {
        // Tamanho com distribuição exponencial — maioria pequeno, alguns grandes
        const t    = Math.random()
        const size = t < 0.7
            ? 4  + Math.random() * 12   // pequenos (70%)
            : t < 0.92
            ? 16 + Math.random() * 28   // médios   (22%)
            : 40 + Math.random() * 60   // grandes  (8%)

        const geoFn = geoFactories[Math.floor(Math.random() * geoFactories.length)]
        const geo   = geoFn(size)

        // Deformar vértices aleatoriamente para parecer rochoso
        const pos = geo.attributes.position
        for (let v = 0; v < pos.count; v++) {
            pos.setX(v, pos.getX(v) * (0.75 + Math.random() * 0.5))
            pos.setY(v, pos.getY(v) * (0.75 + Math.random() * 0.5))
            pos.setZ(v, pos.getZ(v) * (0.75 + Math.random() * 0.5))
        }
        pos.needsUpdate = true
        geo.computeVertexNormals()

        const baseColor = colorPalette[Math.floor(Math.random() * colorPalette.length)].clone()

        // ~5% têm veio metálico brilhante (asteroide metálico tipo M)
        const isMetal  = Math.random() < 0.05
        // ~3% têm leve emissão (aquecidos pelo sol)
        const isHot    = !isMetal && Math.random() < 0.03

        const mat = new THREE.MeshStandardMaterial({
            color:     baseColor,
            roughness: isMetal ? 0.25 : 0.92,
            metalness: isMetal ? 0.85 : 0.0,
            emissive:  isHot ? new THREE.Color(0x331100) : new THREE.Color(0x000000),
            emissiveIntensity: isHot ? 0.4 : 0.0,
        })

        const mesh = new THREE.Mesh(geo, mat)
        mesh.castShadow    = true
        mesh.receiveShadow = true

        // Posição no cinturão — entre Marte (27000) e Júpiter (42000)
        const dist   = 30000 + Math.random() * 9000
        const ang    = Math.random() * Math.PI * 2
        const incl   = (Math.random() - 0.5) * 1800
        mesh.position.set(
            Math.cos(ang) * dist,
            incl,
            Math.sin(ang) * dist
        )
        mesh.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        )

        group.add(mesh)
        asteroids.push({
            mesh,
            rx: (Math.random() - 0.5) * 0.012,  // rotação pode ser retrógrada
            ry: (Math.random() - 0.5) * 0.012,
            rz: (Math.random() - 0.5) * 0.004,
        })
    }

    // Poeira difusa do cinturão (partículas muito pequenas)
    const dustCount = 4000
    const dustGeo   = new THREE.BufferGeometry()
    const dustPos   = new Float32Array(dustCount * 3)
    for (let i = 0; i < dustCount * 3; i += 3) {
        const dist  = 29000 + Math.random() * 11000
        const ang   = Math.random() * Math.PI * 2
        dustPos[i]   = Math.cos(ang) * dist
        dustPos[i+1] = (Math.random() - 0.5) * 2000
        dustPos[i+2] = Math.sin(ang) * dist
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
    group.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({
        color: 0x7a6a58, size: 3.5, transparent: true, opacity: 0.18, sizeAttenuation: true
    })))

    systemGroup.add(group)
}

// ─────────────────────────────────────────────
//  SOL  (com corona de glow)
// ─────────────────────────────────────────────
function createSun() {
    const geo = new THREE.SphereGeometry(3800, 64, 64)
    const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xff6600,
        emissiveIntensity: 5.0
    })
    textureLoader.load('/texturas/sun.jpg', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        mat.map = tex; mat.needsUpdate = true
    })
    const sun = new THREE.Mesh(geo, mat)

    // Corona maior
    const coronaGeo = new THREE.SphereGeometry(5200, 32, 32)
    const coronaMat = new THREE.MeshBasicMaterial({
        color: 0xff8800,
        transparent: true,
        opacity: 0.06,
        side: THREE.BackSide
    })
    sun.add(new THREE.Mesh(coronaGeo, coronaMat))

    const label = createPlanetLabel('Sol')
    label.position.set(0, 4600, 0)
    sun.add(label)

    systemGroup.add(sun)
    return sun
}

// ─────────────────────────────────────────────
//  PLANETAS
// ─────────────────────────────────────────────
const planetsData = [
    { name: 'Mercúrio', texture: '/texturas/mercury.jpg', size: 380,   distance: 6500,  speed: 0.003,  roughness: 0.8, metalness: 0.1, moons: [] },
    { name: 'Vênus',    texture: '/texturas/venus.jpg',   size: 920,   distance: 10500, speed: 0.002,  roughness: 0.8, metalness: 0.0, moons: [] },
    {
        name: 'Terra', texture: '/texturas/earth.jpg', size: 1100, distance: 15500, speed: 0.0015, roughness: 0.6, metalness: 0.1,
        moons: [{ name: 'Lua', texture: '/texturas/moon.jpg', size: 300, distance: 2200, speed: 0.012 }]
    },
    {
        name: 'Marte', texture: '/texturas/mars.jpg', size: 680, distance: 27000, speed: 0.001, roughness: 0.8, metalness: 0.0,
        moons: [
            { name: 'Fobos', texture: '/texturas/phobos.jpg', size: 110, distance: 1200, speed: 0.018 },
            { name: 'Deimos', texture: '/texturas/deimos.jpg', size: 85,  distance: 1600, speed: 0.010 }
        ]
    },
    {
        name: 'Júpiter', texture: '/texturas/jupiter.jpg', size: 4200, distance: 42000, speed: 0.0005, roughness: 0.7, metalness: 0.0,
        moons: [
            { name: 'Io',        texture: '/texturas/io.jpg',       size: 220,  distance: 5800, speed: 0.008 },
            { name: 'Europa',    texture: '/texturas/europa.jpg',    size: 200,  distance: 7000, speed: 0.007 },
            { name: 'Ganimedes', texture: '/texturas/ganymede.jpg',  size: 360,  distance: 8800, speed: 0.005 },
            { name: 'Calisto',   texture: '/texturas/callisto.jpg',  size: 310,  distance: 10500,speed: 0.003 }
        ]
    },
    {
        name: 'Saturno', texture: '/texturas/saturn.jpg', size: 3400, distance: 60000, speed: 0.0003, roughness: 0.7, metalness: 0.0,
        moons: [
            { name: 'Encélado', texture: '/texturas/enceladus.jpg', size: 170,  distance: 8500,  speed: 0.006 },
            { name: 'Titã',     texture: '/texturas/titan.jpg',     size: 600,  distance: 11500, speed: 0.004 }
        ]
    }
]

const planets = []

function createPlanets() {
    planetsData.forEach((data) => {
        const planetGroup = new THREE.Group()
        systemGroup.add(planetGroup)

        const geo = new THREE.SphereGeometry(data.size, 64, 64)
        const mat = new THREE.MeshStandardMaterial({
            roughness: data.name === 'Saturno' ? 0.99 : 0.98,
            metalness: 0.0
        })

        textureLoader.load(data.texture, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace
            mat.map = tex; mat.needsUpdate = true
        })

        const mesh = new THREE.Mesh(geo, mat)
        mesh.castShadow = true
        mesh.receiveShadow = true
        planetGroup.add(mesh)

        const lbl = createPlanetLabel(data.name)
        lbl.position.set(0, data.size * 1.15, 0)
        mesh.add(lbl)

        // guarda referência para fade por distância
        const planetLabelObj = lbl

        // Atmosfera sutil
        const atmoGeo = new THREE.SphereGeometry(data.size * 1.035, 32, 32)
        const atmoMat = new THREE.MeshBasicMaterial({
            color: data.name === 'Terra'   ? 0x3388ff :
                   data.name === 'Vênus'   ? 0xffcc44 :
                   data.name === 'Marte'   ? 0xcc4422 : 0x334455,
            transparent: true,
            opacity: 0.07,
            side: THREE.BackSide
        })
        mesh.add(new THREE.Mesh(atmoGeo, atmoMat))

        // Anéis de Saturno
        if (data.name === 'Saturno') {
            const ringGeo = new THREE.BufferGeometry()
            const rCount  = 22000
            const rPos    = new Float32Array(rCount * 3)
            for (let i = 0; i < rCount * 3; i += 3) {
                const inner  = data.size * 1.3
                const outer  = data.size * 2.7
                const radius = inner + Math.random() * (outer - inner)
                const theta  = Math.random() * Math.PI * 2
                rPos[i]   = Math.cos(theta) * radius
                rPos[i+1] = (Math.random() - 0.5) * 8
                rPos[i+2] = Math.sin(theta) * radius
            }
            ringGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3))
            const ringMat = new THREE.PointsMaterial({
                color: 0x9e8e78, size: 5.5, transparent: true, opacity: 0.55
            })
            const rings = new THREE.Points(ringGeo, ringMat)
            rings.rotateX(Math.PI / 11)
            mesh.add(rings)
        }

        // Luas
        const planetMoons = []
        data.moons.forEach((md) => {
            const pivot = new THREE.Group()
            mesh.add(pivot)

            const mGeo = new THREE.SphereGeometry(md.size, 32, 32)
            const mMat = new THREE.MeshStandardMaterial({ roughness: 0.98, metalness: 0.0 })
            textureLoader.load(md.texture, (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace
                mMat.map = tex; mMat.needsUpdate = true
            })
            const mMesh = new THREE.Mesh(mGeo, mMat)
            mMesh.castShadow = true
            mMesh.position.x = md.distance
            pivot.add(mMesh)

            const mLbl = createMoonLabel(md.name)
            mLbl.position.set(0, md.size * 1.6, 0)
            mMesh.add(mLbl)

            planetMoons.push({ pivot, mesh: mMesh, speed: md.speed, angle: Math.random() * Math.PI * 2 })
        })

        // JWST na Terra
        if (data.name === 'Terra') {
            jwstGroup = new THREE.Group()
            const shieldMat = new THREE.MeshStandardMaterial({ color: 0x9999aa, roughness: 0.1, metalness: 0.8 })
            const shield = new THREE.Mesh(new THREE.BoxGeometry(45, 2, 25), shieldMat)
            jwstGroup.add(shield)

            const mirGeo = new THREE.CylinderGeometry(14, 14, 2, 6)
            mirGeo.rotateX(Math.PI / 2)
            const mir = new THREE.Mesh(mirGeo, new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.05, metalness: 1.0 }))
            mir.position.set(0, 12, -2)
            jwstGroup.add(mir)

            const mastMat = new THREE.MeshStandardMaterial({ color: 0x333333 })
            const mast1 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 18), mastMat)
            mast1.position.set(-6, 12, 8); mast1.rotateZ(-0.3)
            const mast2 = mast1.clone(); mast2.position.x = 6; mast2.rotateZ(0.6)
            jwstGroup.add(mast1, mast2)

            const jLbl = createJWSTLabel()
            jLbl.position.set(0, 35, 0)
            jwstGroup.add(jLbl)

            jwstGroup.position.set(3800, 250, 0)
            mesh.add(jwstGroup)
        }

        // Órbita — cor específica por planeta, linha dupla (glow + sólida)
        const orbitColors = {
            'Mercúrio': 0x888888, 'Vênus': 0xddaa44, 'Terra': 0x4488ff,
            'Marte': 0xcc4422, 'Júpiter': 0xbbaa88, 'Saturno': 0xccbb77
        }
        const orbitColor = orbitColors[data.name] || 0x8899bb
        const orbitPts = []
        for (let i = 0; i <= 360; i++) {
            const t = (i / 360) * Math.PI * 2
            orbitPts.push(new THREE.Vector3(Math.cos(t) * data.distance, 0, Math.sin(t) * data.distance))
        }
        const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts)
        // camada glow (bem transparente, simula brilho)
        systemGroup.add(new THREE.LineLoop(orbitGeo,
            new THREE.LineBasicMaterial({ color: orbitColor, transparent: true, opacity: 0.07 })
        ))
        // linha principal visível
        systemGroup.add(new THREE.LineLoop(orbitGeo,
            new THREE.LineBasicMaterial({ color: orbitColor, transparent: true, opacity: 0.25 })
        ))

        const angle = Math.random() * 0.2
        planetGroup.position.set(Math.cos(angle) * data.distance, 0, Math.sin(angle) * data.distance)

        planets.push({ group: planetGroup, mesh, angle, distance: data.distance, speed: data.speed, name: data.name, moons: planetMoons, labelObj: planetLabelObj })
    })
}

// ─────────────────────────────────────────────
//  NAVE ESPACIAL — Estilo NASA Scientific Explorer
// ─────────────────────────────────────────────
function createSpaceship() {
    const ship = new THREE.Group()

    // ── Materiais — sem reflexo (MeshLambertMaterial = só difuso) ──
    const hullMat = new THREE.MeshLambertMaterial({ color: 0xd0d5de })
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x1c2333 })
    const goldMat = new THREE.MeshLambertMaterial({ color: 0xb8821a, emissive: 0x221000, emissiveIntensity: 0.4 })
    const thrusterMat = new THREE.MeshLambertMaterial({ color: 0x2a3a4a })
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.85 })
    const solarMat = new THREE.MeshLambertMaterial({ color: 0x1a3a6a, emissive: 0x0a1a40, emissiveIntensity: 0.5 })

    // ── Fuselagem principal (cilindro) ──
    const fuseGeo = new THREE.CylinderGeometry(0.38, 0.38, 3.2, 16)
    fuseGeo.rotateX(Math.PI / 2)
    const fuse = new THREE.Mesh(fuseGeo, hullMat)
    ship.add(fuse)

    // ── Nariz cônico ──
    const noseGeo = new THREE.ConeGeometry(0.38, 1.1, 16)
    noseGeo.rotateX(Math.PI / 2)
    const nose = new THREE.Mesh(noseGeo, darkMat)
    nose.position.z = -2.15
    ship.add(nose)

    // ── Módulo de serviço traseiro (cilindro maior) ──
    const svcGeo = new THREE.CylinderGeometry(0.48, 0.44, 1.0, 16)
    svcGeo.rotateX(Math.PI / 2)
    const svc = new THREE.Mesh(svcGeo, darkMat)
    svc.position.z = 1.85
    ship.add(svc)

    // ── Isolamento térmico dourado (folha MLI) — faixas ao longo da fuselagem ──
    for (let i = 0; i < 4; i++) {
        const stripGeo = new THREE.CylinderGeometry(0.385, 0.385, 0.18, 16)
        stripGeo.rotateX(Math.PI / 2)
        const strip = new THREE.Mesh(stripGeo, goldMat)
        strip.position.z = -1.1 + i * 0.75
        ship.add(strip)
    }

    // ── Painéis solares (2 lados, 2 segmentos cada) ──
    function makeSolarPanel(xSide) {
        const panelGroup = new THREE.Group()

        // Haste de conexão
        const boomGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.6, 8)
        const boom = new THREE.Mesh(boomGeo, thrusterMat)
        boom.position.x = xSide * 0.9
        boom.position.z = 0.2
        panelGroup.add(boom)

        // Segmento interno do painel
        const p1Geo = new THREE.BoxGeometry(0.9, 0.02, 0.7)
        const p1 = new THREE.Mesh(p1Geo, solarMat)
        p1.position.x = xSide * 1.35
        p1.position.z = 0.2
        panelGroup.add(p1)

        // Grade do painel (linhas solares)
        const gridMat = new THREE.LineBasicMaterial({ color: 0x3366aa, transparent: true, opacity: 0.5 })
        for (let j = -3; j <= 3; j++) {
            const pts = [
                new THREE.Vector3(xSide * 0.9 + xSide * 0.01, 0.02, 0.2 + j * 0.1),
                new THREE.Vector3(xSide * 1.8 - xSide * 0.01, 0.02, 0.2 + j * 0.1)
            ]
            panelGroup.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(pts), gridMat
            ))
        }

        // Segmento externo do painel
        const p2Geo = new THREE.BoxGeometry(0.9, 0.02, 0.7)
        const p2 = new THREE.Mesh(p2Geo, solarMat)
        p2.position.x = xSide * 2.25
        p2.position.z = 0.2
        panelGroup.add(p2)

        ship.add(panelGroup)
    }
    makeSolarPanel(1)
    makeSolarPanel(-1)

    // ── Antena de prato ──
    const dishGeo = new THREE.SphereGeometry(0.28, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.45)
    const dish = new THREE.Mesh(dishGeo, hullMat)
    dish.rotation.x = -Math.PI * 0.5
    dish.position.set(0, 0.55, 0.5)
    ship.add(dish)

    // Haste da antena
    const dishMastGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8)
    const dishMast = new THREE.Mesh(dishMastGeo, thrusterMat)
    dishMast.position.set(0, 0.28, 0.5)
    ship.add(dishMast)

    // ── Thruster principal (bell nozzle) ──
    const nozzleGeo = new THREE.CylinderGeometry(0.18, 0.28, 0.5, 16, 1, true)
    nozzleGeo.rotateX(Math.PI / 2)
    const nozzle = new THREE.Mesh(nozzleGeo, thrusterMat)
    nozzle.position.z = 2.45
    ship.add(nozzle)

    // ── Glow do thruster principal — dinâmico ──
    const mainGlowMat = new THREE.MeshBasicMaterial({
        color: 0x66aaff, transparent: true, opacity: 0.0
    })
    const mainGlowGeo = new THREE.ConeGeometry(0.22, 0.9, 16)
    mainGlowGeo.rotateX(-Math.PI / 2)
    const mainGlow = new THREE.Mesh(mainGlowGeo, mainGlowMat)
    mainGlow.position.z = 2.95
    mainGlow.name = 'thruster_main_glow'
    ship.add(mainGlow)

    // ── Partículas de exaustão — cone de plasma ──
    const exhaustCount = 80
    const exhaustGeo   = new THREE.BufferGeometry()
    const exhaustPos   = new Float32Array(exhaustCount * 3)
    const exhaustVel   = new Float32Array(exhaustCount * 3) // velocidades por partícula
    for (let i = 0; i < exhaustCount; i++) {
        exhaustPos[i*3]   = (Math.random() - 0.5) * 0.3
        exhaustPos[i*3+1] = (Math.random() - 0.5) * 0.3
        exhaustPos[i*3+2] = 2.6 + Math.random() * 1.5
        exhaustVel[i*3]   = (Math.random() - 0.5) * 0.02
        exhaustVel[i*3+1] = (Math.random() - 0.5) * 0.02
        exhaustVel[i*3+2] = 0.04 + Math.random() * 0.08
    }
    exhaustGeo.setAttribute('position', new THREE.BufferAttribute(exhaustPos, 3))
    const exhaustMat = new THREE.PointsMaterial({
        color: 0x88ccff, size: 0.12, transparent: true, opacity: 0.0, sizeAttenuation: true
    })
    const exhaustParticles = new THREE.Points(exhaustGeo, exhaustMat)
    exhaustParticles.name = 'thruster_particles'
    ship.add(exhaustParticles)

    // ── RCS thrusters laterais ──
    const rcsPositions = [
        [0.42, 0.1, 1.0], [-0.42, 0.1, 1.0],
        [0.42, 0.1, -0.5], [-0.42, 0.1, -0.5]
    ]
    rcsPositions.forEach(([x, y, z]) => {
        const rcsGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.18, 8)
        rcsGeo.rotateZ(Math.PI / 2)
        const rcs = new THREE.Mesh(rcsGeo, thrusterMat)
        rcs.position.set(x, y, z)
        ship.add(rcs)

        // Mini-glow RCS
        const rcsGlowMat = new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.0 })
        const rcsGlow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), rcsGlowMat)
        rcsGlow.position.set(x * 1.22, y, z)
        rcsGlow.name = 'rcs_glow'
        ship.add(rcsGlow)
    })

    // ── Sensor científico (cilindro com janela) ──
    const sensorGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.35, 12)
    sensorGeo.rotateX(Math.PI / 2)
    const sensor = new THREE.Mesh(sensorGeo, darkMat)
    sensor.position.set(0, -0.45, -0.8)
    ship.add(sensor)

    const lensGeo = new THREE.CircleGeometry(0.08, 12)
    const lens = new THREE.Mesh(lensGeo, new THREE.MeshStandardMaterial({
        color: 0x88ccff, emissive: 0x224488, emissiveIntensity: 1.0,
        metalness: 0.2, roughness: 0.1
    }))
    lens.position.set(0, -0.45, -0.99)
    ship.add(lens)

    // ── Label ──
    const lbl = createShipLabel()
    lbl.position.set(0, 2.2, 0)
    ship.add(lbl)

    ship.position.set(0, 0, 16600)
    scene.add(ship)
    return ship
}

// ─────────────────────────────────────────────
//  ATUALIZAR NAVE
// ─────────────────────────────────────────────
function updateSpaceship() {
    if (!spaceship) return

    // pressed(): teclado OU tecla virtual binária da mão
    const pressed = (code) => keys[code] || (followShip && !!handKeys[code])

    // analog(): combina teclado (1.0) com valor analógico da mão (0..1 com inércia)
    // Teclado tem precedência total; mão usa valor contínuo
    const analogH      = keys['KeyA'] ? -1 : keys['KeyD'] ? 1
                       : (followShip ? handAnalog.h      : 0)
    const analogV      = keys['Space'] ? -1 : keys['ShiftLeft'] ? 1
                       : (followShip ? handAnalog.v      : 0)
    const analogThrust = keys['KeyW'] ? 1 : keys['KeyS'] ? -1
                       : (followShip ? handAnalog.thrust : 0)

    const isTurbo   = pressed('KeyE')
    // Velocidade base escalada pela intensidade analógica (0..1)
    const baseSpeed = isTurbo ? 420.0 : 95.0
    const moveSpeed = baseSpeed * Math.max(Math.abs(analogThrust), 0.15)
    const rotSpeed  = 0.038

    // Frente / Ré — progressivo
    if (analogThrust > 0.05)  spaceship.translateZ(-moveSpeed)
    if (analogThrust < -0.05) spaceship.translateZ( moveSpeed)

    // Rotação horizontal — progressiva + bank visual
    if (analogH < -0.05) {
        spaceship.rotation.y += rotSpeed * Math.abs(analogH)
        // Bank: inclina a nave no sentido da curva
        spaceship.rotation.z = THREE.MathUtils.lerp(spaceship.rotation.z,  0.42 * Math.abs(analogH), 0.08)
    } else if (analogH > 0.05) {
        spaceship.rotation.y -= rotSpeed * Math.abs(analogH)
        spaceship.rotation.z = THREE.MathUtils.lerp(spaceship.rotation.z, -0.42 * Math.abs(analogH), 0.08)
    } else {
        spaceship.rotation.z = THREE.MathUtils.lerp(spaceship.rotation.z, 0, 0.06)
    }

    // Pitch: nariz desce ao acelerar, sobe ao frear/ré
    const pitchTarget = analogThrust > 0.05 ? -0.10 * analogThrust
                      : analogThrust < -0.05 ?  0.12 * Math.abs(analogThrust)
                      : 0
    spaceship.rotation.x = THREE.MathUtils.lerp(spaceship.rotation.x, pitchTarget, 0.07)

    // Bounce suave vertical (suspensão da nave no espaço)
    const t = Date.now() * 0.0008
    const thrustingMag = Math.abs(analogThrust)
    const bounceAmp    = thrustingMag > 0.05 ? 0.004 : 0.012
    spaceship.position.y += Math.sin(t) * bounceAmp

    // Subir / Descer — progressivo
    if (analogV < -0.05) spaceship.position.y += baseSpeed * 0.6 * Math.abs(analogV)
    if (analogV >  0.05) spaceship.position.y -= baseSpeed * 0.6 * Math.abs(analogV)

    // ── Propulsores dinâmicos ──────────────────────────────────
    const thrustMag    = Math.abs(analogThrust)
    const isFwd        = analogThrust > 0.05
    const isRev        = analogThrust < -0.05
    const isTurning    = Math.abs(analogH) > 0.05
    const t2           = Date.now() * 0.015
    const flickerFast  = 0.7 + Math.sin(t2 * 3.1) * 0.15 + Math.sin(t2 * 7.3) * 0.08

    spaceship.traverse(child => {
        if (!child.isMesh && !(child instanceof THREE.Points)) return

        // ── Glow principal (cone de exaustão) ──
        if (child.name === 'thruster_main_glow') {
            const targetOpacity = isFwd
                ? (isTurbo ? 0.85 : 0.55) * thrustMag * flickerFast
                : isRev ? 0.15 * Math.abs(analogThrust) : 0
            child.material.opacity = THREE.MathUtils.lerp(child.material.opacity, targetOpacity, 0.18)

            // Cor: branco-azul normal → laranja-turbo
            const thrustColor = isTurbo
                ? new THREE.Color(0xff8833)
                : new THREE.Color(0x66aaff)
            child.material.color.lerp(thrustColor, 0.12)

            // Escala do cone cresce com a potência
            const scaleTarget = isFwd ? 0.8 + thrustMag * (isTurbo ? 2.2 : 1.1) : 0.3
            child.scale.z = THREE.MathUtils.lerp(child.scale.z, scaleTarget, 0.15)
        }

        // ── Partículas de plasma ──
        if (child.name === 'thruster_particles') {
            const targetOpacity = isFwd ? thrustMag * (isTurbo ? 0.9 : 0.55) * flickerFast : 0
            child.material.opacity = THREE.MathUtils.lerp(child.material.opacity, targetOpacity, 0.20)
            child.material.color.set(isTurbo ? 0xffaa44 : 0x88ccff)
            child.material.size = isTurbo ? 0.18 : 0.10

            // Animar posição das partículas (ciclo contínuo)
            const pos = child.geometry.attributes.position
            for (let i = 0; i < pos.count; i++) {
                pos.setZ(i, pos.getZ(i) + 0.06 + thrustMag * 0.12)
                if (pos.getZ(i) > 4.5) {
                    pos.setX(i, (Math.random() - 0.5) * 0.25)
                    pos.setY(i, (Math.random() - 0.5) * 0.25)
                    pos.setZ(i, 2.65)
                }
            }
            pos.needsUpdate = true
        }

        // ── Mini-glow RCS (ativado ao girar ou subir/descer) ──
        if (child.name === 'rcs_glow') {
            const rcsActive = isTurning || Math.abs(analogV) > 0.05
            const rcsTarget = rcsActive ? 0.55 * flickerFast : 0
            child.material.opacity = THREE.MathUtils.lerp(child.material.opacity, rcsTarget, 0.22)
        }
    })

    // ── FOV DINÂMICO: gigantismo ao se aproximar de planetas ──
    if (followShip) {
        // FOV base: turbo abre mais o campo (sensação de velocidade)
        let newFOV = isTurbo ? 95 : 72

        // Detecta o planeta mais próximo da nave
        let closestDist = Infinity
        planets.forEach(p => {
            const pPos = new THREE.Vector3()
            p.group.getWorldPosition(pPos)
            const d = spaceship.position.distanceTo(pPos)
            if (d < closestDist) closestDist = d
        })

        // Quanto mais perto de um planeta, mais o FOV fecha (sensação de magnitude)
        // Efeito forte abaixo de 20000 unidades de distância
        if (closestDist < 20000) {
            const proximity = 1.0 - Math.min(closestDist / 20000, 1.0)
            // FOV cai de 72 → 42 conforme se aproxima (gigantismo de lente longa)
            newFOV = THREE.MathUtils.lerp(newFOV, 42, proximity * proximity)
        }

        targetFOV = newFOV
    } else {
        targetFOV = 75 // restaura FOV padrão fora do modo nave
    }

    // Suaviza a transição do FOV
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, 0.06)
    camera.updateProjectionMatrix()

    if (followShip) {
        controls.enabled = false

        // Câmera bem próxima — nave parece grande, planetas colossais
        const backDist  = isTurbo ? 7.5 : 5.2
        const upH       = 1.1

        // Balançar câmera lateralmente ao girar (cockpit feel)
        const rollLean  = analogH * 0.55       // inclina com a curva
        const pitchLean = analogThrust * 0.18  // leve mergulho ao acelerar

        // Tremor ao acelerar (shake de propulsão)
        const thrustMag = Math.abs(analogThrust)
        const shakeAmt  = thrustMag * (isTurbo ? 0.055 : 0.018)
        const shakeX    = (Math.random() - 0.5) * shakeAmt
        const shakeY    = (Math.random() - 0.5) * shakeAmt

        const offset = new THREE.Vector3(shakeX, upH + shakeY, backDist)
            .applyQuaternion(spaceship.quaternion)
        camera.position.copy(spaceship.position).add(offset)

        // Mira levemente à frente da nave
        const lookOffset = new THREE.Vector3(0, -0.3, -120).applyQuaternion(spaceship.quaternion)
        const lookAt     = spaceship.position.clone().add(lookOffset)
        const up         = new THREE.Vector3(0, 1, 0)
            .applyAxisAngle(new THREE.Vector3(0, 0, 1), rollLean)
        const mat4 = new THREE.Matrix4().lookAt(camera.position, lookAt, up)
        camera.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(mat4), 0.12)

    } else {
        if (!firstPerson) controls.enabled = true
    }
}

// ─────────────────────────────────────────────
//  ANIMAR SISTEMA
// ─────────────────────────────────────────────
function animateSystem() {
    const delta = clock.getDelta()

    planets.forEach(p => {
        p.angle += p.speed * globalOrbitSpeedMultiplier
        p.group.position.x = Math.cos(p.angle) * p.distance
        p.group.position.z = Math.sin(p.angle) * p.distance
        p.mesh.rotation.y += (p.name === 'Júpiter' || p.name === 'Saturno') ? 0.004 : 0.0015
        p.moons.forEach(m => {
            m.pivot.rotation.y += m.speed * globalOrbitSpeedMultiplier
            m.mesh.rotation.y  += 0.008
        })

        // ── Fade do label por distância ──
        if (p.labelObj && p.labelObj._labelEl) {
            const pPos = new THREE.Vector3()
            p.group.getWorldPosition(pPos)
            const dist = camera.position.distanceTo(pPos)

            // visível entre 500 e 18000 unidades
            // abaixo de 500: some (muito perto, tamparia o planeta)
            // acima de 18000: some (longe demais)
            const NEAR_FADE_START  = 800
            const NEAR_FADE_END    = 300
            const FAR_FADE_START   = 12000
            const FAR_FADE_END     = 18000

            let opacity = 1.0
            if (dist < NEAR_FADE_START) {
                opacity = Math.max(0, (dist - NEAR_FADE_END) / (NEAR_FADE_START - NEAR_FADE_END))
            } else if (dist > FAR_FADE_START) {
                opacity = Math.max(0, 1.0 - (dist - FAR_FADE_START) / (FAR_FADE_END - FAR_FADE_START))
            }
            p.labelObj._labelEl.style.opacity = opacity.toFixed(3)
        }
    })

    if (jwstGroup) jwstGroup.rotation.y += 0.005
    asteroids.forEach(a => {
        a.mesh.rotation.x += a.rx
        a.mesh.rotation.y += a.ry
        a.mesh.rotation.z += a.rz
    })
}

// ─────────────────────────────────────────────
//  INICIALIZAÇÃO
// ─────────────────────────────────────────────
setupLighting()
createStars()
createNebula()
createAsteroidBelt()
createPlanets()
createSun()
spaceship = createSpaceship()

if (spaceship) {
    camera.position.copy(spaceship.position).add(new THREE.Vector3(0, 2.4, 9.5))
    camera.lookAt(spaceship.position)
}

// ─────────────────────────────────────────────
//  WEBSOCKET — controle por mãos (servidor Python)
// ─────────────────────────────────────────────
//
//  Protocolo bidirecional:
//  • Navegador → Servidor: {"followShip": true/false}
//    Informa o servidor qual modo está ativo para que ele
//    produza o payload correto (teclas ou rotação/velocidade).
//
//  • Servidor → Navegador:
//    Modo nave:        {"keys": ["KeyW", ...]}
//    Modo visão geral: {"keys": [], "rotX": n, "rotY": n, "velocidade": n}
// ─────────────────────────────────────────────
;(function conectarWebSocket() {
    let ws
    let timer
    let modoAnterior = null   // detecta mudança de modo para informar o servidor

    // Envia o modo atual ao servidor (se o WS estiver aberto)
    function enviarModo() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ followShip: followShip }))
        }
    }

    function conectar() {
        try {
            ws = new WebSocket('ws://localhost:8765')

            ws.onopen = () => {
                clearTimeout(timer)
                console.log('[WS] Servidor Python conectado.')
                // Informa o modo imediatamente ao conectar
                enviarModo()
                modoAnterior = followShip
            }

            ws.onmessage = (e) => {
                try {
                    const dados = JSON.parse(e.data)

                    // ── Modo nave ──────────────────────────────────────
                    if (followShip) {
                        // Teclas binárias (compatibilidade com pressed())
                        const ativas = new Set(dados.keys ?? [])
                        ;['KeyW','KeyS','KeyA','KeyD','Space','ShiftLeft','KeyE'].forEach(k => {
                            handKeys[k] = ativas.has(k)
                        })

                        // Dados analógicos: aceleração progressiva
                        // Armazenamos em handAnalog para uso no updateSpaceship
                        if (dados.analog) {
                            handAnalog.h      = dados.analog.h      ?? 0
                            handAnalog.v      = dados.analog.v      ?? 0
                            handAnalog.thrust = dados.analog.thrust ?? 0
                        }
                    } else {
                        // Zera tudo ao sair do modo nave
                        ;['KeyW','KeyS','KeyA','KeyD','Space','ShiftLeft','KeyE'].forEach(k => {
                            handKeys[k] = false
                        })
                        handAnalog.h = handAnalog.v = handAnalog.thrust = 0
                    }

                    // ── Modo visão geral: rotação + velocidade ─────────
                    if (!followShip && !firstPerson) {
                        if (dados.rotX !== undefined)
                            systemGroup.rotation.x = THREE.MathUtils.lerp(
                                systemGroup.rotation.x, dados.rotX, 0.22
                            )
                        if (dados.rotY !== undefined)
                            systemGroup.rotation.y = THREE.MathUtils.lerp(
                                systemGroup.rotation.y, dados.rotY, 0.22
                            )
                        if (dados.velocidade !== undefined)
                            globalOrbitSpeedMultiplier = THREE.MathUtils.lerp(
                                globalOrbitSpeedMultiplier,
                                THREE.MathUtils.clamp(dados.velocidade, 0, 3),
                                0.12
                            )
                    }

                } catch { /* ignora frames malformados */ }
            }

            ws.onclose = () => {
                ;['KeyW','KeyS','KeyA','KeyD','Space','ShiftLeft','KeyE'].forEach(k => {
                    handKeys[k] = false
                })
                timer = setTimeout(conectar, 3000)
            }

            ws.onerror = () => { /* reconecta via onclose */ }

        } catch { /* tenta de novo em 3 s */ }
    }

    // Monitora mudança de modo no loop de animação e avisa o servidor
    const _animOriginal = window._wsModoPoll
    setInterval(() => {
        if (modoAnterior !== null && followShip !== modoAnterior) {
            modoAnterior = followShip
            enviarModo()
        }
    }, 150)   // verifica a cada 150 ms (sem custo perceptível)

    conectar()
})()

// MediaPipe no navegador desativado — câmera gerenciada pelo hand_control_server.py
// Para reativar: descomentar a linha abaixo e rodar sem o Python
// iniciarMediaPipe()

// ─────────────────────────────────────────────
//  LOOP
// ─────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate)
    animateSystem()
    updateSpaceship()
    updateTelemetry()
    if (firstPerson) updateFPSMovement()
    else if (!followShip) controls.update()
    composer.render()
    labelRenderer.render(scene, camera)
}
animate()

// ─────────────────────────────────────────────
//  RESIZE
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
    composer.setSize(window.innerWidth, window.innerHeight)
    labelRenderer.setSize(window.innerWidth, window.innerHeight)
})