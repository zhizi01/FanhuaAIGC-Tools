import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLE_IMAGE_STYLE_PRESETS,
  buildRoleAppearancePrompt,
  buildRoleReferencePrompt,
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

test('builds a consistent nine-view role reference sheet prompt', () => {
  const prompt = buildRoleReferencePrompt({
    appearancePrompt: '二十多岁的东亚女性，黑色长发，浅蓝色卫衣',
    stylePrompt: ROLE_IMAGE_STYLE_PRESETS[0].prompt,
  })

  assert.match(prompt, /16:9/)
  assert.match(prompt, /同一个人/)
  assert.match(prompt, /三张全身人物视图/)
  assert.match(prompt, /六张半身近景人物视图/)
  assert.match(prompt, /无文字、无边框、无水印/)
})

test('requires appearance and style prompts', () => {
  assert.throws(
    () => buildRoleReferencePrompt({ appearancePrompt: '', stylePrompt: '写实' }),
    /人物形象提示词不能为空/,
  )
  assert.throws(
    () => buildRoleReferencePrompt({ appearancePrompt: '角色设定', stylePrompt: '' }),
    /生成风格提示词不能为空/,
  )
})
