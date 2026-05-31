import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

let spaceship
let followShip = true 
let firstPerson = false

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x010103)

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 1, 600000)
camera.position.set(0, 100, 300)

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.1 // 💡 Reduzido para diminuir a claridade geral da tela
document.body.appendChild(renderer.domElement)

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.2,  // Força do brilho do Sol mantida para a estrela irradiar
    0.5,  
    0.2   
)
composer.addPass(bloomPass)

const labelRenderer = new CSS2DRenderer()
labelRenderer.setSize(window.innerWidth, window.innerHeight)
labelRenderer.domElement.style.position = 'absolute'
labelRenderer.domElement.style.top = '0px'
labelRenderer.domElement.style.pointerEvents = 'none'
document.body.appendChild(labelRenderer.domElement)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.maxDistance = 250000

const fps = new PointerLockControls(camera, document.body)
const keys = {}

window.addEventListener('keydown', (e) => {
    keys[e.code] = true
    if (e.code === 'KeyF') {
        firstPerson = !firstPerson; followShip = false;
        controls.enabled = !firstPerson;
        firstPerson ? fps.lock() : fps.unlock()
    }
    if (e.code === 'KeyN') {
        followShip = !followShip; firstPerson = false;
        if (followShip) fps.unlock()
    }
})
window.addEventListener('keyup', (e) => { keys[e.code] = false })

function updateFPSMovement() {
    const speed = 40.0 
    if (keys['KeyW']) fps.moveForward(speed)
    if (keys['KeyS']) fps.moveForward(-speed)
    if (keys['KeyA']) fps.moveRight(-speed)
    if (keys['KeyD']) fps.moveRight(speed)
    if (keys['Space']) camera.position.y += speed
    if (keys['ShiftLeft']) camera.position.y -= speed
}

function setupLighting() {
    const ambientLight = new THREE.AmbientLight(0x0e1424, 0.2) 
    scene.add(ambientLight)

    // 💡 Reduzida a intensidade de 5.0 para 2.5 para suavizar o impacto direto nos planetas
    const sunLight = new THREE.PointLight(0xfff3e0, 2.5, 500000, 0.0) 
    sunLight.castShadow = true
    sunLight.shadow.mapSize.width = 2048
    sunLight.shadow.mapSize.height = 2048
    sunLight.shadow.camera.near = 100
    sunLight.shadow.camera.far = 500000
    scene.add(sunLight)
}

const textureLoader = new THREE.TextureLoader()

function createStars() {
    const starCount = 10000
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(starCount * 3)
    const colors = new Float32Array(starCount * 3)

    for (let i = 0; i < starCount * 3; i += 3) {
        const radius = 200000 + Math.random() * 50000
        const u = Math.random()
        const v = Math.random()
        const theta = u * 2.0 * Math.PI
        const phi = Math.acos(2.0 * v - 1.0)
        
        positions[i] = radius * Math.sin(phi) * Math.cos(theta)
        positions[i+1] = radius * Math.sin(phi) * Math.sin(theta)
        positions[i+2] = radius * Math.cos(phi)

        colors[i] = 0.9 + Math.random() * 0.1
        colors[i+1] = 0.9 + Math.random() * 0.1
        colors[i+2] = 1.0
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const material = new THREE.PointsMaterial({
        size: 3.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.9
    })

    const starField = new THREE.Points(geometry, material)
    scene.add(starField)
}

function createAsteroidBelt() {
    const asteroidCount = 400
    const asteroidGroup = new THREE.Group()

    for(let i=0; i < asteroidCount; i++) {
        const size = 8 + Math.random() * 18
        const geo = new THREE.DodecahedronGeometry(size, 1)
        // Asteroides mais escuros e foscos
        const mat = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.95 })
        const asteroid = new THREE.Mesh(geo, mat)

        const distance = 19500 + Math.random() * 4500
        const angle = Math.random() * Math.PI * 2
        
        asteroid.position.x = Math.cos(angle) * distance
        asteroid.position.y = (Math.random() - 0.5) * 500
        asteroid.position.z = Math.sin(angle) * distance

        asteroid.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, 0)
        
        asteroidGroup.add(asteroid)
        asteroids.push({
            mesh: asteroid,
            rotSpeedX: Math.random() * 0.007,
            rotSpeedY: Math.random() * 0.007
        })
    }
    scene.add(asteroidGroup)
}
const asteroids = []

function createSun() {
    const geo = new THREE.SphereGeometry(1500, 64, 64)
    const mat = new THREE.MeshStandardMaterial({ 
        color: 0xffbb44,
        emissive: 0xffaa00,
        emissiveIntensity: 4.0 
    }) 
    
    textureLoader.load('/texturas/sun.jpg', (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        mat.map = texture
        mat.needsUpdate = true
    })
    
    const sun = new THREE.Mesh(geo, mat)
    scene.add(sun)
    return sun
}

// 🪐 PLANETAS E LUAS (Rugosidade aumentada para espalhar a luz suavemente, sem reflexo estourado)
const planetsData = [
    { name: 'Mercúrio', texture: '/texturas/mercury.jpg', size: 150,  distance: 5500,  speed: 0.003,  color: 0x777777, roughness: 0.95, metalness: 0.0, moons: [] },
    { name: 'Vênus',    texture: '/texturas/venus.jpg',   size: 400,  distance: 9000,  speed: 0.002,  color: 0xccaa77, roughness: 0.90, metalness: 0.0, moons: [] },
    { 
        name: 'Terra', texture: '/texturas/earth.jpg', size: 500, distance: 13500, speed: 0.0015, color: 0x1122dd, roughness: 0.75, metalness: 0.0,
        moons: [
            { name: 'Lua', size: 120, distance: 1100, speed: 0.012, color: 0x888888, roughness: 0.95 }
        ] 
    },
    { 
        name: 'Marte', texture: '/texturas/mars.jpg', size: 300, distance: 25000, speed: 0.001, color: 0xaa3311, roughness: 0.95, metalness: 0.0,
        moons: [
            { name: 'Fobos', size: 45, distance: 650, speed: 0.018, color: 0x665544, roughness: 0.95 },
            { name: 'Deimos', size: 35, distance: 850, speed: 0.010, color: 0x776655, roughness: 0.95 }
        ] 
    },
    { 
        name: 'Júpiter', texture: '/texturas/jupiter.jpg', size: 1800, distance: 36000, speed: 0.0005, color: 0xa07030, roughness: 0.85, metalness: 0.0,
        moons: [
            { name: 'Io', size: 90, distance: 2800, speed: 0.008, color: 0xbbbb22, roughness: 0.90 },
            { name: 'Europa', size: 85, distance: 3300, speed: 0.007, color: 0x88aabb, roughness: 0.85 },
            { name: 'Ganimedes', size: 150, distance: 4100, speed: 0.005, color: 0x777777, roughness: 0.90 },
            { name: 'Calisto', size: 130, distance: 4900, speed: 0.003, color: 0x555555, roughness: 0.90 }
        ] 
    },
    { 
        name: 'Saturno', texture: '/texturas/saturn.jpg', size: 1400, distance: 51000, speed: 0.0003, color: 0xd2af6d, roughness: 0.85, metalness: 0.0,
        moons: [
            { name: 'Encélado', size: 70, distance: 4200, speed: 0.006, color: 0xcccccc, roughness: 0.80 },
            { name: 'Titã', size: 250, distance: 5600, speed: 0.004, color: 0xd39847, roughness: 0.90 }
        ] 
    }
]

const planets = []

function createPlanets() {
    planetsData.forEach((data) => {
        const planetGroup = new THREE.Group()
        scene.add(planetGroup)

        const geo = new THREE.SphereGeometry(data.size, 64, 64)
        const mat = new THREE.MeshStandardMaterial({ 
            color: data.color,
            roughness: data.roughness,
            metalness: data.metalness
        })

        textureLoader.load(data.texture, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace
            mat.map = texture
            mat.color.setHex(0xffffff)
            mat.needsUpdate = true
        })

        const planetMesh = new THREE.Mesh(geo, mat)
        planetMesh.castShadow = true
        planetMesh.receiveShadow = true
        planetGroup.add(planetMesh)

        if (data.name === 'Saturno') {
            const particleCount = 18000
            const ringGeometry = new THREE.BufferGeometry()
            const positions = new Float32Array(particleCount * 3)

            for (let i = 0; i < particleCount * 3; i += 3) {
                const innerRadius = data.size * 1.3
                const outerRadius = data.size * 2.6
                const radius = innerRadius + Math.random() * (outerRadius - innerRadius)
                const theta = Math.random() * Math.PI * 2

                positions[i] = Math.cos(theta) * radius
                positions[i+1] = (Math.random() - 0.5) * 5
                positions[i+2] = Math.sin(theta) * radius
            }

            ringGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
            const ringMaterial = new THREE.PointsMaterial({
                color: 0x968773, // Anel levemente mais escuro e realista
                size: 5.0,
                transparent: true,
                opacity: 0.6
            })

            const ringParticles = new THREE.Points(ringGeometry, ringMaterial)
            ringParticles.rotateX(Math.PI / 11) 
            planetMesh.add(ringParticles)
        }

        const planetMoons = []
        data.moons.forEach((moonData) => {
            const moonGeo = new THREE.SphereGeometry(moonData.size, 32, 32)
            const moonMat = new THREE.MeshStandardMaterial({ 
                color: moonData.color,
                roughness: moonData.roughness, // Aplicando alta rugosidade para não refletir forte
                metalness: 0.0
            })
            const moonMesh = new THREE.Mesh(moonGeo, moonMat)
            moonMesh.castShadow = true
            moonMesh.receiveShadow = true
            
            planetGroup.add(moonMesh)
            planetMoons.push({
                mesh: moonMesh,
                distance: moonData.distance,
                speed: moonData.speed,
                angle: Math.random() * Math.PI * 2
            })
        })

        const angle = Math.random() * 0.2
        planetGroup.position.x = Math.cos(angle) * data.distance
        planetGroup.position.z = Math.sin(angle) * data.distance

        const points = []
        for (let i = 0; i <= 360; i++) {
            const theta = (i / 360) * Math.PI * 2
            points.push(new THREE.Vector3(Math.cos(theta) * data.distance, 0, Math.sin(theta) * data.distance))
        }
        const orbit = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.02 })
        )
        scene.add(orbit)

        planets.push({ 
            group: planetGroup, 
            mesh: planetMesh,
            angle, 
            distance: data.distance, 
            speed: data.speed, 
            name: data.name,
            moons: planetMoons 
        })
    })
}

function createSpaceship() {
    const ship = new THREE.Group()

    const bodyGeo = new THREE.ConeGeometry(0.25, 1.8, 5) 
    bodyGeo.rotateX(Math.PI / 2)
    const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x112233,
        metalness: 0.9,
        roughness: 0.1,
        emissive: 0x00ffff,
        emissiveIntensity: 0.5 
    })
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.castShadow = true
    body.receiveShadow = true
    ship.add(body)

    const engineGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.3, 16)
    engineGeo.rotateX(Math.PI / 2)
    const engineMat = new THREE.MeshBasicMaterial({ color: 0xff2200 }) 
    
    const leftEngine = new THREE.Mesh(engineGeo, engineMat)
    leftEngine.position.set(-0.2, -0.1, -0.8)
    const rightEngine = leftEngine.clone()
    rightEngine.position.x = 0.2

    ship.add(leftEngine, rightEngine)
    
    ship.position.set(0, 0, 14280) 
    scene.add(ship)
    return ship
}

function updateSpaceship() {
    if (!spaceship) return

    const moveSpeed = keys['KeyE'] ? 450.0 : 85.0 
    const rotSpeed = 0.035 

    if (keys['KeyW']) spaceship.translateZ(-moveSpeed)
    if (keys['KeyS']) spaceship.translateZ(moveSpeed)
    if (keys['KeyA']) spaceship.rotation.y += rotSpeed
    if (keys['KeyD']) spaceship.rotation.y -= rotSpeed
    if (keys['Space']) spaceship.position.y += moveSpeed
    if (keys['ShiftLeft']) spaceship.position.y -= moveSpeed

    if (followShip) {
        controls.enabled = false
        const targetOffset = new THREE.Vector3(0, 1.3, 4.8).applyQuaternion(spaceship.quaternion)
        const targetCamPos = spaceship.position.clone().add(targetOffset)
        
        camera.position.lerp(targetCamPos, 0.15)

        const lookAtTarget = spaceship.position.clone().add(
            new THREE.Vector3(0, 0, -200).applyQuaternion(spaceship.quaternion)
        )
        camera.lookAt(lookAtTarget)
    } else {
        if (!firstPerson) controls.enabled = true
    }
}

function animateSystem() {
    planets.forEach(p => {
        p.angle += p.speed
        p.group.position.x = Math.cos(p.angle) * p.distance
        p.group.position.z = Math.sin(p.angle) * p.distance
        
        p.mesh.rotation.y += (p.name === 'Júpiter' || p.name === 'Saturno') ? 0.004 : 0.0015

        p.moons.forEach(m => {
            m.angle += m.speed
            m.mesh.position.x = Math.cos(m.angle) * m.distance
            m.mesh.position.z = Math.sin(m.angle) * m.distance
            m.mesh.rotation.y += 0.008
        })
    })

    asteroids.forEach(ast => {
        ast.mesh.rotation.x += ast.rotSpeedX
        ast.mesh.rotation.y += ast.rotSpeedY
    })
}

// --- INICIALIZAÇÃO ---
setupLighting()
createStars()
createAsteroidBelt()
createPlanets()
createSun()
spaceship = createSpaceship()

if (spaceship) {
    camera.position.set(0, 1.3, 14284.8)
    camera.lookAt(spaceship.position)
}

function animate() {
    requestAnimationFrame(animate)

    animateSystem()
    updateSpaceship()

    if (firstPerson) updateFPSMovement()
    else if (!followShip) controls.update()

    composer.render()
    labelRenderer.render(scene, camera)
}
animate()

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
    composer.setSize(window.innerWidth, window.innerHeight)
    labelRenderer.setSize(window.innerWidth, window.innerHeight)
})