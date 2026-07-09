import { ElMessage } from 'element-plus'
import type { Ref } from 'vue'
import { computed, onUnmounted, ref, watch } from 'vue'

import { useModel, type modelData } from '@/composables/useModel'
import { SignedKeyLLM } from '@/composables/useModel/signedKey'
import type { prompt } from '@/composables/useModel/type'
import { useConf } from '@/stores/conf'
import { useUser } from '@/stores/user'
import { logger } from '@/utils/logger'

import type { AutoChatLogEntry, CapturedMessage } from '../types'

interface ChatJobContext {
  title: string
  salary: string
  location: string
  recruiter: string
  rawText: string
  detailUrl: string
  detailText: string
  source: string
}

interface ProfileContext {
  text: string
  available: boolean
}

const STORAGE_KEY = 'boss-helper:auto-chat:replied-message-keys'
const LOG_STORAGE_KEY = 'boss-helper:auto-chat:logs'
const MAX_STORED_KEYS = 200
const MAX_LOGS = 80
const MAX_CONTEXT_MESSAGES = 20
const MAX_JOB_CONTEXT_CHARS = 1200
const MAX_JOB_DETAIL_CONTEXT_CHARS = 4500
const MAX_PROFILE_CONTEXT_CHARS = 3000
const MAX_FILTERING_CONTEXT_CHARS = 3500
const DRAFT_CONFIRM_TIMEOUT = 1000
const AI_REPLY_RETRY_DELAYS = [1500, 3000]
const LOW_VALUE_REPLY_PREFIX_RE =
  /^(?:好的|可以的|可以|没问题的|没问题|收到|嗯嗯|好呀|行的|当然可以)[，,。.\s!！、]+/

const PROFILE_CONTEXT_OPTIONS = {
  基本信息: {
    姓名: false,
    年龄: true,
    性别: true,
    学历: true,
    求职状态: true,
    工作年限: true,
  },
  期望职位: true,
  个人优势: true,
  工作经历: true,
  项目经历: true,
  教育经历: true,
  资格证书: true,
  志愿者经历: false,
}

const AI_REPLY_CONTEXT_APPENDIX = `

## 自动补充上下文
最近聊天记录窗口: {{ chat.contextWindow }} 条

当前岗位信息:
{{ chat.jobText }}

求职者资料摘要:
{{ chat.profile }}

AI筛选标准（只作为求职偏好和岗位风险参考，不要继承其中的 JSON 输出格式）:
{{ chat.filteringCriteria }}

请优先基于以上上下文回答，不要编造上下文中没有的信息。`

const AI_REPLY_QUALITY_APPENDIX = `

## 自动回复质量约束 v2: 信息获取优先
- 目标是获取更多岗位有效信息，不是无条件顺从；回复里至少要推进一个有价值的信息点。
- 先正面回答招聘者最后一个问题，再自然补充一个最关键的问题，除非对方已经明确要求你只做确认。
- 问到技术、版本、模块、平台、项目或经验时，必须优先从求职者资料摘要和最近聊天记录中提取具体点回答。
- 如果上下文没有明确答案，要具体说明缺口，例如“这块简历里没有展开”或“具体版本需要我确认下”，不要只写“可以进一步沟通确认”。
- 对方要求发附件简历、微信、电话、资料时，可以简短回应，但必须顺带询问 1 个岗位关键问题，例如核心职责、技术栈侧重点、团队/项目方向、工作模式或面试流程。
- 不要用“好的”“可以的”“没问题”“收到”作为默认开头；避免空泛回复：不要只写“可以进一步沟通确认”“我也可以进一步了解”“麻烦您查收”等没有信息量的句子。
- 不要编造资料摘要和聊天记录里不存在的事实。`

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRetryableAiProviderError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return (
    message.includes('provider unavailable') ||
    message.includes('heartbeat') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('fetch failed')
  )
}

function safeJsonParse(value: string | null): string[] {
  if (!value) {
    return []
  }
  try {
    const data = JSON.parse(value)
    return Array.isArray(data)
      ? data.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function readRepliedKeys(): Set<string> {
  return new Set(safeJsonParse(sessionStorage.getItem(STORAGE_KEY)))
}

function saveRepliedKeys(keys: Set<string>) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...keys].slice(-MAX_STORED_KEYS)))
}

function readLogs(): AutoChatLogEntry[] {
  try {
    const data = JSON.parse(sessionStorage.getItem(LOG_STORAGE_KEY) || '[]')
    return Array.isArray(data)
      ? data.filter((item): item is AutoChatLogEntry => {
          return (
            typeof item?.id === 'number' &&
            typeof item?.time === 'string' &&
            ['info', 'warn', 'error'].includes(item?.level) &&
            typeof item?.text === 'string'
          )
        })
      : []
  } catch {
    return []
  }
}

function formatLogTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function clipText(value: string, max = 80): string {
  const text = normalizeText(value)
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function limitContextText(value: string, max: number): string {
  const text = value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > max ? `${text.slice(0, max)}\n...(已截断)` : text
}

function formatPromptTemplate(template: string | prompt): string {
  if (typeof template === 'string') {
    return template
  }
  return template.map((item) => `${item.role}: ${item.content}`).join('\n\n')
}

function formatFilteringCriteria(
  promptTemplate: string | prompt,
  score: number | undefined,
  enabled: boolean,
): string {
  const promptText = formatPromptTemplate(promptTemplate)
  const criteria = limitContextText(
    promptText || '未配置 AI筛选标准。',
    MAX_FILTERING_CONTEXT_CHARS,
  )
  return [
    `AI筛选状态: ${enabled ? '已启用' : '未启用'}`,
    `过滤分数阈值: ${score ?? 10}`,
    '筛选标准:',
    criteria,
    '',
    '注意: 以上内容只用于理解求职偏好、风险点和该追问哪些岗位信息；AI回复仍必须输出普通聊天正文，不要输出 JSON。',
  ].join('\n')
}

function includesAutoReplyContext(content: string): boolean {
  return (
    content.includes('chat.jobText') &&
    content.includes('chat.profile') &&
    content.includes('chat.filteringCriteria')
  )
}

function includesAutoReplyQuality(content: string): boolean {
  return content.includes('自动回复质量约束 v2') || content.includes('信息获取优先')
}

function buildRuntimeAiReplyPrompt(template: string | prompt): string | prompt {
  if (typeof template === 'string') {
    let content = template
    if (!includesAutoReplyContext(content)) {
      content = `${content}${AI_REPLY_CONTEXT_APPENDIX}`
    }
    if (!includesAutoReplyQuality(content)) {
      content = `${content}${AI_REPLY_QUALITY_APPENDIX}`
    }
    return content
  }

  const cloned = template.map((item) => ({ ...item }))
  const last = cloned.at(-1)
  if (last && !includesAutoReplyContext(last.content)) {
    last.content = `${last.content}${AI_REPLY_CONTEXT_APPENDIX}`
  }
  if (last && !includesAutoReplyQuality(last.content)) {
    last.content = `${last.content}${AI_REPLY_QUALITY_APPENDIX}`
  }
  return cloned
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isVisibleElement(element: Element | null | undefined): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false
  }
  if (element.closest('#boss-helper-chat')) {
    return false
  }
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  )
}

function visibleElementText(element: Element | null | undefined): string {
  if (!isVisibleElement(element)) {
    return ''
  }
  return normalizeText(element.textContent ?? '')
}

function visibleElementInnerText(element: Element | null | undefined): string {
  if (!isVisibleElement(element)) {
    return ''
  }
  return limitContextText(element.innerText || element.textContent || '', MAX_JOB_CONTEXT_CHARS)
}

function uniqueElements(selectors: string[]): HTMLElement[] {
  return [
    ...new Set(
      selectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector))),
    ),
  ].filter(isVisibleElement)
}

function salaryPattern(): RegExp {
  return /\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?K(?:[·.]\d+薪)?|薪资面议|面议/i
}

function absoluteUrl(value: string): string {
  try {
    return new URL(value, location.origin).href
  } catch {
    return ''
  }
}

function textFromStaticElement(element: Element | null | undefined): string {
  if (!element) {
    return ''
  }
  return normalizeText(element.textContent ?? '')
}

function isLikelyJobText(text: string): boolean {
  if (!text || text.includes('Boss 聊天记录') || text.includes('搜索30天内的联系人')) {
    return false
  }
  return text.includes('查看职位') || salaryPattern().test(text)
}

function scoreJobElement(element: HTMLElement, text: string): number {
  const rect = element.getBoundingClientRect()
  let score = 0
  if (text.includes('查看职位')) {
    score += 80
  }
  if (salaryPattern().test(text)) {
    score += 70
  }
  if (rect.left > window.innerWidth * 0.32) {
    score += 35
  }
  if (rect.top < window.innerHeight * 0.45) {
    score += 25
  }
  if (rect.width > 160) {
    score += 15
  }
  if (text.length > 260) {
    score -= 30
  }
  return score - Math.min(text.length / 30, 10)
}

function expandJobElement(element: HTMLElement): {
  element: HTMLElement
  text: string
  source: string
} {
  let current: HTMLElement | null = element
  let best = {
    element,
    text: visibleElementInnerText(element),
    source: 'dom-scan',
  }

  for (let depth = 0; current && current !== document.body && depth < 5; depth++) {
    const text = visibleElementInnerText(current)
    if (
      isLikelyJobText(text) &&
      text.length >= best.text.length &&
      text.length <= MAX_JOB_CONTEXT_CHARS
    ) {
      best = {
        element: current,
        text,
        source: depth === 0 ? 'dom-scan' : 'dom-parent-scan',
      }
    }
    current = current.parentElement
  }

  return best
}

function pickCurrentJobElementByScan():
  | { element: HTMLElement; text: string; source: string }
  | undefined {
  const elements = Array.from(
    document.body.querySelectorAll<HTMLElement>('div, section, header, main, article, a, span, p'),
  )
    .filter(isVisibleElement)
    .filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left > window.innerWidth * 0.25 && rect.top < window.innerHeight * 0.55
    })
    .map(expandJobElement)
    .filter(({ text }) => isLikelyJobText(text))

  return elements
    .sort((a, b) => scoreJobElement(b.element, b.text) - scoreJobElement(a.element, a.text))
    .at(0)
}

function pickCurrentJobElement(): HTMLElement | undefined {
  const selectors = [
    '.chat-info',
    '.chat-header',
    '.job-card',
    '.job-info',
    '.position-info',
    '[class*="chat-info"]',
    '[class*="chat-header"]',
    '[class*="job-card"]',
    '[class*="job-info"]',
    '[class*="position-info"]',
  ]
  const salaryRe = salaryPattern()
  const candidates = uniqueElements(selectors)
    .map((element) => ({ element, text: visibleElementText(element) }))
    .filter(({ text }) => text && (text.includes('查看职位') || salaryRe.test(text)))
    .filter(({ text }) => !text.includes('Boss 聊天记录'))
    .sort((a, b) => a.text.length - b.text.length)
  return candidates[0]?.element ?? pickCurrentJobElementByScan()?.element
}

function extractCurrentJobContext(title: string): ChatJobContext {
  const scanned = pickCurrentJobElementByScan()
  const element = pickCurrentJobElement()
  const rawText =
    scanned?.text ??
    limitContextText(element ? visibleElementInnerText(element) : '', MAX_JOB_CONTEXT_CHARS)
  const detailUrl = findJobDetailUrl(scanned?.element ?? element)
  if (!rawText) {
    return {
      title: '',
      salary: '',
      location: '',
      recruiter: normalizeText(title),
      rawText: '',
      detailUrl,
      detailText: '',
      source: 'missing',
    }
  }

  const salary = rawText.match(salaryPattern())?.[0] ?? ''
  const beforeSalary = salary ? rawText.slice(0, rawText.indexOf(salary)).trim() : rawText
  const titleText = beforeSalary.split(/\s+/).filter(Boolean).at(-1) ?? beforeSalary
  const restText = salary ? rawText.slice(rawText.indexOf(salary) + salary.length).trim() : rawText
  const location =
    restText
      .replace('查看职位', '')
      .split(/\s+/)
      .find((item) => item.length >= 2 && item.length <= 8 && !item.includes('在线')) ?? ''
  return {
    title: titleText,
    salary,
    location,
    recruiter: normalizeText(title),
    rawText,
    detailUrl,
    detailText: '',
    source: scanned?.source ?? 'dom',
  }
}

function isLikelyCurrentJobLink(link: HTMLAnchorElement): boolean {
  const href = link.getAttribute('href') ?? ''
  const text = normalizeText(link.textContent ?? '')
  if (!href.includes('/job_detail/') && text !== '查看职位') {
    return false
  }
  if (!isVisibleElement(link)) {
    return false
  }
  const rect = link.getBoundingClientRect()
  return rect.left > window.innerWidth * 0.25 && rect.top < window.innerHeight * 0.55
}

function findJobDetailUrl(element?: HTMLElement): string {
  const scoped = element
    ? Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href*="/job_detail/"]'))
    : []
  const global = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/job_detail/"]'))
  const candidates = [...new Set([...scoped, ...global])]
    .filter(isLikelyCurrentJobLink)
    .sort((a, b) => {
      const ar = a.getBoundingClientRect()
      const br = b.getBoundingClientRect()
      return ar.top - br.top || br.left - ar.left
    })
  const href = candidates[0]?.href || candidates[0]?.getAttribute('href') || ''
  return href ? absoluteUrl(href) : ''
}

function pickJobDetailTextFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc
    .querySelectorAll('script, style, noscript, svg, img, header, nav, footer')
    .forEach((item) => item.remove())

  const selectors = [
    '.job-detail',
    '.job-detail-section',
    '.job-sec-text',
    '.job-detail-box',
    '.job-description',
    '.job-primary',
    '[class*="job-detail"]',
    '[class*="job-sec"]',
    '[class*="detail-content"]',
  ]
  const candidates = [
    ...new Set(selectors.flatMap((selector) => Array.from(doc.querySelectorAll(selector)))),
  ]
    .map((element) => textFromStaticElement(element))
    .filter((text) => {
      return (
        text.length >= 40 &&
        !text.includes('Boss 聊天记录') &&
        (text.includes('职位描述') ||
          text.includes('岗位职责') ||
          text.includes('任职要求') ||
          text.includes('岗位要求') ||
          salaryPattern().test(text))
      )
    })
    .sort((a, b) => {
      const aScore =
        Number(a.includes('职位描述')) +
        Number(a.includes('岗位职责')) +
        Number(a.includes('任职要求'))
      const bScore =
        Number(b.includes('职位描述')) +
        Number(b.includes('岗位职责')) +
        Number(b.includes('任职要求'))
      return bScore - aScore || b.length - a.length
    })

  const text = candidates[0] ?? textFromStaticElement(doc.body)
  return limitContextText(text, MAX_JOB_DETAIL_CONTEXT_CHARS)
}

// 缓存详情页正文，避免同一岗位每条回复都重复带 cookie 拉取详情页（降低风控暴露）
const jobDetailTextCache = new Map<string, string>()

async function fetchJobDetailText(detailUrl: string): Promise<string> {
  if (!detailUrl) {
    return ''
  }
  const cached = jobDetailTextCache.get(detailUrl)
  if (cached != null) {
    return cached
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(detailUrl, {
      credentials: 'include',
      signal: controller.signal,
    })
    if (!response.ok) {
      return ''
    }
    const text = pickJobDetailTextFromHtml(await response.text())
    if (text) {
      jobDetailTextCache.set(detailUrl, text)
    }
    return text
  } catch (error) {
    logger.warn('读取岗位详情页失败', error)
    return ''
  } finally {
    window.clearTimeout(timer)
  }
}

async function loadCurrentJobContext(title: string): Promise<ChatJobContext> {
  const job = extractCurrentJobContext(title)
  if (!job.detailUrl) {
    return job
  }
  const detailText = await fetchJobDetailText(job.detailUrl)
  if (!detailText) {
    return job
  }
  return {
    ...job,
    detailText,
    source: `${job.source}+detail-html`,
  }
}

function formatJobContext(job: ChatJobContext): string {
  if (!job.rawText && !job.detailText) {
    return '当前页面未识别到岗位卡片信息。'
  }
  return [
    job.title ? `岗位: ${job.title}` : '',
    job.salary ? `薪资: ${job.salary}` : '',
    job.location ? `地点: ${job.location}` : '',
    job.recruiter ? `招聘者/会话: ${job.recruiter}` : '',
    job.detailUrl ? `详情页: ${job.detailUrl}` : '',
    `页面可见岗位信息: ${job.rawText}`,
    job.detailText ? `详情页岗位正文: ${job.detailText}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function loadProfileContext(): Promise<ProfileContext> {
  try {
    const text = await useUser().getUserResumeString(PROFILE_CONTEXT_OPTIONS)
    return {
      text: limitContextText(text, MAX_PROFILE_CONTEXT_CHARS) || '未获取到求职者资料摘要。',
      available: Boolean(text.trim()),
    }
  } catch (error) {
    logger.warn('获取求职者资料摘要失败', error)
    return {
      text: '未获取到求职者资料摘要。',
      available: false,
    }
  }
}

function isEditableElement(
  element: HTMLElement,
): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
}

function findChatComposer(): HTMLElement | undefined {
  const selectors = [
    '.chat-input textarea',
    '.chat-input input',
    '.chat-input [contenteditable="true"]',
    '.message-input textarea',
    '.message-input input',
    '.message-input [contenteditable="true"]',
    '.chat-editor textarea',
    '.chat-editor [contenteditable="true"]',
    '.input-area textarea',
    '.input-area [contenteditable="true"]',
    '[class*="chat"] textarea',
    '[class*="chat"] [contenteditable="true"]',
    '[class*="input"] textarea',
    '[class*="input"] [contenteditable="true"]',
    'textarea',
    '[contenteditable="true"]',
  ]
  const candidates = selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)),
  )
  return candidates.find((element) => {
    if (!isVisibleElement(element)) {
      return false
    }
    if (isEditableElement(element) && (element.disabled || element.readOnly)) {
      return false
    }
    const placeholder = isEditableElement(element) ? element.placeholder : ''
    if (placeholder.includes('搜索')) {
      return false
    }
    const rect = element.getBoundingClientRect()
    return rect.width >= 120 && rect.bottom > window.innerHeight * 0.5
  })
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(element) as HTMLInputElement | HTMLTextAreaElement
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function fillComposer(element: HTMLElement, content: string) {
  element.focus()
  if (isEditableElement(element)) {
    setNativeValue(element, content)
    return
  }
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(element)
  selection?.removeAllRanges()
  selection?.addRange(range)
  // execCommand 已废弃，但仍是当前 contenteditable 输入框最稳的写入方式；
  // 已知脆弱点：若 BOSS 换用富文本编辑器需改为对应受控写入
  document.execCommand('insertText', false, content)
  if (!normalizeText(element.textContent ?? '').includes(normalizeText(content))) {
    element.textContent = content
  }
  element.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }),
  )
}

function getComposerText(element: HTMLElement): string {
  return normalizeText(isEditableElement(element) ? element.value : (element.textContent ?? ''))
}

async function waitForComposerDraft(element: HTMLElement, content: string): Promise<boolean> {
  const expected = normalizeText(content)
  const end = Date.now() + DRAFT_CONFIRM_TIMEOUT
  while (Date.now() < end) {
    if (getComposerText(element).includes(expected)) {
      return true
    }
    await sleep(100)
  }
  return getComposerText(element).includes(expected)
}

async function saveReplyDraftByDom(content: string) {
  const composer = findChatComposer()
  if (!composer) {
    throw new Error('没有找到BOSS聊天输入框')
  }
  const currentText = getComposerText(composer)
  if (currentText && currentText !== normalizeText(content)) {
    throw new Error('聊天输入框已有内容，未覆盖AI回复草稿')
  }
  fillComposer(composer, content)
  if (!(await waitForComposerDraft(composer, content))) {
    throw new Error('AI回复草稿未成功写入聊天输入框')
  }
}

// URL 稳定标识：聊天页切换会话时优先依赖它，避免标题短暂抓不到导致误判
function getConversationStableKey(): string {
  const params = new URLSearchParams(location.search)
  const id = params.get('id') || params.get('uid') || params.get('friendId') || ''
  const source = params.get('source') || params.get('friendSource') || ''
  return [location.pathname, id, source].join('|')
}

function getConversationKey(title: string): string {
  return [getConversationStableKey(), normalizeText(title || '当前会话')].join('|')
}

function getMessageKey(title: string, message: CapturedMessage): string {
  return [
    getConversationKey(title),
    message.direction,
    message.time,
    normalizeText(message.sender),
    normalizeText(message.content).slice(0, 180),
  ].join('|')
}

function getLastOtherMessage(messages: CapturedMessage[], title: string, includeSeen: boolean) {
  return [...messages].reverse().find((message) => {
    if (message.direction !== 'other' || !normalizeText(message.content)) {
      return false
    }
    const key = getMessageKey(title, message)
    return !repliedKeys.has(key) && (includeSeen || !seenKeys.has(key))
  })
}

function getManualReplyMessage(messages: CapturedMessage[]): CapturedMessage | undefined {
  const message = [...messages].reverse().find((message) => {
    if (!normalizeText(message.content)) {
      return false
    }
    return message.direction !== 'self' && message.direction !== 'system'
  })

  if (!message) {
    return undefined
  }

  if (message.direction === 'other') {
    return message
  }

  return { ...message, direction: 'other', sender: message.sender || '对方' }
}

function normalizeReply(content: string | undefined): string {
  const reply = (content ?? '')
    .replace(/^```[\w-]*\s*/g, '')
    .replace(/```$/g, '')
    .trim()
  // 仅剥离一次开头的纯客套词，且不能把正文剥空（避免误伤"可以，我们..."这类含答案的回复）
  const stripped = reply.replace(LOW_VALUE_REPLY_PREFIX_RE, '').trim()
  return stripped ? stripped : reply
}

function formatHistory(messages: CapturedMessage[]): string {
  return messages
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((message) => {
      const role =
        message.direction === 'self'
          ? '我'
          : message.direction === 'other'
            ? message.sender || '对方'
            : '系统'
      const time = message.time ? ` ${message.time}` : ''
      return `${role}${time}: ${message.content}`
    })
    .join('\n')
}

const repliedKeys = readRepliedKeys()
const seenKeys = new Set<string>()

export function useAutoChat(args: { title: Ref<string>; messages: Ref<CapturedMessage[]> }) {
  const conf = useConf()
  const model = useModel()
  const enabled = computed(() => conf.formData.aiReply.enable)
  const processing = ref(false)
  const statusText = ref('自动回复未启用')
  const lastReplyText = ref('')
  const logs = ref<AutoChatLogEntry[]>(readLogs())
  let activeConversationKey = ''
  let activeStableKey = ''
  let baselineReady = false
  let pendingKey = ''
  let timer: number | undefined
  let logId = Date.now()

  function addLog(level: AutoChatLogEntry['level'], text: string, detail = '') {
    const entry = {
      id: ++logId,
      time: formatLogTime(),
      level,
      text: detail ? `${text}: ${detail}` : text,
    }
    logs.value = [...logs.value, entry].slice(-MAX_LOGS)
    sessionStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logs.value))
  }

  function clearTimer() {
    if (timer != null) {
      window.clearTimeout(timer)
      timer = undefined
    }
    pendingKey = ''
  }

  function markCurrentMessagesSeen() {
    args.messages.value.forEach((message) => seenKeys.add(getMessageKey(args.title.value, message)))
  }

  async function ensureAiReplyStoresReady() {
    if (!conf.isLoaded) {
      addLog('info', 'AI回复配置加载中')
      await conf.confInit()
    }
    await model.initModel()
  }

  function getModelData(): modelData[] {
    return model.modelData as unknown as modelData[]
  }

  function formatModelNames(models: modelData[]): string {
    return models.map((item) => `${item.name}(${item.key})`).join('、') || '无'
  }

  function resolveAiReplyModel(): modelData {
    const configuredModelKey = conf.formData.aiReply.model
    const models = getModelData()
    const customModels = models.filter((item) => item.data && !item.vip)
    if (configuredModelKey) {
      const selectedModel = models.find((item) => configuredModelKey === item.key)
      if (!selectedModel) {
        if (customModels.length === 1) {
          addLog(
            'warn',
            'AI回复配置的模型已失效，已临时使用唯一自定义模型',
            `失效模型=${configuredModelKey}, 使用=${customModels[0].name}(${customModels[0].key})`,
          )
          return customModels[0]
        }
        throw new Error(
          `没有找到AI回复配置的模型(${configuredModelKey})，当前可用模型: ${formatModelNames(customModels)}，请重新选择模型并保存`,
        )
      }
      addLog('info', 'AI回复使用模型', `${selectedModel.name}(${selectedModel.key})`)
      return selectedModel
    }

    if (customModels.length === 1) {
      addLog('warn', 'AI回复未选择模型，已临时使用唯一自定义模型', customModels[0].name)
      return customModels[0]
    }
    if (customModels.length === 0) {
      throw new Error('还没有配置可用于AI回复的自定义模型，请先在模型配置里添加模型')
    }
    throw new Error('AI回复还没有选择模型，请在AI回复设置里选择模型并保存')
  }

  function syncConversationBaseline(): boolean {
    const stableKey = getConversationStableKey()
    const key = getConversationKey(args.title.value)
    const placeholderTitle = !normalizeText(args.title.value)
    // 切换判定优先看 URL 稳定标识；标题只是从有到无（短暂抓不到）时不重置基线，
    // 避免基线反复清空导致漏回或对历史消息误回复
    const switched =
      stableKey !== activeStableKey ||
      (!placeholderTitle && key !== activeConversationKey) ||
      !activeConversationKey
    if (switched) {
      activeStableKey = stableKey
      activeConversationKey = key
      baselineReady = false
      seenKeys.clear()
      clearTimer()
      addLog('info', '切换会话', args.title.value || '当前会话')
    } else if (!placeholderTitle) {
      // 同一会话内标题补全后，刷新 key 以便消息去重使用真实标题
      activeConversationKey = key
    }
    if (!baselineReady) {
      markCurrentMessagesSeen()
      if (args.messages.value.length > 0) {
        baselineReady = true
        addLog('info', '已跳过当前已加载消息，等待后续新消息')
      }
      return false
    }
    return true
  }

  async function createReply(message: CapturedMessage): Promise<string> {
    addLog('info', '开始生成AI回复', clipText(message.content))
    await ensureAiReplyStoresReady()
    if (conf.formData.aiReply.vip) {
      throw new Error('AI回复暂不支持会员模式，请选择自定义模型')
    }
    const curModel = resolveAiReplyModel()
    if (!curModel.data || curModel.vip) {
      throw new Error('AI回复暂不支持会员模型，请选择自定义模型')
    }
    const gpt = model.getModel(
      curModel,
      buildRuntimeAiReplyPrompt(conf.formData.aiReply.prompt),
      false,
    )
    if (gpt instanceof SignedKeyLLM) {
      throw new Error('AI回复暂不支持会员模式，请选择自定义模型')
    }
    const contextMessages = args.messages.value.slice(-MAX_CONTEXT_MESSAGES)
    const job = await loadCurrentJobContext(args.title.value)
    const jobText = formatJobContext(job)
    const profile = await loadProfileContext()
    const filteringCriteria = formatFilteringCriteria(
      conf.formData.aiFiltering.prompt,
      conf.formData.aiFiltering.score,
      conf.formData.aiFiltering.enable,
    )
    addLog(
      'info',
      '上下文准备完成',
      `messages=${contextMessages.length}, job=${job.rawText || job.detailText ? job.source : 'missing'}, detail=${job.detailText ? 'yes' : 'no'}, profile=${profile.available ? 'yes' : 'no'}, filtering=yes`,
    )
    addLog('info', '岗位上下文', clipText(jobText, 120))
    let content = ''
    for (let attempt = 0; attempt <= AI_REPLY_RETRY_DELAYS.length; attempt += 1) {
      try {
        const response = await gpt.message(
          {
            data: {
              chat: {
                title: args.title.value || '当前会话',
                url: location.href,
                now: new Date().toLocaleString('zh-CN', { hour12: false }),
                currentMessage: message,
                contextWindow: MAX_CONTEXT_MESSAGES,
                messages: contextMessages,
                history: formatHistory(contextMessages),
                job,
                jobText,
                profile: profile.text,
                filteringCriteria,
              },
            },
          },
          'aiReply',
        )
        content = response.content ?? ''
        break
      } catch (error) {
        const retryDelay = AI_REPLY_RETRY_DELAYS[attempt]
        if (retryDelay == null || !isRetryableAiProviderError(error)) {
          throw error
        }
        addLog(
          'warn',
          'AI服务临时不可用，准备重试',
          `${clipText(errorMessage(error), 100)}；${retryDelay / 1000}秒后重试`,
        )
        await sleep(retryDelay)
      }
    }
    const reply = normalizeReply(content)
    addLog('info', 'AI回复生成完成', clipText(reply))
    return reply
  }

  async function processMessage(message: CapturedMessage, mode: 'auto' | 'manual') {
    if (processing.value) {
      return
    }
    const key = getMessageKey(args.title.value, message)
    if (repliedKeys.has(key)) {
      if (mode === 'auto') {
        statusText.value = '这条消息已经回复过'
        return
      }
      addLog('warn', '手动重试已标记消息')
    }
    clearTimer()
    markCurrentMessagesSeen()
    seenKeys.add(key)
    processing.value = true
    statusText.value = '正在生成回复草稿...'
    addLog(
      'info',
      mode === 'auto' ? '自动触发回复草稿' : '手动触发回复草稿',
      clipText(message.content),
    )
    try {
      const reply = await createReply(message)
      if (!reply) {
        throw new Error('AI回复为空')
      }
      addLog('info', '开始写入回复草稿')
      await saveReplyDraftByDom(reply)
      repliedKeys.add(key)
      saveRepliedKeys(repliedKeys)
      lastReplyText.value = reply
      statusText.value = '已生成回复草稿，等待你处理'
      addLog('info', '回复草稿已写入输入框')
    } catch (error) {
      logger.error('自动回复失败', error)
      const reason = errorMessage(error)
      statusText.value = `自动回复失败: ${reason}`
      addLog('error', '自动回复失败', reason)
    } finally {
      processing.value = false
      scheduleAutoReply()
    }
  }

  function scheduleAutoReply() {
    const ready = syncConversationBaseline()
    if (!conf.isLoaded) {
      statusText.value = '自动回复配置加载中'
      return
    }
    if (!enabled.value) {
      clearTimer()
      statusText.value = '自动回复未启用'
      return
    }
    if (processing.value || !ready) {
      statusText.value = processing.value ? statusText.value : '等待新消息'
      return
    }

    const message = getLastOtherMessage(args.messages.value, args.title.value, false)
    if (!message) {
      statusText.value = '等待新消息'
      return
    }

    const key = getMessageKey(args.title.value, message)
    if (pendingKey === key && timer != null) {
      return
    }
    clearTimer()
    pendingKey = key
    const seconds = Math.max(Number(conf.formData.delay.messageSending) || 5, 1)
    statusText.value = `检测到新消息，${seconds} 秒后自动回复`
    timer = window.setTimeout(() => {
      timer = undefined
      void processMessage(message, 'auto')
    }, seconds * 1000)
  }

  async function triggerNow() {
    addLog('info', '点击立即回复')
    if (!enabled.value) {
      ElMessage.warning('请先启用AI回复')
      addLog('warn', '立即回复被跳过', 'AI回复未启用')
      return
    }
    syncConversationBaseline()
    const message = getManualReplyMessage(args.messages.value)
    if (!message) {
      statusText.value = '没有找到可回复的对方消息'
      ElMessage.warning('没有可回复的对方消息')
      addLog('warn', '立即回复被跳过', '当前采集消息里没有可用的非本人消息')
      return
    }
    if (
      !args.messages.value.some((item) => {
        return (
          item.index === message.index &&
          item.direction === 'other' &&
          normalizeText(item.content) === normalizeText(message.content)
        )
      })
    ) {
      addLog('warn', '立即回复使用兜底消息', '当前未识别到 direction=other，按最新非本人消息处理')
    }
    await processMessage(message, 'manual')
  }

  watch([args.title, args.messages, enabled], scheduleAutoReply, { deep: false })

  onUnmounted(() => {
    clearTimer()
  })

  return {
    enabled,
    processing,
    statusText,
    lastReplyText,
    logs,
    triggerNow,
  }
}
