<template>
    <!-- Keyed by path: every tool mounts fresh, like the old full page loads -->
    <RouterView :key="$route.path" />
</template>
