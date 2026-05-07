import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

const scene = new THREE.Scene()

scene.background = new THREE.Color(0x000000)

scene.fog = new THREE.FogExp2(0x000814, 0.0004)

const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    3000
)

camera.position.set(0, 20, 45)

const renderer = new THREE.WebGLRenderer({
    antialias: true
})

renderer.setSize(window.innerWidth, window.innerHeight)

renderer.shadowMap.enabled = true

document.body.appendChild(renderer.domElement)

const composer = new EffectComposer(renderer)

composer.addPass(new RenderPass(scene, camera))

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5,
    0.4,
    0.85
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

controls.rotateSpeed = 0.5

controls.zoomSpeed = 1.2

controls.panSpeed = 0.8

const fpsControls = new PointerLockControls(camera, document.body)

let firstPerson = false

window.addEventListener('click', () => {

    if (firstPerson) {
        fpsControls.lock()
    }

})

const keys = {}

window.addEventListener('keydown', (e) => {
    keys[e.code] = true
})

window.addEventListener('keyup', (e) => {
    keys[e.code] = false
})

function updateFPSMovement() {

    const speed = 0.3

    if (keys['KeyW']) fpsControls.moveForward(speed)

    if (keys['KeyS']) fpsControls.moveForward(-speed)

    if (keys['KeyA']) fpsControls.moveRight(-speed)

    if (keys['KeyD']) fpsControls.moveRight(speed)

    if (keys['Space']) camera.position.y += speed

    if (keys['ShiftLeft']) camera.position.y -= speed
}

window.addEventListener('keydown', (e) => {

    if (e.code === 'KeyF') {

        firstPerson = !firstPerson

        controls.enabled = !firstPerson

        if (firstPerson) {
            fpsControls.lock()
        } else {
            fpsControls.unlock()
        }
    }

    if (e.code === 'Digit1') teleportToPlanet(0)

    if (e.code === 'Digit2') teleportToPlanet(1)

    if (e.code === 'Digit3') teleportToPlanet(2)

    if (e.code === 'Digit4') teleportToPlanet(3)

})

const textureLoader = new THREE.TextureLoader()

const planetsData = [
    {
        name: 'Mercúrio',
        texture: '/texturas/mercury.jpg',
        size: 0.5,
        distance: 8,
        speed: 0.02
    },

    {
        name: 'Vênus',
        texture: '/texturas/venus.jpg',
        size: 0.8,
        distance: 12,
        speed: 0.015
    },

    {
        name: 'Terra',
        texture: '/texturas/earth.jpg',
        size: 1,
        distance: 16,
        speed: 0.012
    },

    {
        name: 'Marte',
        texture: '/texturas/mars.jpg',
        size: 0.7,
        distance: 21,
        speed: 0.01
    },

    {
        name: 'Júpiter',
        texture: '/texturas/jupiter.jpg',
        size: 2.8,
        distance: 30,
        speed: 0.006
    },

    {
        name: 'Saturno',
        texture: '/texturas/saturn.jpg',
        size: 2.2,
        distance: 40,
        speed: 0.004
    }
]

const planets = []

function createStars() {

    const geometry = new THREE.BufferGeometry()

    const vertices = []

    for (let i = 0; i < 12000; i++) {

        const x = (Math.random() - 0.5) * 3000
        const y = (Math.random() - 0.5) * 3000
        const z = (Math.random() - 0.5) * 3000

        vertices.push(x, y, z)
    }

    geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices, 3)
    )

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.7
    })

    const stars = new THREE.Points(geometry, material)

    scene.add(stars)

    return stars
}

function createSun() {

    const geometry = new THREE.SphereGeometry(4, 64, 64)

    const texture = textureLoader.load('/textures/sun.jpg')

    const material = new THREE.MeshStandardMaterial({
        map: texture,
        emissive: 0xffaa33,
        emissiveIntensity: 2
    })

    const sun = new THREE.Mesh(geometry, material)

    scene.add(sun)

    return sun
}

function createPlanets() {

    planetsData.forEach((data) => {

        const geometry = new THREE.SphereGeometry(data.size, 64, 64)

        const material = new THREE.MeshStandardMaterial({
            map: textureLoader.load(data.texture),
            roughness: 1
        })

        const planet = new THREE.Mesh(geometry, material)

        const angle = Math.random() * Math.PI * 2

        planet.position.x = Math.cos(angle) * data.distance

        planet.position.z = Math.sin(angle) * data.distance

        scene.add(planet)

        const div = document.createElement('div')

        div.className = 'planet-label'

        div.textContent = data.name

        const label = new CSS2DObject(div)

        label.position.set(0, data.size + 0.6, 0)

        planet.add(label)

        planets.push({
            mesh: planet,
            angle: angle,
            distance: data.distance,
            speed: data.speed
        })

        const points = []

        for (let i = 0; i <= 128; i++) {

            const theta = (i / 128) * Math.PI * 2

            points.push(
                new THREE.Vector3(
                    Math.cos(theta) * data.distance,
                    0,
                    Math.sin(theta) * data.distance
                )
            )
        }

        const orbitGeometry =
            new THREE.BufferGeometry().setFromPoints(points)

        const orbitMaterial = new THREE.LineBasicMaterial({
            color: 0x335577,
            transparent: true,
            opacity: 0.4
        })

        const orbit = new THREE.LineLoop(
            orbitGeometry,
            orbitMaterial
        )

        scene.add(orbit)
    })
}

function setupLighting() {

    // Luz ambiente forte
    const ambient = new THREE.AmbientLight(
        0xffffff,
        1.2
    )

    scene.add(ambient)

    // Luz principal do Sol
    const sunLight = new THREE.PointLight(
        0xffffff,
        10,
        2000
    )

    sunLight.position.set(0, 0, 0)

    scene.add(sunLight)

    // Luz azul suave espacial
    const blueLight = new THREE.DirectionalLight(
        0x4488ff,
        0.5
    )

    blueLight.position.set(50, 20, 20)

    scene.add(blueLight)

    // Luz traseira cinematográfica
    const rimLight = new THREE.DirectionalLight(
        0xff8844,
        0.35
    )

    rimLight.position.set(-50, -10, -20)

    scene.add(rimLight)
}

function teleportToPlanet(index) {

    if (!planets[index]) return

    const planet = planets[index].mesh

    camera.position.copy(planet.position)

    camera.position.z += 5
}

function animatePlanets() {

    planets.forEach((planet) => {

        planet.angle += planet.speed

        const x = Math.cos(planet.angle) * planet.distance

        const z = Math.sin(planet.angle) * planet.distance

        planet.mesh.position.set(x, 0, z)

        planet.mesh.rotation.y += 0.01
    })
}

setupLighting()

const stars = createStars()

const sun = createSun()

createPlanets()

function animate() {

    requestAnimationFrame(animate)

    animatePlanets()

    stars.rotation.y += 0.0001

    sun.rotation.y += 0.002

    if (firstPerson) {
        updateFPSMovement()
    } else {
        controls.update()
    }

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