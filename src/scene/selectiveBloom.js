// Selective bloom, ported from axis-launcher-front (webgl/modules/BloomManager,
// BloomPlaneBuffer, BlurManager, BlurPlaneBuffer and layers/Layer3D), same
// settings and same steps:
//
//   1. mask:  render the scene with every non-bloom mesh in black
//   2. bloom: render the scene with only the bloom meshes visible
//   3. keep the bloom where the mask is bright (threshold)
//   4. blur it: 6 ping-pong passes of a 9-tap gaussian, shrinking radius
//   5. add it on top of the normal render (strength)
//
// Bloom meshes are the ones whose material has userData.bloom = true.
// Everything runs at 20% of the window size, like the front.

import {
    AdditiveBlending,
    LinearFilter,
    Mesh,
    MeshBasicMaterial,
    OrthographicCamera,
    PlaneGeometry,
    RGBAFormat,
    Scene,
    ShaderMaterial,
    Vector2,
    WebGLRenderTarget,
} from 'three';

// axis-launcher-front webgl/modules/Postprocessing.js
export const BLOOM_SETTINGS = {
    strength: 0.7,
    radius: 0.53,
    threshold: 0.9,
};

const MASK_QUALITY = 0.2;
const BLUR_QUALITY = 0.2;
const BLUR_ITERATIONS = 6;

const fullscreenVertex = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

// shaders/bloom/fragment.glsl
const maskFragment = /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D uBloomTexture;
    uniform sampler2D uBloomMaskTexture;
    uniform float uBloomThreshold;

    void main() {
        vec4 maskTexture = texture2D(uBloomMaskTexture, vUv);
        float avgColorMask = (maskTexture.r + maskTexture.g + maskTexture.b) / 3.0;
        float mask = 1.0 - step(avgColorMask, 1.0 - uBloomThreshold);
        gl_FragColor = texture2D(uBloomTexture, vUv) * mask;
    }
`;

// shaders/blur/fragment.glsl with glsl-fast-gaussian-blur (blur9) inlined
const blurFragment = /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec2 uResolution;
    uniform vec2 uDirection;
    uniform float uIntensity;

    vec4 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
        vec4 color = vec4(0.0);
        vec2 off1 = vec2(1.3846153846) * direction;
        vec2 off2 = vec2(3.2307692308) * direction;
        color += texture2D(image, uv) * 0.2270270270;
        color += texture2D(image, uv + (off1 / resolution)) * 0.3162162162;
        color += texture2D(image, uv - (off1 / resolution)) * 0.3162162162;
        color += texture2D(image, uv + (off2 / resolution)) * 0.0702702703;
        color += texture2D(image, uv - (off2 / resolution)) * 0.0702702703;
        return color;
    }

    void main() {
        gl_FragColor = blur9(uTexture, vUv, uResolution, uDirection * uIntensity);
    }
`;

// layers/Layer3D: scene + bloom * strength. Drawn additively over the scene.
const compositeFragment = /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D uBloomTexture;
    uniform float uBloomStrength;

    void main() {
        gl_FragColor = texture2D(uBloomTexture, vUv) * uBloomStrength;
    }
`;

function createRenderTarget() {
    const target = new WebGLRenderTarget(1, 1, { format: RGBAFormat, depthBuffer: true });
    target.texture.minFilter = LinearFilter;
    target.texture.magFilter = LinearFilter;
    target.texture.generateMipmaps = false;
    return target;
}

// A full-screen quad with its own scene, rendered into a target.
class FullscreenPass {
    constructor(material) {
        this.material = material;
        this.scene = new Scene();
        this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene.add(new Mesh(new PlaneGeometry(2, 2), material));
    }

    render(renderer, target) {
        renderer.setRenderTarget(target);
        renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.scene.traverse((child) => { if (child.isMesh) child.geometry.dispose(); });
        this.material.dispose();
    }
}

export class SelectiveBloom {
    constructor({ renderer, scene, camera, settings = BLOOM_SETTINGS }) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.settings = settings;

        this.maskMaterial = new MeshBasicMaterial({ color: 'black' });
        this.targetMask = createRenderTarget();
        this.targetBloom = createRenderTarget();
        this.targetMasked = createRenderTarget();

        this.maskPass = new FullscreenPass(new ShaderMaterial({
            vertexShader: fullscreenVertex,
            fragmentShader: maskFragment,
            uniforms: {
                uBloomTexture: { value: this.targetBloom.texture },
                uBloomMaskTexture: { value: this.targetMask.texture },
                uBloomThreshold: { value: settings.threshold },
            },
            depthTest: false,
        }));

        // Two blur buffers, as in BlurManager.
        this.blurBuffers = [0, 1].map(() => ({
            target: createRenderTarget(),
            pass: new FullscreenPass(new ShaderMaterial({
                vertexShader: fullscreenVertex,
                fragmentShader: blurFragment,
                uniforms: {
                    uTexture: { value: this.targetMasked.texture },
                    uResolution: { value: new Vector2(1, 1) },
                    uDirection: { value: new Vector2(0, 0) },
                    uIntensity: { value: settings.radius },
                },
                depthTest: false,
            })),
        }));

        this.compositePass = new FullscreenPass(new ShaderMaterial({
            vertexShader: fullscreenVertex,
            fragmentShader: compositeFragment,
            uniforms: {
                uBloomTexture: { value: null },
                uBloomStrength: { value: settings.strength },
            },
            blending: AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            transparent: true,
        }));
    }

    dispose() {
        [this.targetMask, this.targetBloom, this.targetMasked, ...this.blurBuffers.map((buffer) => buffer.target)]
            .forEach((target) => target.dispose());
        [this.maskPass, this.compositePass, ...this.blurBuffers.map((buffer) => buffer.pass)]
            .forEach((pass) => pass.dispose());
        this.maskMaterial.dispose();
    }

    setSize(width, height) {
        const mw = Math.max(1, Math.round(width * MASK_QUALITY));
        const mh = Math.max(1, Math.round(height * MASK_QUALITY));
        this.targetMask.setSize(mw, mh);
        this.targetBloom.setSize(mw, mh);
        this.targetMasked.setSize(mw, mh);

        const bw = Math.max(1, Math.round(width * BLUR_QUALITY));
        const bh = Math.max(1, Math.round(height * BLUR_QUALITY));
        this.blurBuffers.forEach(({ target, pass }) => {
            target.setSize(bw, bh);
            pass.material.uniforms.uResolution.value.set(bw, bh);
        });
    }

    // Normal scene first (by the caller), then this adds the glow on screen.
    render() {
        const { renderer, scene, camera } = this;
        const masked = [];
        scene.traverse((child) => {
            if (child.isMesh && child.visible && !(child.material.userData && child.material.userData.bloom)) masked.push(child);
        });
        const originals = masked.map((mesh) => mesh.material);

        // 1. Mask: non-bloom meshes in black, so they hide bloom behind them.
        masked.forEach((mesh) => { mesh.material = this.maskMaterial; });
        renderer.setRenderTarget(this.targetMask);
        renderer.clear();
        renderer.render(scene, camera);

        // 2. Bloom meshes only.
        masked.forEach((mesh) => { mesh.visible = false; });
        renderer.setRenderTarget(this.targetBloom);
        renderer.clear();
        renderer.render(scene, camera);

        masked.forEach((mesh, i) => {
            mesh.material = originals[i];
            mesh.visible = true;
        });

        // 3. Apply the mask.
        this.maskPass.render(renderer, this.targetMasked);

        // 4. Blur, same ping-pong as BlurManager.render().
        let write = this.blurBuffers[0];
        let read = this.blurBuffers[1];
        for (let i = 0; i < BLUR_ITERATIONS; i++) {
            const radius = (BLUR_ITERATIONS - i - 1) * this.settings.radius;
            write.pass.material.uniforms.uDirection.value.set(i % 2 === 0 ? radius : 0, i % 2 === 0 ? 0 : radius);
            write.pass.render(renderer, write.target);

            read.pass.material.uniforms.uTexture.value = write.target.texture;
            read.pass.render(renderer, read.target);

            [write, read] = [read, write];
        }
        const output = read.target.texture;
        read.pass.material.uniforms.uTexture.value = this.targetMasked.texture;
        write.pass.material.uniforms.uTexture.value = this.targetMasked.texture;

        // 5. Add on screen.
        this.compositePass.material.uniforms.uBloomTexture.value = output;
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        this.compositePass.render(renderer, null);
        renderer.autoClear = autoClear;
    }
}
