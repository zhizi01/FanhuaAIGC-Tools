import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRoleCardData,
  canonicalRoleName,
  findLibraryRole,
  findUniqueLibraryRole,
  isCharacterRoleCandidate,
  roleCardRoleId,
  sanitizeRoleCandidates,
} from './roles.js'
import { parseExtractedRoles } from './markdown.js'

test('filters narration and merges inner speech into the real character', () => {
  const roles = sanitizeRoleCandidates([
    { name: '旁白', roleType: '旁白', note: '场景说明' },
    { name: '画外音', roleType: '配角' },
    { name: '林晚（内心）', roleType: '旁白', personality: '克制', note: '内心独白' },
    { name: '林晚', roleType: '主角', identity: '记者', note: '实际出场' },
    { name: '林晚-独白', motivation: '查明真相' },
    { name: '周衡OS', roleType: '配角' },
  ])

  assert.deepEqual(
    roles.map((role) => role.name),
    ['林晚', '周衡'],
  )
  assert.equal(roles[0].roleType, '主角')
  assert.equal(roles[0].identity, '记者')
  assert.equal(roles[0].personality, '克制')
  assert.equal(roles[0].motivation, '查明真相')
  assert.match(roles[0].note, /实际出场/)
  assert.equal(roles[1].roleType, '配角')
})

test('normalizes common inner-speech labels without creating generic roles', () => {
  assert.equal(canonicalRoleName('沈知夏（内心独白）'), '沈知夏')
  assert.equal(canonicalRoleName('内心：沈知夏'), '沈知夏')
  assert.equal(canonicalRoleName('角色内心'), '')
  assert.equal(canonicalRoleName('V.O.'), '')
  assert.equal(isCharacterRoleCandidate({ name: '解说员小王', roleType: '旁白' }), false)
  assert.equal(isCharacterRoleCandidate({ name: '沈知夏（内心）', roleType: '旁白' }), true)
})

test('markdown role extraction applies the same narration guard', () => {
  const roles = parseExtractedRoles(`## 角色：旁白
- 角色定位：旁白

## 角色：沈知夏（内心）
- 角色定位：配角
- 性格：谨慎

## 角色：沈知夏
- 角色定位：主角
- 身份：调查记者`)

  assert.equal(roles.length, 1)
  assert.equal(roles[0].name, '沈知夏')
  assert.equal(roles[0].roleType, '主角')
  assert.equal(roles[0].identity, '调查记者')
  assert.equal(roles[0].personality, '谨慎')
})

test('legacy card relinking requires one exact library-name match', () => {
  const roles = [
    { id: 'role_1', name: '林晚' },
    { id: 'role_2', name: '周衡' },
  ]
  assert.equal(findUniqueLibraryRole(roles, '林晚（内心）')?.id, 'role_1')
  assert.equal(findUniqueLibraryRole([...roles, { id: 'role_3', name: '林 晚' }], '林晚'), null)
  assert.equal(findUniqueLibraryRole(roles, '林'), null)
  assert.equal(findLibraryRole([...roles, { id: 'role_3', name: '林 晚' }], '林晚'), null)
})

test('role card keeps a stable library reference and full role snapshot', () => {
  const card = buildRoleCardData({
    id: 'role_1',
    name: '林晚',
    roleType: '主角',
    gender: '女',
    age: '26',
    identity: '记者',
    personality: '冷静',
    motivation: '查明真相',
    appearance: '短发，黑色风衣',
    voice: '语速偏慢',
    voiceLine: '低沉、克制',
    images: ['roles/role_1/images/a.png'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  })

  assert.equal(roleCardRoleId(card), 'role_1')
  assert.deepEqual(card.roleRef, { type: 'role-library', id: 'role_1' })
  assert.equal(card.motivation, '查明真相')
  assert.equal(card.voiceLine, '低沉、克制')
  assert.deepEqual(card.images, ['roles/role_1/images/a.png'])
  assert.equal(card.cover, 'roles/role_1/images/a.png')

  const refreshed = buildRoleCardData(
    {
      id: 'role_1',
      name: '林晚',
      personality: '',
      images: [],
    },
    card,
  )
  assert.equal(refreshed.personality, '')
  assert.deepEqual(refreshed.images, [])
  assert.equal(refreshed.cover, '')
})
