<script setup lang="ts">
defineProps<{ title?: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <div class="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" @click.self="$emit('close')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <h2 class="font-semibold text-slate-800">{{ title }}</h2>
        <button class="text-slate-400 hover:text-slate-600" @click="$emit('close')">✕</button>
      </div>
      <div class="p-4">
        <slot />
      </div>
    </div>
  </div>
</template>
