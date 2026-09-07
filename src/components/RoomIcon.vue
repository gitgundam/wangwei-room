<script setup lang="ts">
defineProps<{ name: 'home' | 'desk' | 'reset' | 'light' | 'screen' | 'drag' | 'arrow' | 'retry' }>()
const paths = {
  home: ['m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z', 'M9 21v-8h6v8'],
  desk: ['M3 10h18v3H3z', 'M5 13v8m14-8v8', 'M8 3h8v7H8z'],
  reset: ['M3 10a9 9 0 1 1 1.5 7', 'M3 4v6h6'],
  light: ['M9 18v-2a6 6 0 1 1 6 0v2', 'M9 18h6m-5 3h4', 'M12 1v1m-9 4 1 1m17-1-1 1'],
  screen: ['M3 4h18v13H3z', 'M8 21h8m-4-4v4'],
  drag: ['M12 3v18M3 12h18', 'm8 7 4-4 4 4m-8 10 4 4 4-4M7 8l-4 4 4 4m10-8 4 4-4 4'],
  arrow: ['m9 5 7 7-7 7'],
  retry: ['M3 10a9 9 0 1 1 1.5 7', 'M3 4v6h6'],
}
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-for="(path, index) in paths[name]" :key="index" :d="path" />
  </svg>
</template>
