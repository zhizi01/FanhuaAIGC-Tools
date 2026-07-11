import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLE_IMAGE_STYLE_PRESETS,
  ROLE_IMAGE_VARIANTS,
  buildRoleAppearancePrompt,
  getRoleImageStylePreset,
  parseRoleImagePromptSet,
} from './roleImagePrompt.js'

test('builds appearance text from structured role fields', () => {
  const prompt = buildRoleAppearancePrompt({
    name: '林夏',
    age: '24岁',
    gender: '女',
    identity: '服装设计师',
    appearance: '黑色长发，穿浅蓝色卫衣和白色长裤',
    personality: '清新自然，神态温柔',
  })

  assert.match(prompt, /林夏/)
  assert.match(prompt, /24岁，女/)
  assert.match(prompt, /浅蓝色卫衣/)
  assert.match(prompt, /神态温柔/)
})

test('resolves a selected image style for AI prompt generation', () => {
  const preset = getRoleImageStylePreset('cg')
  assert.equal(preset.label, 'CG风格')
  assert.match(preset.guidance, /三维CG/)
})

test('falls back to realistic style for unknown values', () => {
  assert.equal(getRoleImageStylePreset('unknown'), ROLE_IMAGE_STYLE_PRESETS[0])
})

test('defines the three required role image variants in generation order', () => {
  assert.deepEqual(
    ROLE_IMAGE_VARIANTS.map((variant) => variant.key),
    ['sheet', 'portrait', 'expressions'],
  )
  assert.equal(ROLE_IMAGE_VARIANTS[1].usePrimaryReference, true)
  assert.equal(ROLE_IMAGE_VARIANTS[2].usePrimaryReference, true)
})

test('parses the AI-generated three-prompt JSON payload', () => {
  const prompts = parseRoleImagePromptSet(`\`\`\`json
{
  "sheet": "主参考图提示词",
  "portrait": "标准肖像图提示词",
  "expressions": "表情九宫格提示词"
}
\`\`\``)

  assert.equal(prompts.sheet, '主参考图提示词')
  assert.equal(prompts.portrait, '标准肖像图提示词')
  assert.equal(prompts.expressions, '表情九宫格提示词')
})

test('rejects incomplete AI prompt sets', () => {
  assert.throws(
    () => parseRoleImagePromptSet('{"sheet":"主图","portrait":"肖像"}'),
    /表情参考图/,
  )
})
