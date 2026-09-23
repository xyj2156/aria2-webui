import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetTypography,
  presetWind3, transformerCompileClass,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'
import extractorPug from "@unocss/extractor-pug";

export default defineConfig({
  presets: [
    presetWind3(),
    presetAttributify(),
    presetTypography(),
    presetIcons({ scale: 1.2, warn: true }),
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
    transformerCompileClass(),
  ],
  shortcuts: {
    "wh-full":        "w-full h-full",
    "flex-center":    "flex justify-center items-center",
    "flex-x-center":  "flex justify-center",
    "flex-y-center":  "flex items-center",
    "flex-x-start":   "flex items-center justify-start",
    "flex-x-between": "flex items-center justify-between",
    "flex-x-end":     "flex items-center justify-end",
  },
  extractors:[
      extractorPug(),
  ]
})
