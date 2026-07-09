<script lang="ts" setup>
import { ElButton, ElConfigProvider, ElMessage, ElText } from 'element-plus'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useAutoChat } from '../hooks/useAutoChat'
import type { CapturedMessage, CapturePayload } from '../types'

const title = ref('')
const capturedAt = ref('')
const messages = ref<CapturedMessage[]>([])
const statusText = ref('未采集')
let observer: MutationObserver | undefined
let collectTimer: number | undefined

const messageCount = computed(() => messages.value.length)
const {
  enabled: autoReplyEnabled,
  processing: autoReplyProcessing,
  statusText: autoReplyStatusText,
  logs: autoReplyLogs,
  triggerNow: triggerAutoReplyNow,
} = useAutoChat({ title, messages })

const messageSelectors = [
  '.message-item',
  '.chat-message-item',
  '.item-message',
  '.msg-item',
  '.dialog-item',
  '.chat-record-item',
  '[class*="message-item"]',
  '[class*="msg-item"]',
]

const contentSelectors = [
  '.text',
  '.content',
  '.message-content',
  '.msg-content',
  '.bubble',
  '.chat-text',
  '[class*="content"]',
  '[class*="text"]',
]

const senderSelectors = [
  '.name',
  '.username',
  '.user-name',
  '.sender',
  '.boss-name',
  '[class*="name"]',
]

const timeSelectors = ['.time', '.date', '.message-time', '.msg-time', '[class*="time"]']

function classTokens(element: Element): string[] {
  return element.className.toString().toLowerCase().split(/\s+/).filter(Boolean)
}

function classText(element: Element): string {
  return element.className.toString().toLowerCase()
}

function isInHelper(element: Element): boolean {
  return Boolean(element.closest('#boss-helper-chat'))
}

function visibleText(element: Element | null | undefined): string {
  if (!element) {
    return ''
  }
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') {
    return ''
  }
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function pickText(element: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const text = visibleText(element.querySelector(selector))
    if (text) {
      return text
    }
  }
  return ''
}

function pickVisibleElement(element: Element, selectors: string[]): Element | undefined {
  for (const selector of selectors) {
    const matched = element.querySelector(selector)
    if (visibleText(matched)) {
      return matched ?? undefined
    }
  }
  return undefined
}

function detectDirectionByLayout(element: Element): CapturedMessage['direction'] {
  const content = pickVisibleElement(element, contentSelectors)
  const target = content ?? element
  const targetRect = target.getBoundingClientRect()
  const container =
    element.closest('[class*="message-list"]') ??
    element.closest('[class*="chat-content"]') ??
    element.closest('[class*="chat-main"]') ??
    element.closest('[class*="chat"]')
  const containerRect = container?.getBoundingClientRect()
  if (!containerRect || targetRect.width === 0 || containerRect.width === 0) {
    return 'unknown'
  }

  const targetCenter = targetRect.left + targetRect.width / 2
  const containerCenter = containerRect.left + containerRect.width / 2
  const threshold = containerRect.width * 0.08
  if (targetCenter > containerCenter + threshold) {
    return 'self'
  }
  if (targetCenter < containerCenter - threshold) {
    return 'other'
  }
  return 'unknown'
}

function detectDirection(element: Element): CapturedMessage['direction'] {
  const tokens = classTokens(element)
  const text = classText(element)
  if (
    tokens.some((token) => ['item-system', 'system', 'notice', 'tips'].includes(token)) ||
    /(^|[-_\s])(system|notice|tips)([-_\s]|$)/.test(text)
  ) {
    return 'system'
  }
  if (tokens.some((token) => ['item-myself', 'myself', 'self', 'mine', 'right'].includes(token))) {
    return 'self'
  }
  if (tokens.some((token) => ['item-friend', 'friend', 'other', 'left', 'boss'].includes(token))) {
    return 'other'
  }
  if (/(^|[-_\s])(myself|self|mine|right|message-right|from-me|me)([-_\s]|$)/.test(text)) {
    return 'self'
  }
  if (/(^|[-_\s])(friend|other|left|boss|message-left|from-other|recruiter)([-_\s]|$)/.test(text)) {
    return 'other'
  }
  return detectDirectionByLayout(element)
}

function findAvatar(element: Element): string {
  const image = element.querySelector<HTMLImageElement>('img')
  return image?.currentSrc || image?.src || ''
}

function findConversationTitle(): string {
  const selectors = [
    '.chat-info .name',
    '.chat-info [class*="name"]',
    '.chat-info [class*="title"]',
    '.chat-header .name',
    '.chat-header [class*="name"]',
    '.chat-header [class*="title"]',
    '.chat-main .name',
    '.chat-main [class*="name"]',
    '.conversation-header .name',
    '.conversation-header [class*="name"]',
    '.conversation-header [class*="title"]',
    '.chat-title',
    '.dialog-header .name',
    '.dialog-header [class*="title"]',
    '.conversation-title',
    '.user-info .name',
    '.boss-name',
    '.dialog-list .active .name',
    '.dialog-list .selected .name',
    '.chat-list .active .name',
    '.chat-list .selected .name',
    '.conversation-list .active .name',
    '.conversation-list .selected .name',
    '[class*="dialog-list"] [class*="active"] [class*="name"]',
    '[class*="chat-list"] [class*="active"] [class*="name"]',
    '[class*="conversation-list"] [class*="active"] [class*="name"]',
  ]

  for (const selector of selectors) {
    const text = visibleText(document.querySelector(selector))
    if (isValidTitle(text)) {
      return text
    }
  }
  return document.title.replace(/[\s-]*BOSS直聘.*/, '').trim() || '当前会话'
}

function isValidTitle(text: string): boolean {
  if (!text) {
    return false
  }
  const ignored = ['Boss 聊天记录', '刷新采集', '导出 JSON', '导出 CSV', '当前会话']
  return !ignored.some((item) => text.includes(item))
}

function uniqueCandidates(): Element[] {
  const candidates = messageSelectors.flatMap((selector) =>
    Array.from(document.querySelectorAll(selector)),
  )
  const filtered = candidates.filter((item) => !isInHelper(item) && visibleText(item))
  return [...new Set(filtered)].filter((item) => {
    return !filtered.some((other) => other !== item && item.contains(other))
  })
}

function normalizeMessage(element: Element, index: number): CapturedMessage | null {
  const content = pickText(element, contentSelectors) || visibleText(element)
  if (!content) {
    return null
  }

  return {
    index,
    sender: pickText(element, senderSelectors),
    direction: detectDirection(element),
    content,
    time: pickText(element, timeSelectors),
    avatar: findAvatar(element),
    className: element.className.toString(),
  }
}

function collectMessages() {
  const items = uniqueCandidates()
    .map((item, index) => normalizeMessage(item, index + 1))
    .filter((item): item is CapturedMessage => item != null)
    .map((item, index) => ({ ...item, index: index + 1 }))

  title.value = findConversationTitle()
  capturedAt.value = new Date().toISOString()
  messages.value = items
  statusText.value = items.length > 0 ? `已采集 ${items.length} 条` : '当前页面未找到已加载消息'
}

function scheduleCollect() {
  if (collectTimer != null) {
    window.clearTimeout(collectTimer)
  }
  collectTimer = window.setTimeout(() => {
    collectMessages()
  }, 600)
}

function payload(): CapturePayload {
  return {
    title: title.value,
    url: location.href,
    capturedAt: capturedAt.value || new Date().toISOString(),
    messages: messages.value,
  }
}

function formatDateForFile(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function exportJson() {
  if (messages.value.length === 0) {
    ElMessage.warning('没有可导出的消息')
    return
  }
  download(
    JSON.stringify(payload(), null, 2),
    `boss-chat-${formatDateForFile()}.json`,
    'application/json;charset=utf-8',
  )
}

function exportCsv() {
  if (messages.value.length === 0) {
    ElMessage.warning('没有可导出的消息')
    return
  }

  const rows = [
    ['序号', '会话', '方向', '发送方', '时间', '内容', '头像', '页面URL', '采集时间'],
    ...messages.value.map((message) => [
      message.index,
      title.value,
      message.direction,
      message.sender,
      message.time,
      message.content,
      message.avatar,
      location.href,
      capturedAt.value,
    ]),
  ]
  download(
    `\uFEFF${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}`,
    `boss-chat-${formatDateForFile()}.csv`,
    'text/csv;charset=utf-8',
  )
}

onMounted(() => {
  collectMessages()
  observer = new MutationObserver(scheduleCollect)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })
})

onUnmounted(() => {
  observer?.disconnect()
  if (collectTimer != null) {
    window.clearTimeout(collectTimer)
  }
})
</script>

<template>
  <ElConfigProvider namespace="ehp">
    <aside class="boss-helper-chat-capture">
      <div class="capture-header">
        <div>
          <h3>Boss 聊天记录</h3>
          <ElText class="capture-title" type="info">
            {{ title || '当前会话' }}
          </ElText>
        </div>
        <strong>{{ messageCount }}</strong>
      </div>
      <ElText class="capture-status" type="info">
        {{ statusText }}
      </ElText>
      <ElText class="capture-status" :type="autoReplyEnabled ? 'success' : 'info'">
        AI回复：{{ autoReplyStatusText }}
      </ElText>
      <div class="capture-actions">
        <ElButton size="small" type="primary" @click="collectMessages">刷新采集</ElButton>
        <ElButton size="small" :disabled="messageCount === 0" @click="exportJson">
          导出 JSON
        </ElButton>
        <ElButton size="small" :disabled="messageCount === 0" @click="exportCsv">
          导出 CSV
        </ElButton>
        <ElButton
          size="small"
          type="success"
          :disabled="messageCount === 0 || !autoReplyEnabled"
          :loading="autoReplyProcessing"
          @click="triggerAutoReplyNow"
        >
          立即回复
        </ElButton>
      </div>
      <div v-if="autoReplyLogs.length > 0" class="capture-logs">
        <div
          v-for="item in autoReplyLogs.slice(-5)"
          :key="item.id"
          class="capture-log"
          :class="`is-${item.level}`"
        >
          <span>{{ item.time }}</span>
          <p>{{ item.text }}</p>
        </div>
      </div>
    </aside>
  </ElConfigProvider>
</template>

<style lang="scss" scoped>
.boss-helper-chat-capture {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2147483647;
  width: 320px;
  padding: 14px;
  color: #1f2933;
  background: #ffffff;
  border: 1px solid #d9e2ec;
  border-radius: 8px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
  font-size: 13px;
}

.capture-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;

  h3 {
    margin: 0 0 4px;
    font-size: 15px;
    line-height: 1.3;
  }

  strong {
    min-width: 42px;
    text-align: right;
    color: #059669;
    font-size: 24px;
    line-height: 1;
  }
}

.capture-title,
.capture-status {
  display: block;
  line-height: 1.5;
}

.capture-title {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capture-status {
  margin-top: 10px;
}

.capture-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;

  :deep(.ehp-button) {
    margin-left: 0;
  }
}

.capture-logs {
  display: grid;
  gap: 4px;
  max-height: 132px;
  margin-top: 12px;
  overflow: auto;
  color: #52606d;
  font-size: 12px;
}

.capture-log {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 6px;
  line-height: 1.35;

  span {
    color: #9aa5b1;
  }

  p {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }
}

.capture-log.is-warn p {
  color: #b7791f;
}

.capture-log.is-error p {
  color: #c53030;
}
</style>
