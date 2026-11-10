import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        'adapters/vue': 'src/adapters/vue.ts',
        'adapters/angular': 'src/adapters/angular.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    splitting: false,
});
