// 工程画布公共工具：连线与卡片网格排布，供组件与后台任务（Pinia）共用
// 用 marker 字符串（等价于 @vue-flow/core 的 MarkerType.ArrowClosed），避免 store 层耦合画布库
export const markerEnd = {
  type: 'arrowclosed',
  width: 18,
  height: 18,
  color: 'rgba(154, 165, 179, 0.9)',
}

export function makeEdge(id, source, target, extra = {}) {
  return {
    id,
    type: 'flowing',
    source,
    target,
    markerEnd,
    style: { strokeWidth: 1.7 },
    ...extra,
  }
}

// 批量生成卡片的网格排布：每行 5 个、超出自动换行
export const GRID_COLS = 5

export function gridPosition(baseX, baseY, index, stepX, stepY) {
  return {
    x: baseX + (index % GRID_COLS) * stepX,
    y: baseY + Math.floor(index / GRID_COLS) * stepY,
  }
}

// 让整块网格落在锚点卡片左侧，网格右边缘与锚点保持固定间距
export function gridBaseX(anchorX, count, cardWidth, stepX, gap = 96) {
  const cols = Math.min(GRID_COLS, Math.max(1, count))
  const gridWidth = (cols - 1) * stepX + cardWidth
  return anchorX - gridWidth - gap
}
