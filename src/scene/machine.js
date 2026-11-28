// 3D machine shown behind every page (src/scene/stage.js), adapted from
// axis-launcher-front (webgl/components/MachineComponent.js + ButtonManager /
// JoystickManager): same model, same matcap materials, same press offsets.
//
// Stages (setStage): each page picks a camera pose and an atmosphere, and the
// camera eases from one to the next.
//   'hub'          machine on the right half, neutral (no green), screen off
//   'calibration'  { joystick: null } both sticks, { joystick: 1 | 2 } that one;
//                  green atmosphere like the LED check
//   'screen'       facing the screen, green, screen dark (the dive into the input
//                  debugger: diveIntoScreen())
//   'led'          the LED check: rest view, green atmosphere; once there,
//                  the mouse orbit, W focus and joystick orbit take over
//
// What the pages drive:
//   setButton(key, id, pressed)   button moves in and its LED lights (white)
//   setHome(pressed)              same for Home
//   setStrip(side, colors)        side = 'left' | 'right', one CSS colour or
//                                 null (off) per LED, index 0 = first LED
//   setJoystick(id, x, y)         stick tilt, -1..1
//   setFocus(side, on)            orbit the camera to show a side strip
//                                 while its sweep runs ('left' | 'right')
//   setOrbit(x, y)                joystick orbit, x -1 (right side) .. 1 (left),
//                                 y subtle rise (up) / dip (down)
//
// Everything starts dark. Glow is the front's selective bloom
// (selectiveBloom.js): only the LED strips and buttons glow. The machine
// stands on a dark checker floor that fades into black.

import {
    CanvasTexture,
    Box2,
    Box3,
    Color,
    ColorManagement,
    DoubleSide,
    LinearSRGBColorSpace,
    Mesh,
    MeshBasicMaterial,
    MathUtils,
    NearestFilter,
    PerspectiveCamera,
    PlaneGeometry,
    Scene,
    Spherical,
    ShaderMaterial,
    TextureLoader,
    Vector2,
    Vector3,
    WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SelectiveBloom } from './selectiveBloom.js';
import { MatrixScreen } from './matrixScreen.js';

// The front runs three r140 without colour management: colours and textures
// go to the screen as authored. Same here, so the bloom settings match.
ColorManagement.enabled = false;

const MODEL_URL = '/models/axis-machine.glb';
const MATCAPS = {
    mirror1: '/textures/matcaps/matcap-mirror-1.png',
    mirror2: '/textures/matcaps/matcap-mirror-2.png',
    clearSoft: '/textures/matcaps/matcap-clear-soft.png',
};
const VENTILATION_URL = '/textures/axis-machine-ventilation.png';

export const STRIP_LENGTH = 51;

// Which end of each strip mesh is LED 0. Flip if the 3D sweep runs the
// opposite way from the real strip.
const STRIP_FLIP = { left: false, right: false };

// Press offsets from the front's ButtonManager (model units).
const PRESS_DEPTH = 0.02;
const BUZZER_DEPTH = 0.03;
const JOYSTICK_TILT = (30 * Math.PI) / 180;

const BUTTON_OFF = '#2e2e2e';
const BUTTON_ON = '#ffffff';

// Floor: checker tiles (model units), fading to black away from the machine.
// Tiles are sized from the cabinet's base at floor level (the 'borne' mesh,
// buzzers left out) so it covers exactly 2 x 2 tiles.
const FLOOR = {
    footprintTiles: 2,
    colorA: '#0b0d0c',
    colorB: '#141815',
    lightColor: '#164522', // green pool of light under the machine
    lightRadius: 4.5,
    fadeNear: 6,
    fadeFar: 28,
};

// Atmospheres, blended per stage (0 = neutral, 1 = matrix). Matrix:
// everything stays dark with a faint green cast. The background and the
// floor's far fade share `background`; the machine's matcap shading is
// multiplied by `tint`. Neutral: same values, grey.
const ATMOSPHERES = {
    neutral: {
        background: '#050505',
        floorA: '#0b0b0b',
        floorB: '#131313',
        light: '#0c0c0c',
        tint: '#f2f2f2',
    },
    matrix: {
        background: '#050806',
        floorA: FLOOR.colorA,
        floorB: FLOOR.colorB,
        light: FLOOR.lightColor,
        tint: '#e6ffeb',
    },
};
const BACKGROUND = ATMOSPHERES.matrix.background;

// The machine faces +x. Rest view: from the front, slightly above and to the
// right. The strips sit on the front corners of the lower body and face
// sideways, so the camera orbits towards the side being swept.
const VIEW_DIRECTION = new Vector3(1, 0.22, -0.18).normalize();
const FOV = 20;
const FOCUS_YAW = { left: MathUtils.degToRad(55), right: MathUtils.degToRad(-55) };
const FOCUS_RETURN_DELAY_MS = 1200;
// Fraction of the remaining angle covered per second (smooth ease-out).
const FOCUS_EASE = 4;
// Joystick y: subtle camera rise / dip. Down stays small so the camera keeps
// above the floor limit (maxPolarAngle) from the rest view.
const PITCH_UP = MathUtils.degToRad(12);
const PITCH_DOWN = MathUtils.degToRad(5);

// Stage camera moves: fraction of the remaining way covered per second.
const STAGE_EASE = 2.6;
const ATMOSPHERE_EASE = 2;
// Hub: rest direction, this much further than the rest view, machine on
// the right half of the screen (the menu's column is on the left).
const HUB = { distance: 1.3, shiftX: 0.21 };
// Screen power on / off, fraction of the remaining way per second.
const SCREEN_EASE = 5;

// Dive into the screen (diveIntoScreen), ms from the start. The camera
// swings to face the screen (stage ease) with the screen dark (no rain), the
// screen fades to white, then the camera dives in, accelerating, until the
// white screen fills the view.
const DIVE = {
    lightAt: 1100,
    lightMs: 350,
    diveAt: 1500,
    diveMs: 900,
    whiteBefore: 350, // onWhite() this long before the end (page cover)
    frame: 0.42, // screen height / view height while facing it
};
// Calibration, from the front and above (+x is the front, +z the left
// side). Distances are fractions of the machine's bounding radius.
// shiftX / shiftY move the target on screen (fractions of the viewport,
// + = right / down) so it clears the page's text and pads.
// The shots aim at the ball of each stick (STICK_HEIGHT above its pivot).
// Content is on the left: the sticks sit in the middle of the right half.
// lookY raises (+) or lowers (-) the aimed point, lookX moves it sideways
// (+ = towards the machine's right side, screen right from the front), in
// model units.
const CALIBRATION = {
    // Low, slightly from the right: seen from above, the plexiglass panel
    // catches the matcap's highlight and turns bright.
    both: { direction: new Vector3(0.974, 0.18, -0.225), distance: 4.75, lookX: 0.34, lookY: 0, shiftX: 0.24, shiftY: 0 },
    1: { direction: new Vector3(0.857, 0.57, 0.515), distance: 2.4, lookX: 0.11, lookY: -0.09, shiftX: 0.24, shiftY: 0 },
    2: { direction: new Vector3(0.695, 0.57, -0.719), distance: 2.4, lookX: 0.11, lookY: -0.1, shiftX: 0.24, shiftY: 0 },
};
const STICK_HEIGHT = 0.22;

const BUTTON_MESHES = {
    'a:1': 'bouton_A_gauche',
    'x:1': 'bouton_X_gauche',
    'i:1': 'bouton_I_gauche',
    's:1': 'bouton_S_gauche',
    'w:1': 'buzzer_gauche',
    'a:2': 'bouton_A_droite',
    'x:2': 'bouton_X_droite',
    'i:2': 'bouton_I_droite',
    's:2': 'bouton_S_droite',
    'w:2': 'buzzer_droite',
    'home:0': 'bouton_start',
};

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

const matcapVertex = /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec2 vUv;

    void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

// Same matcap lookup as the front's shaders/matcap.
const matcapFragment = /* glsl */ `
    uniform sampler2D matcap;
    uniform sampler2D map;
    uniform vec3 color;
    uniform vec3 tint;
    uniform bool useMap;

    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec2 vUv;

    void main() {
        vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 viewDir = normalize(vViewPosition);
        vec3 x = normalize(vec3(viewDir.z, 0.0, -viewDir.x));
        vec3 y = cross(viewDir, x);
        vec2 matcapUv = vec2(dot(x, normal), dot(y, normal)) * 0.495 + 0.5;

        vec3 base = useMap ? texture2D(map, vUv).rgb : color;
        // The front's matcaps are photos (a brown ground shows through on
        // the front faces): keep their light, drop their colour.
        vec3 matcapColor = texture2D(matcap, matcapUv).rgb;
        float light = dot(matcapColor, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4(base * light * tint, 1.0);
    }
`;

function matcapMaterial(matcap, tint, { color = '#ffffff', map = null } = {}) {
    return new ShaderMaterial({
        vertexShader: matcapVertex,
        fragmentShader: matcapFragment,
        uniforms: {
            matcap: { value: matcap },
            map: { value: map },
            color: { value: new Color(color) },
            tint: { value: tint }, // shared: follows the atmosphere
            useMap: { value: Boolean(map) },
        },
        side: DoubleSide,
    });
}

function loadTexture(loader, url) {
    return loader.loadAsync(url);
}

// Floor: anti-aliased checker (filtered with fwidth so it stays clean far
// away), a green pool of light under the machine, then a fade to the background
// that hides the edge of the plane: reads as an infinite floor in fog.
const floorVertex = /* glsl */ `
    varying vec3 vWorld;
    void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
    }
`;

const floorFragment = /* glsl */ `
    uniform vec2 uTile;
    uniform vec2 uCenter;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uLightColor;
    uniform vec3 uFogColor;
    uniform float uLightRadius;
    uniform float uFadeNear;
    uniform float uFadeFar;
    varying vec3 vWorld;

    float checker(vec2 p) {
        vec2 w = fwidth(p) + 0.0001;
        vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
        return 0.5 - 0.5 * i.x * i.y;
    }

    void main() {
        vec2 p = vWorld.xz - uCenter;
        float d = length(p);
        vec3 color = mix(uColorA, uColorB, checker(p / uTile));
        float pool = exp(-(d * d) / (uLightRadius * uLightRadius));
        color = color * (1.0 + 2.5 * uLightColor * pool) + uLightColor * pool * 0.35;
        color = mix(color, uFogColor, smoothstep(uFadeNear, uFadeFar, d));
        gl_FragColor = vec4(color, 1.0);
    }
`;

function createFloor() {
    const material = new ShaderMaterial({
        vertexShader: floorVertex,
        fragmentShader: floorFragment,
        uniforms: {
            uTile: { value: new Vector2(1, 1) },
            uCenter: { value: new Vector2() },
            uColorA: { value: new Color(FLOOR.colorA) },
            uColorB: { value: new Color(FLOOR.colorB) },
            uLightColor: { value: new Color(FLOOR.lightColor) },
            uFogColor: { value: new Color(BACKGROUND) },
            uLightRadius: { value: FLOOR.lightRadius },
            uFadeNear: { value: FLOOR.fadeNear },
            uFadeFar: { value: FLOOR.fadeFar },
        },
    });
    const floor = new Mesh(new PlaneGeometry(FLOOR.fadeFar * 2.5, FLOOR.fadeFar * 2.5), material);
    floor.rotation.x = -Math.PI / 2;
    return floor;
}

// ---------------------------------------------------------------------------
// LED strips: one canvas per strip, one row per LED, a dark gap between rows
// so the LEDs read as dots.
// ---------------------------------------------------------------------------

const CELL = 8;

function createStripCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = CELL;
    canvas.height = CELL * STRIP_LENGTH;
    const texture = new CanvasTexture(canvas);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    return { canvas, context: canvas.getContext('2d'), texture };
}

function drawStrip(strip, colors, flip) {
    const { canvas, context, texture } = strip;
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < STRIP_LENGTH; i++) {
        const color = colors[i];
        const row = flip ? STRIP_LENGTH - 1 - i : i;
        context.fillStyle = color || '#0b0b0b';
        context.fillRect(0, row * CELL + 1, CELL, CELL - 2);
    }

    texture.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const _offset = new Vector3();
const _up = new Vector3(0, 1, 0);
const _axis = new Vector3();
const _spherical = new Spherical();

function createPose() {
    return { target: new Vector3(), radius: 1, theta: 0, phi: Math.PI / 2, shiftX: 0, shiftY: 0 };
}

function copyPose(to, from) {
    to.target.copy(from.target);
    to.radius = from.radius;
    to.theta = from.theta;
    to.phi = from.phi;
    to.shiftX = from.shiftX;
    to.shiftY = from.shiftY;
}

// Shortest signed angle from a to b.
function angleTo(a, b) {
    return MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI;
}

function blend(palette, t) {
    const { neutral, matrix } = ATMOSPHERES;
    return new Color(neutral[palette]).lerp(new Color(matrix[palette]), t);
}

export class MachineScene {
    constructor(canvas) {
        this.canvas = canvas;
        this.renderer = new WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(BACKGROUND);
        this.renderer.outputColorSpace = LinearSRGBColorSpace;

        this.scene = new Scene();
        this.camera = new PerspectiveCamera(FOV, 1, 0.1, 200);

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.enablePan = false;
        this.controls.enableZoom = true;
        // Stay above the floor.
        this.controls.maxPolarAngle = MathUtils.degToRad(84);
        // Only in the LED check, once the camera got there (see _tick).
        this.controls.enabled = false;

        // Glows: materials flagged userData.bloom (strips and buttons).
        this.bloom = new SelectiveBloom({ renderer: this.renderer, scene: this.scene, camera: this.camera });

        this.buttons = {}; // "key:id" -> { mesh, material, base, pressed, isBuzzer, id }
        this.joysticks = {}; // id -> { mesh, base }
        this.strips = {
            left: createStripCanvas(),
            right: createStripCanvas(),
        };

        this.screen = new MatrixScreen();

        this.focus = { yaw: 0, target: 0, stick: 0, pitch: 0, pitchTarget: 0, stickPitch: 0, sides: new Set(), returnTimer: null, lastTime: 0 };

        // Stage camera: `pose` eases towards `goal`. In the LED check, once
        // arrived, OrbitControls own the camera (`free`) until the next stage.
        this.stage = { name: 'hub', joystick: null };
        this.pose = createPose();
        this.goal = createPose();
        this.free = false;
        this.tint = new Color(ATMOSPHERES.neutral.tint);
        this.atmosphere = { value: 0, target: 0 };
        this.screenPower = { value: 0, target: 0 };
        this.screenLight = { value: 0, target: 0 };
        this.dive = null;
        this.width = 1;
        this.height = 1;

        this._resize = this._resize.bind(this);
        this._tick = this._tick.bind(this);
    }

    async load() {
        const textureLoader = new TextureLoader();
        const [gltf, mirror1, mirror2, clearSoft, ventilation] = await Promise.all([
            new GLTFLoader().loadAsync(MODEL_URL),
            loadTexture(textureLoader, MATCAPS.mirror1),
            loadTexture(textureLoader, MATCAPS.mirror2),
            loadTexture(textureLoader, MATCAPS.clearSoft),
            loadTexture(textureLoader, VENTILATION_URL),
        ]);

        // Left the page while loading: nothing was uploaded to the GPU yet.
        if (this.disposed) {
            [mirror1, mirror2, clearSoft, ventilation].forEach((texture) => texture.dispose());
            return;
        }

        // Same assignment as the front's MachineComponent.
        const materials = {
            borne: matcapMaterial(mirror2, this.tint, { color: '#414141' }),
            plexiglass: matcapMaterial(mirror1, this.tint, { color: '#7e7e7e' }),
            grille: matcapMaterial(mirror1, this.tint, { map: ventilation }),
            bases: matcapMaterial(clearSoft, this.tint, { color: '#151515' }),
            écran: matcapMaterial(mirror1, this.tint, { color: '#151515' }),
            joystickBall: matcapMaterial(mirror2, this.tint, { color: '#313131' }),
            joystickStick: matcapMaterial(mirror1, this.tint, { color: '#ffffff' }),
        };

        const model = gltf.scene;
        const buttonNames = Object.fromEntries(Object.entries(BUTTON_MESHES).map(([k, v]) => [v, k]));

        model.traverse((child) => {
            if (child.name === 'joystick_gauche') this.joysticks[1] = { mesh: child, base: child.rotation.clone() };
            if (child.name === 'joystick_droite') this.joysticks[2] = { mesh: child, base: child.rotation.clone() };

            if (!child.isMesh) return;
            const name = child.name;

            if (buttonNames[name]) {
                const id = buttonNames[name];
                const material = new MeshBasicMaterial({ color: BUTTON_OFF, side: DoubleSide });
                material.userData.bloom = true;
                child.material = material;
                this.buttons[id] = {
                    mesh: child,
                    material,
                    base: child.position.clone(),
                    pressed: false,
                    isBuzzer: name.startsWith('buzzer'),
                    side: name.endsWith('gauche') ? 1 : 2,
                };
                return;
            }

            if (name === 'LED_gauche' || name === 'LED_droite') {
                const strip = this.strips[name === 'LED_gauche' ? 'left' : 'right'];
                child.material = new MeshBasicMaterial({ map: strip.texture, side: DoubleSide });
                child.material.userData.bloom = true;
                return;
            }

            if (name === 'écran') {
                // Quad with u left to right, v bottom to top, as the canvas.
                // Its face points away from the viewer: double-sided.
                child.material = new MeshBasicMaterial({ map: this.screen.texture, side: DoubleSide });
                child.material.userData.bloom = true;
                this.screenMaterial = child.material; // colour = power (black = off)
                this.screenMesh = child;
                return;
            }

            if (name.endsWith('_boule')) child.material = materials.joystickBall;
            else if (name.endsWith('_tige')) child.material = materials.joystickStick;
            else if (materials[name]) child.material = materials[name];
        });

        // Machine centred on the origin.
        const center = new Box3().setFromObject(model).getCenter(new Vector3());
        model.position.sub(center);
        this.scene.add(model);
        this.model = model;

        // Floor under the machine: tile lines cross at the centre of the
        // base, which covers a 2 x 2 block of tiles.
        const box = new Box3().setFromObject(model);
        const footprint = this._footprint(box.min.y);
        const tiles = this.floor = createFloor();
        tiles.position.y = box.min.y;
        footprint.getSize(tiles.material.uniforms.uTile.value).divideScalar(FLOOR.footprintTiles);
        footprint.getCenter(tiles.material.uniforms.uCenter.value);
        this.scene.add(tiles);

        this.setStrip('left', []);
        this.setStrip('right', []);
        this._frame();
        this._measureScreen();

        // First stage: no move, start there.
        this.setStage(this.stage.name, this.stage);
        copyPose(this.pose, this.goal);
        this.atmosphere.value = this.atmosphere.target;
        this._applyAtmosphere();
        this.screenPower.value = this.screenPower.target;
        this._applyScreenPower();
    }

    // Frees everything (the LED check is a route now: leaving it must not
    // leak a WebGL context). Safe to call before load() has finished.
    dispose() {
        this.disposed = true;
        window.removeEventListener('resize', this._resize);
        this.renderer.setAnimationLoop(null);
        clearTimeout(this.focus.returnTimer);
        this.controls.dispose();
        this.bloom.dispose();

        const textures = new Set([this.screen.texture, this.strips.left.texture, this.strips.right.texture]);
        this.scene.traverse((child) => {
            if (!child.isMesh) return;
            child.geometry.dispose();
            const material = child.material;
            Object.values(material.uniforms || {}).forEach((uniform) => {
                if (uniform.value && uniform.value.isTexture) textures.add(uniform.value);
            });
            if (material.map) textures.add(material.map);
            material.dispose();
        });
        textures.forEach((texture) => texture.dispose());

        this.renderer.dispose();
        this.renderer.forceContextLoss();
    }

    start() {
        if (this.disposed || this.started) return;
        this.started = true;
        window.addEventListener('resize', this._resize);
        this._resize();
        this.renderer.setAnimationLoop(this._tick);
    }

    // Stops rendering while the scene is hidden (input debugger).
    setPaused(paused) {
        if (!this.started || this.disposed) return;
        this.renderer.setAnimationLoop(paused ? null : this._tick);
        this.focus.lastTime = 0;
    }

    // Camera pose and atmosphere for a page; see the top of the file. Can be
    // called before load() (kept, applied once loaded).
    setStage(name, { joystick = null } = {}) {
        const leavingLed = this.stage.name === 'led' && name !== 'led';
        this.stage = { name, joystick };
        this.atmosphere.target = name === 'hub' ? 0 : 1;
        this.screenPower.target = name === 'hub' ? 0 : 1;
        if (name !== 'screen') {
            this.screenLight.target = 0;
            if (this.dive) {
                this.dive.resolve(false);
                this.dive = null;
            }
        }
        if (!this.model) return;

        if (leavingLed || name === 'led') this._takeCamera();
        if (name === 'led') this._resetFocus();

        const { goal, center, restDistance, radius } = this;
        goal.shiftX = 0;
        goal.shiftY = 0;
        let direction = VIEW_DIRECTION;
        let distance = restDistance;
        goal.target.copy(center);

        if (name === 'hub') {
            distance = restDistance * HUB.distance;
            goal.shiftX = HUB.shiftX;
        } else if (name === 'screen' && this.screenInfo) {
            goal.target.copy(this.screenInfo.center);
            direction = this.screenInfo.normal;
            distance = this.screenInfo.height / (this._viewHeightPerUnit() * DIVE.frame);
        } else if (name === 'calibration') {
            const shot = CALIBRATION[joystick] || CALIBRATION.both;
            const sticks = Object.values(this.joysticks).map((j) => j.mesh.getWorldPosition(new Vector3()));
            if (CALIBRATION[joystick] && this.joysticks[joystick]) {
                this.joysticks[joystick].mesh.getWorldPosition(goal.target);
            } else if (sticks.length) {
                goal.target.set(0, 0, 0);
                sticks.forEach((p) => goal.target.add(p));
                goal.target.divideScalar(sticks.length);
                // Each stick sits left of its buttons: the panel's middle
                // is the machine's.
                goal.target.z = center.z;
            }
            goal.target.y += STICK_HEIGHT + (shot.lookY || 0);
            goal.target.z -= shot.lookX || 0; // the machine's right side is z-
            direction = shot.direction;
            distance = radius * shot.distance;
            goal.shiftX = shot.shiftX;
            goal.shiftY = shot.shiftY;
        }

        _spherical.setFromVector3(_offset.copy(direction).normalize());
        goal.radius = distance;
        goal.phi = _spherical.phi;
        goal.theta = _spherical.theta;
    }

    // The input debugger's entrance: faces the screen (dark), fades it to
    // white, dives in. onWhite() fires when the screen is about to fill
    // the view (cover the page then); resolves true at the end, false if
    // another stage interrupted it.
    diveIntoScreen({ onWhite = () => {} } = {}) {
        if (this.dive) this.dive.resolve(false);
        this.setStage('screen');
        return new Promise((resolve) => {
            this.dive = { start: null, fromRadius: null, white: false, resolve, onWhite };
        });
    }

    _viewHeightPerUnit() {
        return 2 * Math.tan(MathUtils.degToRad(FOV / 2));
    }

    // Screen quad: centre, outward normal (towards the front, +x) and size.
    _measureScreen() {
        const mesh = this.screenMesh;
        if (!mesh) return;
        this.model.updateMatrixWorld(true);
        const geometry = mesh.geometry;
        geometry.computeBoundingBox();
        const box = geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
        const size = box.getSize(new Vector3());
        const normal = new Vector3(1, 0, 0);
        const normals = geometry.attributes.normal;
        if (normals) {
            normal.fromBufferAttribute(normals, 0).transformDirection(mesh.matrixWorld);
            if (normal.x < 0) normal.negate(); // the quad faces away
        }
        this.screenInfo = {
            center: box.getCenter(new Vector3()),
            normal,
            width: size.z,
            height: Math.hypot(size.x, size.y),
        };
    }

    // Runs the dive's timeline (see DIVE); called every frame while diving.
    _updateDive(time) {
        const dive = this.dive;
        if (dive.start === null) dive.start = time;
        const t = time - dive.start;
        const { screen } = this;

        screen.blank = true;
        screen.light = MathUtils.smoothstep(t, DIVE.lightAt, DIVE.lightAt + DIVE.lightMs);
        this.screenLight.value = screen.light;

        if (t >= DIVE.diveAt) {
            const info = this.screenInfo;
            if (dive.fromRadius === null) dive.fromRadius = this.pose.radius;
            // Close enough that the screen covers the whole view.
            const perUnit = this._viewHeightPerUnit();
            const end = info
                ? Math.max(0.15, Math.min(info.height * 0.8 / perUnit, info.width * 0.8 / (perUnit * this.camera.aspect)))
                : this.pose.radius * 0.1;
            const k = Math.min(1, (t - DIVE.diveAt) / DIVE.diveMs);
            dive.radius = MathUtils.lerp(dive.fromRadius, end, k * k * k); // ease in: accelerates
        }

        if (!dive.white && t >= DIVE.diveAt + DIVE.diveMs - DIVE.whiteBefore) {
            dive.white = true;
            dive.onWhite();
        }
        if (t >= DIVE.diveAt + DIVE.diveMs) {
            this.dive = null;
            this.screenLight.value = 1;
            dive.resolve(true);
        }
    }

    // Back to the stage rig from wherever the camera is (the mouse orbit and
    // the W / joystick focus may have moved it).
    _takeCamera() {
        if (!this.free) return;
        this.free = false;
        this.controls.enabled = false;
        this.pose.target.copy(this.controls.target);
        _spherical.setFromVector3(_offset.copy(this.camera.position).sub(this.controls.target));
        this.pose.radius = _spherical.radius;
        this.pose.phi = _spherical.phi;
        this.pose.theta = _spherical.theta;
        this.pose.shiftX = 0;
        this.pose.shiftY = 0;
    }

    // The LED check starts from the rest view; held sticks and sweeps from
    // a previous visit are forgotten.
    _resetFocus() {
        const { focus } = this;
        clearTimeout(focus.returnTimer);
        focus.returnTimer = null;
        focus.sides.clear();
        focus.yaw = focus.target = focus.stick = 0;
        focus.pitch = focus.pitchTarget = focus.stickPitch = 0;
    }

    setButton(key, id, pressed) {
        const button = this.buttons[`${key}:${id}`];
        if (!button || button.pressed === pressed) return;
        button.pressed = pressed;

        button.mesh.position.copy(button.base);
        if (pressed) {
            // Buzzers sit on the sides and move sideways, the rest move down.
            if (button.isBuzzer) button.mesh.position.z += BUZZER_DEPTH * (button.side === 1 ? -1 : 1);
            else button.mesh.position.y -= PRESS_DEPTH;
        }

        button.material.color.set(pressed ? BUTTON_ON : BUTTON_OFF);
    }

    setHome(pressed) {
        this.setButton('home', 0, pressed);
    }

    setStrip(side, colors) {
        drawStrip(this.strips[side], colors, STRIP_FLIP[side]);
    }

    setJoystick(id, x, y) {
        const joystick = this.joysticks[id];
        if (!joystick) return;
        // Same mapping as the front's JoystickManager.
        joystick.mesh.rotation.x = joystick.base.x - JOYSTICK_TILT * x;
        joystick.mesh.rotation.y = joystick.base.y + JOYSTICK_TILT * y;
    }

    // Called with the side whose sweep starts (on) or stops (off). With both
    // sides held the camera faces the front; a moment after the last release
    // it hands back to the joystick orbit (front when the stick is centred).
    // A held sweep wins over the joystick.
    setFocus(side, on) {
        const { focus } = this;
        if (on) focus.sides.add(side);
        else focus.sides.delete(side);

        clearTimeout(focus.returnTimer);
        focus.returnTimer = null;
        if (!focus.sides.size) {
            focus.returnTimer = setTimeout(() => {
                focus.returnTimer = null;
                this._updateFocusTarget();
            }, FOCUS_RETURN_DELAY_MS);
        }
        this._updateFocusTarget();
    }

    // Joystick orbit, x and y in -1..1: full left shows the right side, full
    // right the left side; up raises the camera a little, down lowers it a
    // little. Centred is the rest view. Follows the stick (eased).
    setOrbit(x, y = 0) {
        this.focus.stick = MathUtils.clamp(x, -1, 1) * FOCUS_YAW.left;
        const v = MathUtils.clamp(y, -1, 1);
        this.focus.stickPitch = v * (v > 0 ? PITCH_UP : PITCH_DOWN);
        this._updateFocusTarget();
    }

    // A held sweep (and its return delay) owns the camera: level, facing
    // the strip. Otherwise the stick does.
    _updateFocusTarget() {
        const { focus } = this;
        const sides = Array.from(focus.sides);
        if (sides.length) {
            focus.target = sides.length === 1 ? FOCUS_YAW[sides[0]] : 0;
            focus.pitchTarget = 0;
        } else if (!focus.returnTimer) {
            focus.target = focus.stick;
            focus.pitchTarget = focus.stickPitch;
        }
    }

    // Base outline at floor level, in x/z: the 'borne' vertices within 1 cm
    // of the bottom (falls back to the whole model).
    _footprint(floorY) {
        const area = new Box2();
        const borne = this.model.getObjectByName('borne');
        if (borne) {
            this.model.updateMatrixWorld(true);
            const position = borne.geometry.attributes.position;
            const v = new Vector3();
            for (let i = 0; i < position.count; i++) {
                v.fromBufferAttribute(position, i).applyMatrix4(borne.matrixWorld);
                if (v.y < floorY + 0.01) area.expandByPoint(new Vector2(v.x, v.z));
            }
        }
        if (area.isEmpty()) {
            const box = new Box3().setFromObject(this.model);
            area.set(new Vector2(box.min.x, box.min.z), new Vector2(box.max.x, box.max.z));
        }
        return area;
    }

    // Camera on the rest direction, far enough to fit the machine.
    _frame() {
        const box = new Box3().setFromObject(this.model);
        const center = box.getCenter(new Vector3());
        const radius = box.getSize(new Vector3()).length() / 2;
        const distance = radius / Math.sin(((FOV / 2) * Math.PI) / 180) * 1.12;

        this.center = center;
        this.radius = radius;
        this.restDistance = distance;
        this.controls.target.copy(center);
        this.camera.position.copy(center).addScaledVector(VIEW_DIRECTION, distance);
        this.controls.minDistance = distance * 0.4;
        this.controls.maxDistance = distance * 1.6;
    }

    _resize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.bloom.setSize(width, height);
        this.width = width;
        this.height = height;
    }

    // Eases the stage camera; hands it to OrbitControls once the LED check
    // view is reached.
    _moveCamera(delta) {
        const { pose, goal, camera } = this;
        const ease = 1 - Math.exp(-STAGE_EASE * delta);
        pose.target.lerp(goal.target, ease);
        pose.radius += (goal.radius - pose.radius) * ease;
        if (this.dive && this.dive.radius !== undefined) pose.radius = this.dive.radius;
        pose.phi += (goal.phi - pose.phi) * ease;
        pose.theta += angleTo(pose.theta, goal.theta) * ease;
        pose.shiftX += (goal.shiftX - pose.shiftX) * ease;
        pose.shiftY += (goal.shiftY - pose.shiftY) * ease;

        _spherical.set(pose.radius, pose.phi, pose.theta);
        camera.position.setFromSpherical(_spherical).add(pose.target);
        camera.lookAt(pose.target);

        const arrived = this.stage.name === 'led'
            && pose.target.distanceTo(goal.target) < this.radius * 0.002
            && Math.abs(goal.radius - pose.radius) < this.radius * 0.002
            && Math.abs(goal.phi - pose.phi) < 0.002
            && Math.abs(angleTo(pose.theta, goal.theta)) < 0.002
            && Math.abs(pose.shiftX) < 0.001 && Math.abs(pose.shiftY) < 0.001;
        if (arrived) {
            this.free = true;
            this.controls.target.copy(pose.target);
            this.controls.enabled = true;
            this.controls.update();
        }
    }

    // Moves the rendered image so the pose target sits off centre.
    _applyShift() {
        const { pose, camera, width, height } = this;
        const x = this.free ? 0 : pose.shiftX;
        const y = this.free ? 0 : pose.shiftY;
        if (Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4) {
            if (camera.view && camera.view.enabled) camera.clearViewOffset();
            return;
        }
        camera.setViewOffset(width, height, -x * width, -y * height, width, height);
    }

    _applyScreenPower() {
        if (this.screenMaterial) this.screenMaterial.color.setScalar(this.screenPower.value);
    }

    _applyAtmosphere() {
        const t = this.atmosphere.value;
        const background = blend('background', t);
        this.renderer.setClearColor(background);
        this.tint.copy(blend('tint', t));
        if (this.floor) {
            const u = this.floor.material.uniforms;
            u.uFogColor.value.copy(background);
            u.uColorA.value.copy(blend('floorA', t));
            u.uColorB.value.copy(blend('floorB', t));
            u.uLightColor.value.copy(blend('light', t));
        }
    }

    _tick(time) {
        const { focus } = this;
        const delta = Math.min(0.1, (time - (focus.lastTime || time)) / 1000);
        focus.lastTime = time;

        const atmosphere = this.atmosphere;
        if (atmosphere.value !== atmosphere.target) {
            atmosphere.value += (atmosphere.target - atmosphere.value) * (1 - Math.exp(-ATMOSPHERE_EASE * delta));
            if (Math.abs(atmosphere.target - atmosphere.value) < 0.002) atmosphere.value = atmosphere.target;
            this._applyAtmosphere();
        }

        const power = this.screenPower;
        if (power.value !== power.target) {
            power.value += (power.target - power.value) * (1 - Math.exp(-SCREEN_EASE * delta));
            if (Math.abs(power.target - power.value) < 0.002) power.value = power.target;
            this._applyScreenPower();
        }

        if (this.dive) this._updateDive(time);
        else {
            const light = this.screenLight;
            if (light.value !== light.target) {
                light.value += (light.target - light.value) * (1 - Math.exp(-SCREEN_EASE * delta));
                if (Math.abs(light.target - light.value) < 0.002) light.value = light.target;
            }
            this.screen.light = light.value;
            // Dark under the white until it has faded (back on the hub).
            this.screen.blank = this.stage.name === 'screen' || light.value > 0;
        }

        if (!this.free) this._moveCamera(delta);
        if (this.free) this._focusCamera(delta);
        this._applyShift();

        if (power.value > 0) this.screen.update(time);
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
        this.bloom.render();
    }

    // LED check: W focus and joystick orbit, by steps so a mouse orbit is kept.
    _focusCamera(delta) {
        const { focus } = this;
        const ease = 1 - Math.exp(-FOCUS_EASE * delta);
        const previousYaw = focus.yaw;
        const previousPitch = focus.pitch;
        focus.yaw += (focus.target - focus.yaw) * ease;
        focus.pitch += (focus.pitchTarget - focus.pitch) * ease;
        // Orbit the camera by the steps only, so a mouse orbit is kept.
        // Turning the camera by -yaw shows what turning the machine by +yaw did.
        const yawStep = focus.yaw - previousYaw;
        const pitchStep = focus.pitch - previousPitch;
        if (yawStep || pitchStep) {
            _offset.copy(this.camera.position).sub(this.controls.target);
            if (yawStep) _offset.applyAxisAngle(_up, -yawStep);
            // Around the horizontal axis across the view: + raises the camera.
            if (pitchStep) _offset.applyAxisAngle(_axis.crossVectors(_offset, _up).normalize(), pitchStep);
            this.camera.position.copy(this.controls.target).add(_offset);
        }
        this.controls.update();
    }
}
