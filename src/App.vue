<script setup>
import { ref, watch, onMounted, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { mountStage, setStage, stageName, loaded, whiteout } from './scene/stage.js';

const route = useRoute();
const canvas = ref(null);

// Before the view renders, so a view can refine its stage in setup
// (calibration picks the joystick).
watch(() => route.meta.stage, (name) => setStage(name || 'hub'), { immediate: true });

onMounted(() => mountStage(canvas.value));

// After the dive into the screen the page is covered: uncover it once the
// new view is on screen (its UI fades in).
watch(() => route.path, async () => {
    if (!whiteout.value) return;
    await nextTick();
    requestAnimationFrame(() => requestAnimationFrame(() => { whiteout.value = false; }));
}, { flush: 'post' });
</script>

<template>
    <!-- 3D machine behind every page (src/scene/stage.js) -->
    <canvas ref="canvas" class="stage" :class="[`stage--${stageName}`, { 'is-loaded': loaded }]"></canvas>
    <!-- Keyed by path: every tool mounts fresh, like the old full page loads -->
    <RouterView :key="$route.path" />
    <div class="whiteout" :class="{ 'is-on': whiteout }"></div>
</template>

<style>
/* Fixed under the layout (later in the DOM, position: relative). Dimmed per
   stage; only the LED check takes the mouse (orbit). */
.stage {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    opacity: 0;
    filter: brightness(var(--stage-brightness, 1));
    pointer-events: none;
    transition: opacity 1.2s ease, filter 1.2s ease;
}

.stage.is-loaded { opacity: 1; }
.stage--hub { --stage-brightness: 0.45; }
.stage--calibration { --stage-brightness: 0.6; }
.stage--screen { transition-duration: 1.2s, 0.6s; } /* back to full brightness quickly */
.stage--led { pointer-events: auto; }
.stage--hidden { visibility: hidden; transition: none; }

/* Input debugger background (#f4f4f4): the dive ends on it seamlessly. */
.whiteout {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: #f4f4f4;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.8s ease-out;
}

.whiteout.is-on { opacity: 1; transition: opacity 0.35s ease-in; }
</style>
