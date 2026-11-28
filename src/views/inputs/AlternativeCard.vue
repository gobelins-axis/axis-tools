<script setup>
// One alternative controller of the input debugger: text fields as badges,
// numeric fields as step charts (drawn by InputsView's frame loop, draw.js).

defineProps({
    alt: { type: Object, required: true },
});
</script>

<template>
    <article class="alternative" :class="{ disconnected: alt.disconnected }">
        <h3 class="alternative-title">
            <span>{{ alt.name }}</span>
            <span class="alternative-meta">{{ alt.meta }}</span>
            <span class="rate">{{ alt.rateText }}</span>
        </h3>
        <div v-if="alt.badges.length" class="badges">
            <span v-for="badge in alt.badges" :key="badge.label" class="badge" :class="{ flash: badge.flash }"><b>{{ badge.label }}</b><span>{{ badge.value }}</span></span>
        </div>
        <div v-if="alt.numbers.length" class="fields">
            <div v-for="field in alt.numbers" :key="field.label" class="field">
                <div class="field-head">
                    <span class="field-name">{{ field.label }}</span>
                    <span class="field-value">{{ field.value }}</span>
                </div>
                <canvas :ref="(el) => { field.canvas = el; }" class="field-chart"></canvas>
                <div class="field-range">{{ field.rangeText }}</div>
            </div>
        </div>
    </article>
</template>
